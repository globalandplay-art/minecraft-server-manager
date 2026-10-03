import {
  apiErrorResponseSchema, backupParamsSchema, lifecycleActionResponseSchema, operationParamsSchema,
  restorePlanResponseSchema, restoreRequestSchema, rollbackRequestSchema, restoreHistoryResponseSchema, serverParamsSchema,
  type BackupParams, type RestoreRequest, type RollbackRequest, type ServerParams
} from "@mcsm/contracts";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { Clock } from "../clock.js";
import type { Mode } from "@mcsm/contracts";
import { installWriteRequestGuard, responseMeta } from "../infra/http.js";
import { DomainError } from "../services/domain-errors.js";
import type { RestoreService } from "../services/restore-service.js";

const errors = Object.fromEntries([400, 403, 404, 409, 413, 415, 428, 500, 501, 507].map((code) => [code, apiErrorResponseSchema]));
const rollbackParams = Type.Object({ ...serverParamsSchema.properties, ...operationParamsSchema.properties }, { additionalProperties: false });
function key(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new DomainError(428, "PRECONDITION_REQUIRED", "恢复操作需要 UUID Idempotency-Key", "idempotency-key-required");
  }
  return value.toLowerCase();
}
export function registerRestoreRoutes(app: FastifyInstance, service: RestoreService, clock: Clock, mode: Mode): void {
  const guard = installWriteRequestGuard(clock, mode);
  const meta = (id: string) => responseMeta(id, clock, mode);
  app.get<{ Params: ServerParams }>("/api/v1/servers/:serverId/restores", { schema: { params: serverParamsSchema, response: { 200: restoreHistoryResponseSchema, ...errors } } }, async (req, reply) => {
    reply.header("Cache-Control", "no-store"); return { data: await service.history(req.params.serverId), meta: meta(req.id) };
  });
  app.get<{ Params: BackupParams }>("/api/v1/servers/:serverId/backups/:backupId/restore", { schema: { params: backupParamsSchema, response: { 200: restorePlanResponseSchema, ...errors } } }, async (req, reply) => {
    reply.header("Cache-Control", "no-store"); return { data: await service.plan(req.params.serverId, req.params.backupId), meta: meta(req.id) };
  });
  app.post<{ Params: BackupParams; Body: RestoreRequest }>("/api/v1/servers/:serverId/backups/:backupId/restore", {
    preValidation: async (req) => {
      if (req.body && Object.keys(req.body).some((name) => !["restoreScope", "confirmWorldName", "worldRevision", "allowStop", "startAfterRestore"].includes(name))) throw new DomainError(400, "VALIDATION_ERROR", "恢复请求不接受路径或其他字段", "unexpected-restore-field");
    },
    preHandler: guard, schema: { params: backupParamsSchema, body: restoreRequestSchema, response: { 202: lifecycleActionResponseSchema, ...errors } }
  }, async (req, reply) => reply.code(202).send({ data: { operation: await service.restore(req.params.serverId, req.params.backupId, req.body, key(req.headers["idempotency-key"])) }, meta: meta(req.id) }));
  app.get<{ Params: { serverId: string; operationId: string } }>("/api/v1/servers/:serverId/operations/:operationId/rollback", {
    schema: { params: rollbackParams, response: { 200: restorePlanResponseSchema, ...errors } }
  }, async (req, reply) => { reply.header("Cache-Control", "no-store"); return { data: await service.rollbackPlan(req.params.serverId, req.params.operationId), meta: meta(req.id) }; });
  app.post<{ Params: { serverId: string; operationId: string }; Body: RollbackRequest }>("/api/v1/servers/:serverId/operations/:operationId/rollback", {
    preValidation: async (req) => {
      if (req.body && Object.keys(req.body).some((name) => !["confirmWorldName", "worldRevision", "startAfterRollback"].includes(name))) throw new DomainError(400, "VALIDATION_ERROR", "回滚请求不接受路径或其他字段", "unexpected-rollback-field");
    },
    preHandler: guard, schema: { params: rollbackParams, body: rollbackRequestSchema, response: { 202: lifecycleActionResponseSchema, ...errors } }
  }, async (req, reply) => reply.code(202).send({ data: { operation: await service.rollback(req.params.serverId, req.params.operationId, req.body, key(req.headers["idempotency-key"])) }, meta: meta(req.id) }));
}
