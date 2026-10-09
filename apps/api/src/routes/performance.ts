import { apiErrorResponseSchema, performanceResponseSchema, serverParamsSchema,
  type ApiErrorResponse, type Mode, type PerformanceResponse, type ServerParams } from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";
import type { Clock } from "../clock.js";
import { errorResponse, responseMeta } from "../infra/http.js";
import type { PerformanceService } from "../services/performance-service.js";
import { ServerNotFoundError } from "../services/server-service.js";

export function registerPerformanceRoutes(app: FastifyInstance, service: PerformanceService, clock: Clock, mode: Mode): void {
  app.get<{ Params: ServerParams; Reply: PerformanceResponse | ApiErrorResponse }>("/api/v1/servers/:serverId/performance", {
    schema: { params: serverParamsSchema, response: { 200: performanceResponseSchema,
      400: apiErrorResponseSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema, 500: apiErrorResponseSchema } }
  }, async (request, reply) => {
    try { return { data: await service.read(request.params.serverId), meta: responseMeta(request.id, clock, mode) }; }
    catch (error) {
      if (!(error instanceof ServerNotFoundError)) throw error;
      return reply.code(404).send(errorResponse(request.id, clock, "SERVER_NOT_FOUND", "未找到指定的服务器实例", mode));
    }
  });
}
