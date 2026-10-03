import { apiErrorResponseSchema, serverParamsSchema, worldCreatePlanRequestSchema, worldCreatePlanResponseSchema,
  worldCreateRequestSchema, lifecycleActionResponseSchema,
  type Mode, type ServerParams, type WorldCreatePlanRequest, type WorldCreateRequest } from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";
import type { Clock } from "../clock.js";
import { installWriteRequestGuard, responseMeta } from "../infra/http.js";
import { DomainError } from "../services/domain-errors.js";
import type { WorldCreatePlanService } from "../services/world-create-plan-service.js";
import type { WorldCreateService } from "../services/world-create-service.js";

export function registerWorldCreatePlanRoutes(app: FastifyInstance, service: WorldCreatePlanService, clock: Clock, mode: Mode, writer?: WorldCreateService): void {
  if (writer) app.post<{ Params: ServerParams; Body: WorldCreateRequest }>("/api/v1/servers/:serverId/worlds", {
    preValidation: async (req) => {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || typeof req.body.name !== "string" ||
        typeof req.body.seed !== "string" || typeof req.body.confirmWorldName !== "string" || typeof req.body.worldRevision !== "string" || typeof req.body.allowStop !== "boolean" ||
        Object.keys(req.body).some((name) => !["name", "seed", "confirmWorldName", "worldRevision", "allowStop"].includes(name))) {
        throw new DomainError(400, "VALIDATION_ERROR", "新建世界请求格式无效", "invalid-world-create-request");
      }
    },
    preHandler: installWriteRequestGuard(clock, mode), schema: { params: serverParamsSchema, body: worldCreateRequestSchema,
      response: { 202: lifecycleActionResponseSchema, ...Object.fromEntries([400,403,404,409,415,428,500,501,507].map((code) => [code,apiErrorResponseSchema])) } }
  }, async (req, reply) => {
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(key)) {
      throw new DomainError(428, "PRECONDITION_REQUIRED", "新建世界需要 UUID Idempotency-Key", "idempotency-key-required");
    }
    return reply.code(202).send({ data: { operation: await writer.create(req.params.serverId, req.body, key.toLowerCase()) }, meta: responseMeta(req.id, clock, mode) });
  });
  app.post<{ Params: ServerParams; Body: WorldCreatePlanRequest }>("/api/v1/servers/:serverId/worlds/create-plan", {
    preValidation: async (req) => {
      // Reject before AJV coercion; JSON numbers may already have lost seed precision.
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
          typeof req.body.name !== "string" || typeof req.body.seed !== "string" ||
          Object.keys(req.body).some((name) => !["name", "seed"].includes(name))) {
        throw new DomainError(400, "VALIDATION_ERROR", "世界计划不接受路径或其他字段", "unexpected-plan-field");
      }
    },
    preHandler: installWriteRequestGuard(clock, mode),
    schema: { params: serverParamsSchema, body: worldCreatePlanRequestSchema,
      response: { 200: worldCreatePlanResponseSchema, ...Object.fromEntries([400,403,404,409,415,500,501].map((code) => [code,apiErrorResponseSchema])) } }
  }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    return { data: await service.plan(req.params.serverId, req.body), meta: responseMeta(req.id, clock, mode) };
  });
}
