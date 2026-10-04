import { apiErrorResponseSchema, serverParamsSchema, worldImportUploadResponseSchema, worldImportUploadsResponseSchema,
  worldImportDiscardRequestSchema, worldImportDiscardResponseSchema, worldImportUploadParamsSchema,
  worldImportCleanupRequestSchema, worldImportCleanupResponseSchema,
  type WorldImportDiscardRequest, type Mode, type ServerParams } from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";
import type { Readable } from "node:stream";
import type { Clock } from "../clock.js";
import { installWriteRequestGuard, responseMeta } from "../infra/http.js";
import { DomainError } from "../services/domain-errors.js";
import type { WorldImportUploadService } from "../services/world-import-upload-service.js";
import { WORLD_IMPORT_ARCHIVE_LIMITS } from "../services/world-import-archive.js";

export function registerWorldImportUploadRoutes(app: FastifyInstance, service: WorldImportUploadService, clock: Clock, mode: Mode): void {
  void app.register(async (uploads) => {
    uploads.post<{ Params: ServerParams; Body: { intent: "cleanup-expired-unclaimed" } }>("/api/v1/servers/:serverId/worlds/import-uploads/cleanup", {
      preValidation: async (req) => {
        if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || req.body.intent !== "cleanup-expired-unclaimed" ||
          Object.keys(req.body).length !== 1) throw new DomainError(400,"VALIDATION_ERROR","清理请求格式无效","invalid-import-cleanup");
      },
      preHandler: installWriteRequestGuard(clock,mode),
      schema: { params:serverParamsSchema,body:worldImportCleanupRequestSchema,response:{ 200:worldImportCleanupResponseSchema,
        ...Object.fromEntries([400,403,404,409,415,500].map((code) => [code,apiErrorResponseSchema])) } }
    },async (req,reply) => {
      reply.header("Cache-Control","no-store");
      return { data:await service.cleanupExpired(req.params.serverId),meta:responseMeta(req.id,clock,mode) };
    });
    uploads.get<{ Params: ServerParams }>("/api/v1/servers/:serverId/worlds/import-uploads", {
      schema: { params: serverParamsSchema, response: { 200: worldImportUploadsResponseSchema,
        ...Object.fromEntries([403,404,409,500].map((code) => [code, apiErrorResponseSchema])) } }
    }, async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      return { data: await service.list(req.params.serverId), meta: responseMeta(req.id, clock, mode) };
    });
    uploads.post<{ Params: ServerParams & { uploadId: string }; Body: WorldImportDiscardRequest }>("/api/v1/servers/:serverId/worlds/import-uploads/:uploadId/discard", {
      preValidation: async (req) => {
        const body = req.body;
        if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.confirmUploadId !== "string" || typeof body.revision !== "string" ||
          Object.keys(body).some((key) => !["confirmUploadId", "revision"].includes(key))) {
          throw new DomainError(400, "VALIDATION_ERROR", "丢弃请求格式无效", "invalid-import-discard");
        }
      },
      preHandler: installWriteRequestGuard(clock, mode),
      schema: { params: worldImportUploadParamsSchema, body: worldImportDiscardRequestSchema, response: { 200: worldImportDiscardResponseSchema,
        ...Object.fromEntries([400,403,404,409,415,500].map((code) => [code, apiErrorResponseSchema])) } }
    }, async (req, reply) => {
      await service.discard(req.params.serverId, req.params.uploadId, req.body);
      reply.header("Cache-Control", "no-store");
      return { data: { id: req.params.uploadId, state: "discarded" }, meta: responseMeta(req.id, clock, mode) };
    });
    // Keep the raw ZIP stream out of Fastify's JSON parser and memory buffers.
    // The service enforces the byte limit even without Content-Length.
    uploads.addContentTypeParser("application/zip", (_request, payload, done) => done(null, payload));
    uploads.post<{ Params: ServerParams; Body: Readable }>("/api/v1/servers/:serverId/worlds/import-uploads", {
      onRequest: async (req) => {
        if (!req.headers.origin || req.headers["x-manager-intent"] !== "local-ui") {
          throw new DomainError(403, "ORIGIN_REJECTED", "世界上传需要本地操作意图", "import-intent-required");
        }
        if (req.headers["content-type"] !== "application/zip" || req.headers["content-encoding"] !== undefined) {
          throw new DomainError(415, "UNSUPPORTED_FILE_TYPE", "世界上传必须为未编码的 application/zip", "invalid-import-content-type");
        }
        const length = req.headers["content-length"];
        if (length !== undefined && (!/^\d+$/u.test(length) || Number(length) > WORLD_IMPORT_ARCHIVE_LIMITS.zipBytes)) {
          throw new DomainError(413, "UPLOAD_TOO_LARGE", "世界 ZIP 不能超过 128 MiB", "import-upload-limit");
        }
        if (Object.keys(req.query as object).length) throw new DomainError(400, "VALIDATION_ERROR", "上传不接受路径或查询字段", "unexpected-import-query");
      },
      schema: { params: serverParamsSchema, response: { 201: worldImportUploadResponseSchema,
        ...Object.fromEntries([400,403,404,408,409,413,415,500,501,507].map((code) => [code, apiErrorResponseSchema])) } }
    }, async (req, reply) => {
      const header = req.headers["x-upload-filename"];
      let filename: string;
      try {
        if (typeof header !== "string" || header.length > 1536) throw new Error("filename");
        filename = decodeURIComponent(header);
      } catch { throw new DomainError(400, "VALIDATION_ERROR", "上传文件名格式无效", "invalid-import-filename"); }
      reply.header("Cache-Control", "no-store");
      return reply.code(201).send({ data: await service.upload(req.params.serverId, filename, req.body), meta: responseMeta(req.id, clock, mode) });
    });
  });
}
