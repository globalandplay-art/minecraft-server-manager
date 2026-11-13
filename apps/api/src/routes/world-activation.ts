import { apiErrorResponseSchema, lifecycleActionResponseSchema, serverParamsSchema, worldActivationApprovalSchema,
  worldActivationPlanRequestSchema, worldActivationPlanResponseSchema, type Mode, type ServerParams,
  type WorldActivationApproval, type WorldActivationPlanRequest } from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";
import type { HttpAuthentication } from "../auth/http-auth.js";
import type { Clock } from "../clock.js";
import { installWriteRequestGuard, responseMeta } from "../infra/http.js";
import { DomainError } from "../services/domain-errors.js";
import type { WorldActivationPlanService } from "../services/world-activation-plan-service.js";
import type { WorldActivationService } from "../services/world-activation-service.js";

/** Mounted only by explicit trusted application construction; main leaves it
 * disabled. Preparation-only construction reports executionAvailable=false. */
export function registerWorldActivationRoutes(app: FastifyInstance, plans: Pick<WorldActivationPlanService, "plan">,
  clock: Clock, mode: Mode, authentication?: Pick<HttpAuthentication, "assertMutation">,
  executor?: Pick<WorldActivationService, "activate">): void {
  const errors = Object.fromEntries([400, 401, 403, 404, 409, 428, 500, 501, 507].map(code => [code, apiErrorResponseSchema]));
  const strict = (value: unknown, keys: readonly string[]) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length ||
        Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => typeof (value as Record<string, unknown>)[key] !== "string")) {
      throw new DomainError(400, "VALIDATION_ERROR", "Invalid world activation request", "world-activation-invalid-request");
    }
  };
  const guard = installWriteRequestGuard(clock, mode);
  app.post<{ Params: ServerParams; Body: WorldActivationPlanRequest }>("/api/v1/servers/:serverId/world-library/activation-plan", {
    preValidation: async request => strict(request.body, ["worldId"]), preHandler: guard,
    schema: { params: serverParamsSchema, body: worldActivationPlanRequestSchema, response: { 200: worldActivationPlanResponseSchema, ...errors } }
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const plan = await plans.plan(request.params.serverId, request.body.worldId);
    return { data: { ...plan, executionAvailable: Boolean(executor), unavailableReason: executor ? null : "ACTIVATION_TRANSACTION_PENDING" },
      meta: responseMeta(request.id, clock, mode) };
  });
  app.post<{ Params: ServerParams; Body: WorldActivationApproval }>("/api/v1/servers/:serverId/world-library/activate", {
    preValidation: async request => strict(request.body, Object.keys(worldActivationApprovalSchema.properties)), preHandler: guard,
    schema: { params: serverParamsSchema, body: worldActivationApprovalSchema, response: { 202: lifecycleActionResponseSchema, ...errors } }
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!executor) throw new DomainError(409, "ACTION_UNAVAILABLE", "World activation is not available", "world-activation-api-pending");
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(key)) {
      throw new DomainError(428, "PRECONDITION_REQUIRED", "A UUID Idempotency-Key is required", "idempotency-key-required");
    }
    const operation = await executor.activate(request.params.serverId, request.body, key.toLowerCase(),
      authentication ? () => { authentication.assertMutation(request); return undefined; } : undefined);
    return reply.code(202).send({ data: { operation }, meta: responseMeta(request.id, clock, mode) });
  });
}
