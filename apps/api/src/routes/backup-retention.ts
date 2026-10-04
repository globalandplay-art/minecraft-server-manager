import { apiErrorResponseSchema, backupRetentionResponseSchema, backupRetentionUpdateSchema, backupRetentionRunRequestSchema,
  serverParamsSchema, type BackupRetentionUpdate, type BackupRetentionRunRequest, type ServerParams, type Mode } from "@mcsm/contracts";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import type { Clock } from "../clock.js";
import { installWriteRequestGuard, responseMeta } from "../infra/http.js";
import { DomainError } from "../services/domain-errors.js";
import type { BackupRetentionService } from "../services/backup-retention-service.js";

export function registerBackupRetentionRoutes(app: FastifyInstance, service: BackupRetentionService, clock: Clock, mode: Mode): void {
  const errors = { 400: apiErrorResponseSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema, 409: apiErrorResponseSchema, 415: apiErrorResponseSchema, 500: apiErrorResponseSchema, 501: apiErrorResponseSchema };
  const response = { 200: backupRetentionResponseSchema, ...errors }, guard = installWriteRequestGuard(clock, mode);
  const url = "/api/v1/servers/:serverId/backup-retention";
  app.get<{ Params: ServerParams }>(url, { schema: { params: serverParamsSchema, response } }, async (request, reply) => {
    reply.header("Cache-Control", "no-store"); return { data: await service.get(request.params.serverId), meta: responseMeta(request.id, clock, mode) };
  });
  app.post<{ Params: ServerParams; Body: BackupRetentionUpdate }>(url, {
    preValidation: async (request) => { if (!Value.Check(backupRetentionUpdateSchema, request.body)) throw new DomainError(400, "VALIDATION_ERROR", "保留策略格式无效"); },
    preHandler: guard, schema: { params: serverParamsSchema, body: backupRetentionUpdateSchema, response }
  }, async (request) => ({ data: await service.update(request.params.serverId, request.body), meta: responseMeta(request.id, clock, mode) }));
  app.post<{ Params: ServerParams; Body: BackupRetentionRunRequest }>(url + "/run", {
    preValidation: async (request) => { if (!Value.Check(backupRetentionRunRequestSchema, request.body)) throw new DomainError(400, "VALIDATION_ERROR", "需要明确保留策略执行意图"); },
    preHandler: guard, schema: { params: serverParamsSchema, body: backupRetentionRunRequestSchema, response }
  }, async (request) => ({ data: await service.run(request.params.serverId, request.body), meta: responseMeta(request.id, clock, mode) }));
}
