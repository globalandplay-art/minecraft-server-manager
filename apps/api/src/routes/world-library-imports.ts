import { apiErrorResponseSchema, lifecycleActionResponseSchema, serverParamsSchema, worldImportPlanRequestSchema,
  worldLibraryImportPlanResponseSchema, worldLibraryImportRequestSchema, type Mode, type ServerParams,
  type WorldImportPlanRequest, type WorldLibraryImportRequest } from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";
import type { HttpAuthentication } from "../auth/http-auth.js";
import type { Clock } from "../clock.js";
import { installWriteRequestGuard, responseMeta } from "../infra/http.js";
import { DomainError } from "../services/domain-errors.js";
import type { WorldLibraryImportService } from "../services/world-library-import-service.js";

/** Only mount after controller recovery/source safety Gates have passed. */
export function registerWorldLibraryImportRoutes(app: FastifyInstance, service: WorldLibraryImportService,
  clock: Clock, mode: Mode, authentication?: Pick<HttpAuthentication, "assertMutation">): void {
  const errors = Object.fromEntries([400, 401, 403, 404, 409, 428, 500, 501, 507].map(code => [code, apiErrorResponseSchema]));
  const strict = (value: unknown, keys: readonly string[]) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length ||
        Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => typeof (value as Record<string, unknown>)[key] !== "string")) {
      throw new DomainError(400, "VALIDATION_ERROR", "Invalid independent world import request", "invalid-library-import-request");
    }
  };
  const guard = installWriteRequestGuard(clock, mode);
  app.post<{ Params: ServerParams; Body: WorldImportPlanRequest }>("/api/v1/servers/:serverId/world-library/import-plan", {
    preValidation: async request => strict(request.body, ["name", "uploadId"]), preHandler: guard,
    schema: { params: serverParamsSchema, body: worldImportPlanRequestSchema, response: { 200: worldLibraryImportPlanResponseSchema, ...errors } }
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const plan = await service.plan(request.params.serverId, request.body);
    return { data: { ...plan, executionAvailable: true, serverMustBeStopped: true, changesActiveWorld: false }, meta: responseMeta(request.id, clock, mode) };
  });
  app.post<{ Params: ServerParams; Body: WorldLibraryImportRequest }>("/api/v1/servers/:serverId/world-library/import", {
    preValidation: async request => strict(request.body, ["name", "uploadId", "mode", "uploadRevision", "libraryRevision", "currentWorldId", "currentWorldRevision"]), preHandler: guard,
    schema: { params: serverParamsSchema, body: worldLibraryImportRequestSchema, response: { 202: lifecycleActionResponseSchema, ...errors } }
  }, async (request, reply) => {
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(key)) {
      throw new DomainError(428, "PRECONDITION_REQUIRED", "A UUID Idempotency-Key is required", "idempotency-key-required");
    }
    const operation = await service.importIndependent(request.params.serverId, request.body, key.toLowerCase(),
      authentication ? () => { authentication.assertMutation(request); return undefined; } : undefined);
    return reply.code(202).send({ data: { operation }, meta: responseMeta(request.id, clock, mode) });
  });
}
