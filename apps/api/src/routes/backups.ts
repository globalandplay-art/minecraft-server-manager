import {
  apiErrorResponseSchema,
  backupCreateRequestSchema,
  backupParamsSchema,
  backupExportResponseSchema,
  backupsResponseSchema,
  lifecycleActionResponseSchema,
  serverParamsSchema,
  type BackupCreateRequest,
  type BackupParams,
  type ServerParams
} from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";

import type { Clock } from "../clock.js";
import { installWriteRequestGuard, responseMeta } from "../infra/http.js";
import { DomainError } from "../services/domain-errors.js";
import type { BackupService } from "../services/backup-service.js";
import type { BackupExportService } from "../services/backup-export-service.js";
import type { Mode } from "@mcsm/contracts";

function idempotencyKey(value: string | string[] | undefined): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new DomainError(428, "PRECONDITION_REQUIRED", "备份需要 UUID Idempotency-Key", "idempotency-key-required");
  }
  return value.toLowerCase();
}

export function registerBackupRoutes(app: FastifyInstance, service: BackupService, clock: Clock, mode: Mode, exports?: BackupExportService): void {
  const writeGuard = installWriteRequestGuard(clock, mode);
  const exportErrors = { 400: apiErrorResponseSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema, 413: apiErrorResponseSchema,
    409: apiErrorResponseSchema, 428: apiErrorResponseSchema, 500: apiErrorResponseSchema, 501: apiErrorResponseSchema, 507: apiErrorResponseSchema };
  if (exports) {
    app.post<{ Params: BackupParams; Body: Record<string, never> }>("/api/v1/servers/:serverId/backups/:backupId/exports", {
      preValidation: async (request) => {
        if (request.body && Object.keys(request.body).length !== 0) {
          throw new DomainError(400, "VALIDATION_ERROR", "导出请求不接受文件路径或文件名。", "unexpected-export-field");
        }
      },
      preHandler: writeGuard,
      schema: { params: backupParamsSchema, body: { type: "object", properties: {}, additionalProperties: false },
        response: { 202: lifecycleActionResponseSchema, ...exportErrors } }
    }, async (request, reply) => {
      const operation = await exports.request(request.params.serverId, request.params.backupId, idempotencyKey(request.headers["idempotency-key"]));
      return reply.code(202).send({ data: { operation }, meta: responseMeta(request.id, clock, mode) });
    });
    app.get<{ Params: BackupParams }>("/api/v1/servers/:serverId/backups/:backupId/exports", {
      schema: { params: backupParamsSchema, response: { 200: backupExportResponseSchema, ...exportErrors } }
    }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return { data: await exports.status(request.params.serverId, request.params.backupId), meta: responseMeta(request.id, clock, mode) };
    });
    app.get<{ Params: BackupParams }>("/api/v1/servers/:serverId/backups/:backupId/download", {
      schema: { params: backupParamsSchema, response: exportErrors }
    }, async (request, reply) => {
      const artifact = await exports.download(request.params.serverId, request.params.backupId);
      return reply.type("application/zip").header("Content-Disposition", `attachment; filename="${artifact.filename}"`)
        .header("Content-Length", artifact.sizeBytes).header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff").header("X-Archive-SHA256", artifact.checksumSha256).send(artifact.stream);
    });
  }
  app.get<{ Params: ServerParams }>("/api/v1/servers/:serverId/backups", {
    schema: {
      params: serverParamsSchema,
      response: {
        200: backupsResponseSchema,
        400: apiErrorResponseSchema,
        403: apiErrorResponseSchema,
        404: apiErrorResponseSchema,
        409: apiErrorResponseSchema,
        500: apiErrorResponseSchema,
        501: apiErrorResponseSchema
      }
    }
  }, async (request) => ({
    data: { items: await service.list(request.params.serverId), nextCursor: null },
    meta: responseMeta(request.id, clock, mode)
  }));

  app.post<{ Params: ServerParams; Body: BackupCreateRequest }>("/api/v1/servers/:serverId/backups", {
    preHandler: writeGuard,
    schema: {
      params: serverParamsSchema,
      body: backupCreateRequestSchema,
      response: {
        202: lifecycleActionResponseSchema,
        400: apiErrorResponseSchema,
        403: apiErrorResponseSchema,
        404: apiErrorResponseSchema,
        409: apiErrorResponseSchema,
        413: apiErrorResponseSchema,
        415: apiErrorResponseSchema,
        428: apiErrorResponseSchema,
        500: apiErrorResponseSchema,
        507: apiErrorResponseSchema,
        501: apiErrorResponseSchema
      }
    }
  }, async (request, reply) => {
    const operation = await service.create(
      request.params.serverId,
      request.body,
      idempotencyKey(request.headers["idempotency-key"])
    );
    return reply.code(202).send({
      data: { operation },
      meta: responseMeta(request.id, clock, mode)
    });
  });
}
