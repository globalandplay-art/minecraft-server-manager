import { worldGenerationFinalizeResponseSchema, worldGenerationTargetResponseSchema, apiErrorResponseSchema, serverParamsSchema, worldCreatePlanRequestSchema, worldCreatePlanResponseSchema,
  worldCreateRequestSchema, lifecycleActionResponseSchema,
  type Mode, type ServerParams, type WorldCreatePlanRequest, type WorldCreateRequest } from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";
import type { Clock } from "../clock.js";
import { installWriteRequestGuard, responseMeta } from "../infra/http.js";
import { DomainError } from "../services/domain-errors.js";
import type { WorldCreatePlanService } from "../services/world-create-plan-service.js";
import type { WorldCreateService } from "../services/world-create-service.js";
import type { HttpAuthentication } from "../auth/http-auth.js";
import type { WorldGenerationService } from "../services/world-generation-service.js";

export function registerWorldGenerationRoute(app: FastifyInstance, generation: Pick<WorldGenerationService, "generate" | "executionTarget" | "finalizePublishedGeneration">,
  clock: Clock, mode: Mode, authentication: Pick<HttpAuthentication, "assertMutation">): void {
  app.post<{ Params: ServerParams; Body: { executionOperationId: string } }>("/api/v1/servers/:serverId/worlds/generation-finalize", {
    preValidation: async request => {
      const body: unknown = request.body;
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).length !== 1 || !("executionOperationId" in body) || typeof body.executionOperationId !== "string") {
        throw new DomainError(400, "VALIDATION_ERROR", "Invalid generation finalization request", "generation-finalize-invalid-request");
      }
    },
    preHandler: installWriteRequestGuard(clock, mode),
    schema: { params: serverParamsSchema, response: { 200: worldGenerationFinalizeResponseSchema }, body: {
      type: "object", additionalProperties: false, required: ["executionOperationId"],
      properties: { executionOperationId: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" } }
    } }
  }, async (request, reply) => {
    const admission = () => { authentication.assertMutation(request); return undefined; };
    admission();
    const result = await generation.finalizePublishedGeneration(request.params.serverId, request.body.executionOperationId, admission);
    return reply.header("Cache-Control", "no-store").send({
      data: { serverId: result.serverId, operationId: result.operationId, worldId: result.worldId,
        inspectionOnly: result.inspectionOnly, recoveryRequired: result.recoveryRequired },
      meta: responseMeta(request.id, clock, mode)
    });
  });
  app.post<{ Params: ServerParams }>("/api/v1/servers/:serverId/worlds/generation-target", {
    preHandler: installWriteRequestGuard(clock, mode),
    schema: { params: serverParamsSchema, body: { type: "object", maxProperties: 0 }, response: { 200: worldGenerationTargetResponseSchema } }
  }, async (request, reply) => {
    const admission = () => { authentication.assertMutation(request); return undefined; };
    const data = await generation.executionTarget(request.params.serverId, admission);
    return reply.header("Cache-Control", "no-store").send({ data, meta: responseMeta(request.id, clock, mode) });
  });
  app.post<{ Params: ServerParams; Body: unknown }>("/api/v1/servers/:serverId/worlds/generate", {
    preHandler: installWriteRequestGuard(clock, mode),
    schema: { params: serverParamsSchema, response: { 202: lifecycleActionResponseSchema } }
  }, async (request, reply) => {
    const admission = () => { authentication.assertMutation(request); return undefined; };
    admission();
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(key)) {
      throw new DomainError(428, "PRECONDITION_REQUIRED", "A UUID Idempotency-Key is required", "idempotency-key-required");
    }
    const operation = await generation.generate(request.params.serverId, key.toLowerCase(), request.body, admission);
    return reply.header("Cache-Control", "no-store").code(202)
      .send({ data: { operation }, meta: responseMeta(request.id, clock, mode) });
  });
}

export function registerFirstManagedWorldRoutes(app: FastifyInstance,
  generation: Pick<WorldGenerationService, "startFirstManagedWorld" | "stopFirstManagedWorld">,
  clock: Clock, mode: Mode, authentication: Pick<HttpAuthentication, "assertMutation">): void {
  for (const action of ["start", "stop"] as const) {
    const idField = action === "start" ? "executionOperationId" : "startOperationId";
    app.post<{ Params: ServerParams; Body: Record<string, unknown> }>(`/api/v1/servers/:serverId/worlds/first-managed-${action}`, {
      preValidation: async request => {
        const body = request.body;
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 2 ||
            body.confirm !== true || typeof body[idField] !== "string") {
          throw new DomainError(400, "VALIDATION_ERROR", "Invalid managed world request", "managed-world-request-invalid");
        }
      },
      preHandler: installWriteRequestGuard(clock, mode),
      schema: { params: serverParamsSchema, body: { type: "object", additionalProperties: false,
        required: [idField, "confirm"], properties: { confirm: { const: true }, [idField]: { type: "string",
          pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" } } },
        response: { 202: lifecycleActionResponseSchema } }
    }, async (request, reply) => {
      const admission = (): undefined => { authentication.assertMutation(request); return undefined; };
      admission();
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(key)) {
        throw new DomainError(428, "PRECONDITION_REQUIRED", "A UUID Idempotency-Key is required", "idempotency-key-required");
      }
      const execute = action === "start" ? generation.startFirstManagedWorld.bind(generation) : generation.stopFirstManagedWorld.bind(generation);
      const operation = await execute(request.params.serverId, request.body[idField] as string, key.toLowerCase(), admission);
      admission();
      return reply.header("Cache-Control", "no-store").code(202).send({ data: { operation }, meta: responseMeta(request.id, clock, mode) });
    });
  }
}

export function registerWorldCreatePlanRoutes(app: FastifyInstance, service: WorldCreatePlanService, clock: Clock, mode: Mode, writer?: WorldCreateService,
  authentication?: Pick<HttpAuthentication, "assertMutation">): void {
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
    const operation = await writer.create(req.params.serverId, req.body, key.toLowerCase(), () => {
      authentication?.assertMutation(req);
      return undefined;
    });
    return reply.code(202).send({ data: { operation }, meta: responseMeta(req.id, clock, mode) });
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
