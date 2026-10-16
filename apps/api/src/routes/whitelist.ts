import { apiErrorResponseSchema, serverParamsSchema, whitelistResponseSchema, type ServerParams, type Mode } from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";
import type { Clock } from "../clock.js";
import { responseMeta } from "../infra/http.js";
import type { WhitelistService } from "../services/whitelist-service.js";
export function registerWhitelistRoutes(app: FastifyInstance, service: WhitelistService, clock: Clock, mode: Mode): void {
  app.get<{ Params: ServerParams }>("/api/v1/servers/:serverId/whitelist", {
    schema: { params: serverParamsSchema, response: { 200: whitelistResponseSchema, 400: apiErrorResponseSchema,
      401: apiErrorResponseSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema, 500: apiErrorResponseSchema } }
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { data: await service.read(request.params.serverId), meta: responseMeta(request.id, clock, mode) };
  });
}
