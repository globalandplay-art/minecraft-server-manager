import { apiErrorResponseSchema, lifecycleActionResponseSchema, operationResponseSchema, serverParamsSchema,
  worldReplacementApprovalSchema, worldReplacementPlanRequestSchema, worldReplacementPlanResponseSchema,
  worldReplacementVerificationRequestSchema, type Mode, type ServerParams, type WorldReplacementApproval,
  type WorldReplacementPlanRequest, type WorldReplacementVerificationRequest } from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";
import type { HttpAuthentication } from "../auth/http-auth.js";
import type { Clock } from "../clock.js";
import { installWriteRequestGuard, responseMeta } from "../infra/http.js";
import { DomainError } from "../services/domain-errors.js";
import type { WorldLibraryImportService } from "../services/world-library-import-service.js";
import type { WorldReplacementRecovery } from "../services/world-replacement-recovery.js";
import type { WorldReplacementService } from "../services/world-replacement-service.js";

/** Trusted app construction only. Default preview stays closed; neither request
 * fields nor environment variables select an executor or a proof provider. */
export function registerWorldReplacementRoutes(app: FastifyInstance, plans: Pick<WorldLibraryImportService, "planReplacement">,
  clock: Clock, mode: Mode, authentication?: Pick<HttpAuthentication, "assertMutation">,
  executor?: Pick<WorldReplacementService, "plan" | "replace">, recovery?: Pick<WorldReplacementRecovery, "verify">): void {
  const errors = Object.fromEntries([400, 401, 403, 404, 409, 415, 428, 500, 501, 503, 507].map(code => [code, apiErrorResponseSchema]));
  const strict = (value: unknown, keys: readonly string[]) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length ||
        Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => typeof (value as Record<string, unknown>)[key] !== "string")) {
      throw new DomainError(400, "VALIDATION_ERROR", "Invalid world replacement request", "world-replacement-invalid-request");
    }
  };
  const guard = installWriteRequestGuard(clock, mode);
  const unavailable = () => new DomainError(409, "ACTION_UNAVAILABLE", "World replacement is not available", "world-replacement-api-pending");
  app.post<{ Params: ServerParams; Body: WorldReplacementPlanRequest }>("/api/v1/servers/:serverId/world-library/replacement-plan", {
    preValidation: async request => strict(request.body, ["uploadId"]), preHandler: guard,
    schema: { params: serverParamsSchema, body: worldReplacementPlanRequestSchema, response: { 200: worldReplacementPlanResponseSchema, ...errors } }
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const enabled = Boolean(executor && recovery);
    const plan = enabled ? await executor!.plan(request.params.serverId, request.body) : await plans.planReplacement(request.params.serverId, request.body);
    return { data: { ...plan, executionAvailable: enabled, unavailableReason: enabled ? null : "REPLACEMENT_TRANSACTION_PENDING" }, meta: responseMeta(request.id, clock, mode) };
  });
  // Preserve the existing default: no executable route until trusted enablement.
  if (!executor || !recovery) return;
  app.post<{ Params: ServerParams; Body: WorldReplacementApproval }>("/api/v1/servers/:serverId/world-library/replace", {
    preValidation: async request => strict(request.body, Object.keys(worldReplacementApprovalSchema.properties)), preHandler: guard,
    schema: { params: serverParamsSchema, body: worldReplacementApprovalSchema, response: { 202: lifecycleActionResponseSchema, ...errors } }
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!executor || !recovery) throw unavailable();
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(key)) {
      throw new DomainError(428, "PRECONDITION_REQUIRED", "A UUID Idempotency-Key is required", "idempotency-key-required");
    }
    const operation = await executor.replace(request.params.serverId, request.body, key.toLowerCase(), () => {
      authentication?.assertMutation(request); return undefined;
    });
    return reply.code(202).send({ data: { operation }, meta: responseMeta(request.id, clock, mode) });
  });
  app.post<{ Params: ServerParams; Body: WorldReplacementVerificationRequest }>("/api/v1/servers/:serverId/world-library/replacement-verification", {
    preValidation: async request => strict(request.body, Object.keys(worldReplacementVerificationRequestSchema.properties)), preHandler: guard,
    schema: { params: serverParamsSchema, body: worldReplacementVerificationRequestSchema, response: { 200: operationResponseSchema, ...errors } }
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!executor || !recovery) throw unavailable();
    const operation = await recovery.verify(request.params.serverId, request.body.operationId, () => {
      authentication?.assertMutation(request); return undefined;
    }, true);
    return { data: operation, meta: responseMeta(request.id, clock, mode) };
  });
}
