import { addonInstallRequestSchema, addonUploadResponseSchema, addonsResponseSchema, apiErrorResponseSchema, lifecycleActionResponseSchema, serverParamsSchema,
  addonLifecycleRequestSchema, addonTrashResponseSchema, type AddonInstallRequest, type AddonLifecycleRequest, type Mode, type ServerParams } from "@mcsm/contracts";
import { Type, type Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { Readable } from "node:stream";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Clock } from "../clock.js";
import { installWriteRequestGuard, responseMeta } from "../infra/http.js";
import { AddonInventory } from "../services/addon-inventory.js";
import type { AddonUploadService } from "../services/addon-upload-service.js";
import type { AddonInstallService } from "../services/addon-install-service.js";
import type { AddonLifecycleService } from "../services/addon-lifecycle-service.js";
import { DomainError } from "../services/domain-errors.js";
export function registerAddonRoutes(app: FastifyInstance, registry: AdapterRegistry, clock: Clock, mode: Mode, reader = new AddonInventory(), lifecycleAvailable = false) {
  app.get<{ Params: ServerParams }>("/api/v1/servers/:serverId/addons", {
    schema: { params: serverParamsSchema, response: { 200: addonsResponseSchema, 403: apiErrorResponseSchema,
      404: apiErrorResponseSchema, 409: apiErrorResponseSchema, 429: apiErrorResponseSchema, 501: apiErrorResponseSchema, 500: apiErrorResponseSchema } }
  }, async (request, reply) => {
    const adapter = registry.get(request.params.serverId);
    if (!adapter) throw new DomainError(404, "SERVER_NOT_FOUND", "未找到服务端", "server-not-found");
    const local = registry.getLocal(request.params.serverId);
    if (!local) throw new DomainError(501, "ADDON_UNSUPPORTED", "扩展目录扫描仅用于注册本地实例", "addon-local-required");
    const data = await reader.read(local.serverId, local.plan.rootPath, local.plan.serverInfo.type, lifecycleAvailable);
    reply.header("Cache-Control", "no-store").header("ETag", `"${data.revision}"`);
    return { data, meta: responseMeta(request.id, clock, mode) };
  });
}

const addonParamsSchema = Type.Object({ serverId: Type.String({ pattern: "^[a-z0-9](?:[a-z0-9-]{0,62})$" }),
  addonId: Type.String({ pattern: "^[a-f0-9]{64}$" }) }, { additionalProperties: false });
const trashParamsSchema = Type.Object({ serverId: Type.String({ pattern: "^[a-z0-9](?:[a-z0-9-]{0,62})$" }),
  trashId: Type.String({ format: "uuid" }) }, { additionalProperties: false });
type AddonParams = Static<typeof addonParamsSchema>;
type TrashParams = Static<typeof trashParamsSchema>;
const lifecycleErrors = Object.fromEntries([400, 403, 404, 409, 428, 429, 500, 501, 507].map((code) => [code, apiErrorResponseSchema]));
const requireIdempotencyKey = (value: string | string[] | undefined): string => {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new DomainError(428, "PRECONDITION_REQUIRED", "扩展变更需要 UUID Idempotency-Key", "addon-idempotency-required");
  }
  return value.toLowerCase();
};

export function registerAddonLifecycleRoutes(app: FastifyInstance, service: AddonLifecycleService | undefined, clock: Clock, mode: Mode): void {
  app.get<{ Params: ServerParams }>("/api/v1/servers/:serverId/addons/trash", {
    schema: { params: serverParamsSchema, response: { 200: addonTrashResponseSchema, ...lifecycleErrors } }
  }, async (request, reply) => {
    if (!service) throw new DomainError(501, "ADDON_UNSUPPORTED", "扩展回收区不可用", "addon-lifecycle-unavailable");
    const data = await service.listTrash(request.params.serverId);
    reply.header("Cache-Control", "no-store").header("ETag", `"${data.revision}"`);
    return { data, meta: responseMeta(request.id, clock, mode) };
  });
  const registerMutation = (action: "disable" | "enable" | "trash") => {
    app.post<{ Params: AddonParams; Body: AddonLifecycleRequest }>(`/api/v1/servers/:serverId/addons/:addonId/${action}`, {
      preHandler: installWriteRequestGuard(clock, mode),
      schema: { params: addonParamsSchema, body: addonLifecycleRequestSchema, response: { 202: lifecycleActionResponseSchema, ...lifecycleErrors } }
    }, async (request, reply) => {
      if (!service) throw new DomainError(501, "ADDON_UNSUPPORTED", "扩展生命周期事务不可用", "addon-lifecycle-unavailable");
      const operation = await service.mutate(request.params.serverId, request.params.addonId, action,
        request.body.revision, requireIdempotencyKey(request.headers["idempotency-key"]));
      reply.header("Cache-Control", "no-store");
      return reply.code(202).send({ data: { operation }, meta: responseMeta(request.id, clock, mode) });
    });
  };
  registerMutation("disable"); registerMutation("enable"); registerMutation("trash");
  app.post<{ Params: TrashParams; Body: AddonLifecycleRequest }>("/api/v1/servers/:serverId/addons/trash/:trashId/restore", {
    preHandler: installWriteRequestGuard(clock, mode),
    schema: { params: trashParamsSchema, body: addonLifecycleRequestSchema, response: { 202: lifecycleActionResponseSchema, ...lifecycleErrors } }
  }, async (request, reply) => {
    if (!service) throw new DomainError(501, "ADDON_UNSUPPORTED", "扩展生命周期事务不可用", "addon-lifecycle-unavailable");
    const operation = await service.restore(request.params.serverId, request.params.trashId,
      request.body.revision, requireIdempotencyKey(request.headers["idempotency-key"]));
    reply.header("Cache-Control", "no-store");
    return reply.code(202).send({ data: { operation }, meta: responseMeta(request.id, clock, mode) });
  });
}

