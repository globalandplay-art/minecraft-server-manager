import { apiErrorResponseSchema, backupScheduleResponseSchema, backupScheduleUpdateSchema, serverParamsSchema,
  type BackupScheduleUpdate, type ServerParams, type Mode } from "@mcsm/contracts";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import type { Clock } from "../clock.js";
import { installWriteRequestGuard, responseMeta } from "../infra/http.js";
import { DomainError } from "../services/domain-errors.js";
import type { BackupScheduleService } from "../services/backup-schedule-service.js";

export function registerBackupScheduleRoutes(app: FastifyInstance, service: BackupScheduleService, clock: Clock, mode: Mode): void {
  const errors = { 400: apiErrorResponseSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema, 409: apiErrorResponseSchema, 415: apiErrorResponseSchema, 500: apiErrorResponseSchema, 501: apiErrorResponseSchema };
  const url = "/api/v1/servers/:serverId/backup-schedule";
  app.get<{ Params: ServerParams }>(url, { schema: { params: serverParamsSchema, response: { 200: backupScheduleResponseSchema, ...errors } } }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { data: await service.get(request.params.serverId), meta: responseMeta(request.id, clock, mode) };
  });
  app.post<{ Params: ServerParams; Body: BackupScheduleUpdate }>(url, {
    preValidation: async (request) => { if (!Value.Check(backupScheduleUpdateSchema, request.body)) throw new DomainError(400, "VALIDATION_ERROR", "计划请求格式无效", "invalid-schedule-request"); },
    preHandler: installWriteRequestGuard(clock, mode),
    schema: { params: serverParamsSchema, body: backupScheduleUpdateSchema, response: { 200: backupScheduleResponseSchema, ...errors } }
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { data: await service.update(request.params.serverId, request.body), meta: responseMeta(request.id, clock, mode) };
  });
}
