import { accessMethodsResponseSchema, apiErrorResponseSchema, accessMutationRequestSchema,
  accessProviderParamsSchema, accessOperationParamsSchema, accessOperationResponseSchema,
  tailscaleStatusResponseSchema, tailscalePreflightRequestSchema, tailscaleControlResponseSchema } from "@mcsm/contracts";
import type { AccessMutationRequest } from "@mcsm/contracts";
import type { Mode } from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";
import { Value } from "@sinclair/typebox/value";
import type { Clock } from "../clock.js";
import { responseMeta } from "../infra/http.js";
import type { AccessCoordinator } from "../services/access-coordinator.js";
import type { AccessOperationService, AccessProvider } from "../services/access-operation-service.js";
import type { HttpAuthentication } from "../auth/http-auth.js";
import { DomainError } from "../services/domain-errors.js";
import { TailscaleReadError, type TailscaleReadOnlyService } from "../services/tailscale-readonly.js";
import type { TailscaleControlService } from "../services/tailscale-control-service.js";

export function registerAccessRoutes(app: FastifyInstance, coordinator: AccessCoordinator, clock: Clock, mode: Mode,
  operations: AccessOperationService, authentication?: HttpAuthentication, tailscale?: TailscaleReadOnlyService,
  control?: TailscaleControlService): void {
  app.get("/api/v1/access/methods", {
    schema: { response: { 200: accessMethodsResponseSchema, 401: apiErrorResponseSchema,
      403: apiErrorResponseSchema, 503: apiErrorResponseSchema } }
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { data: coordinator.read(), meta: responseMeta(request.id, clock, mode) };
  });
  const requireAuthentication = () => {
    if (!authentication) throw new DomainError(401, "AUTH_REQUIRED", "Authentication required.");
    return authentication;
  };
  const errors = { 400: apiErrorResponseSchema, 401: apiErrorResponseSchema, 403: apiErrorResponseSchema,
    404: apiErrorResponseSchema, 409: apiErrorResponseSchema, 503: apiErrorResponseSchema };
  if (control) app.get("/api/v1/access/tailscale/control", {
    schema: { response: { 200: tailscaleControlResponseSchema, ...errors } }
  }, async (request, reply) => {
    requireAuthentication(); reply.header("Cache-Control", "no-store");
    return { data: await control.read(), meta: responseMeta(request.id, clock, mode) };
  });
  if (tailscale) {
    app.get("/api/v1/access/tailscale", { schema: { response: { 200: tailscaleStatusResponseSchema, ...errors } } }, async (request, reply) => {
      requireAuthentication(); reply.header("Cache-Control", "no-store");
      return { data: tailscale.read(), meta: responseMeta(request.id, clock, mode) };
    });
    app.post("/api/v1/access/tailscale/preflight", {
      preValidation: async (request) => { if (!Value.Check(tailscalePreflightRequestSchema, request.body)) throw new DomainError(400, "VALIDATION_ERROR", "Invalid preflight request."); },
      schema: { body: tailscalePreflightRequestSchema, response: { 200: tailscaleStatusResponseSchema, ...errors } }
    }, async (request, reply) => {
      const auth = requireAuthentication(); auth.assertRecentMutation(request);
      try {
        const data = await tailscale.preflight(); auth.assertRecentMutation(request);
        reply.header("Cache-Control", "no-store"); return { data, meta: responseMeta(request.id, clock, mode) };
      } catch (error) {
        if (error instanceof TailscaleReadError && error.code === "TAILSCALE_CHECK_BUSY") throw new DomainError(409, error.code, "Read-only check already active.");
        throw error;
      }
    });
  }
  const strictBody = async (request: { body: unknown }) => {
    if (!Value.Check(accessMutationRequestSchema, request.body)) {
      throw new DomainError(400, "VALIDATION_ERROR", "Invalid Access request.");
    }
  };
  app.get<{ Params: { id: string } }>("/api/v1/access/operations/:id", {
    schema: { params: accessOperationParamsSchema, response: { 200: accessOperationResponseSchema, ...errors } }
  }, async (request, reply) => {
    requireAuthentication(); reply.header("Cache-Control", "no-store");
    return { data: await operations.get(request.params.id), meta: responseMeta(request.id, clock, mode) };
  });
  for (const action of ["enable", "disable"] as const) {
    app.post<{ Params: { provider: AccessProvider }; Body: AccessMutationRequest }>(`/api/v1/access/:provider/${action}`, {
      preValidation: strictBody,
      schema: { params: accessProviderParamsSchema, body: accessMutationRequestSchema,
        response: { 202: accessOperationResponseSchema, ...errors } }
    }, async (request, reply) => {
      const auth = requireAuthentication(); auth.assertRecentMutation(request);
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string") throw new DomainError(400, "VALIDATION_ERROR", "Idempotency-Key is required.");
      const operation = await operations.submit(request.params.provider, action, request.body, key, () => auth.assertRecentMutation(request));
      reply.code(202).header("Cache-Control", "no-store");
      return { data: operation, meta: responseMeta(request.id, clock, mode) };
    });
  }
  app.post<{ Params: { id: string }; Body: AccessMutationRequest }>("/api/v1/access/operations/:id/recover", {
    preValidation: strictBody,
    schema: { params: accessOperationParamsSchema, body: accessMutationRequestSchema,
      response: { 200: accessOperationResponseSchema, ...errors } }
  }, async (request, reply) => {
    const auth = requireAuthentication(); auth.assertRecentMutation(request);
    const operation = await operations.recover(request.params.id, request.body, () => auth.assertRecentMutation(request));
    reply.header("Cache-Control", "no-store");
    return { data: operation, meta: responseMeta(request.id, clock, mode) };
  });
}