export function registerAddonUploadRoutes(app: FastifyInstance, service: AddonUploadService, clock: Clock, mode: Mode): void {
  void app.register(async (uploads) => {
    uploads.addContentTypeParser("application/java-archive", (_request, payload, done) => done(null, payload));
    uploads.post<{ Params: ServerParams; Body: Readable }>("/api/v1/servers/:serverId/addons/uploads", {
      onRequest: async (request) => {
        if (!request.headers.origin || request.headers["x-manager-intent"] !== "local-ui") {
          throw new DomainError(403, "ORIGIN_REJECTED", "扩展上传需要本地操作意图", "addon-upload-intent-required");
        }
        if (request.headers["content-type"] !== "application/java-archive" || request.headers["content-encoding"] !== undefined) {
          throw new DomainError(415, "UNSUPPORTED_FILE_TYPE", "上传必须是未编码的 application/java-archive", "invalid-addon-content-type");
        }
        const length = request.headers["content-length"];
        if (length !== undefined && (!/^\d+$/u.test(length) || Number(length) > 64 * 1024 ** 2)) {
          throw new DomainError(413, "UPLOAD_TOO_LARGE", "JAR 文件不能超过 64 MiB", "addon-upload-limit");
        }
        if (Object.keys(request.query as object).length) throw new DomainError(400, "VALIDATION_ERROR", "上传不接受路径或查询参数", "unexpected-addon-query");
      },
      schema: { params: serverParamsSchema, response: { 201: addonUploadResponseSchema,
        ...Object.fromEntries([400,403,404,408,409,413,415,429,422,500,501,507].map((code) => [code,apiErrorResponseSchema])) } }
    }, async (request, reply) => {
      const header = request.headers["x-upload-filename"];
      let filename: string;
      try { if (typeof header !== "string" || header.length > 1536) throw new Error("bad filename"); filename = decodeURIComponent(header); }
      catch { throw new DomainError(400, "VALIDATION_ERROR", "上传文件名无效", "invalid-addon-filename"); }
      const data = await service.upload(request.params.serverId, filename, request.body);
      reply.header("Cache-Control", "no-store");
      return reply.code(201).send({ data, meta: responseMeta(request.id, clock, mode) });
    });
  });
}

export function registerAddonInstallRoutes(app: FastifyInstance, service: AddonInstallService | undefined, clock: Clock, mode: Mode): void {
  app.post<{ Params: ServerParams; Body: AddonInstallRequest }>("/api/v1/servers/:serverId/addons/install", {
    preHandler: installWriteRequestGuard(clock, mode),
    schema: { params: serverParamsSchema, body: addonInstallRequestSchema, response: { 202: lifecycleActionResponseSchema,
      ...Object.fromEntries([400,403,404,409,415,428,500,501,507].map((code) => [code,apiErrorResponseSchema])) } }
  }, async (request, reply) => {
    if (!service) throw new DomainError(501, "ADDON_UNSUPPORTED", "扩展安装事务不可用", "addon-install-unavailable");
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(key)) {
      throw new DomainError(428, "PRECONDITION_REQUIRED", "安装需要 UUID Idempotency-Key", "addon-idempotency-required");
    }
    const operation = await service.install(request.params.serverId, request.body, key.toLowerCase());
    reply.header("Cache-Control", "no-store");
    return reply.code(202).send({ data: { operation }, meta: responseMeta(request.id, clock, mode) });
  });
}
