import { apiErrorResponseSchema, crashAnalysisResponseSchema, serverParamsSchema,
  type Mode, type ServerParams } from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";
import type { Clock } from "../clock.js";
import { errorResponse, responseMeta } from "../infra/http.js";
import type { CrashAnalysisService } from "../services/crash-analysis-service.js";
import { DomainError } from "../services/domain-errors.js";
import { ServerNotFoundError } from "../services/server-service.js";

export function registerCrashAnalysisRoutes(app: FastifyInstance, service: CrashAnalysisService, clock: Clock, mode: Mode) {
  app.get<{ Params: ServerParams }>("/api/v1/servers/:serverId/crash-analysis", {
    onRequest: async (_request, reply) => { reply.header("Cache-Control", "no-store"); },
    preValidation: async (request) => {
      if (Object.keys(request.query as object).length) throw new DomainError(400, "CRASH_QUERY_UNSUPPORTED", "此接口不接受查询参数", "crash-query-unsupported");
    },
    schema: { params: serverParamsSchema, response: { 200: crashAnalysisResponseSchema,
      400: apiErrorResponseSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema,
      409: apiErrorResponseSchema, 500: apiErrorResponseSchema } }
  }, async (request, reply) => {
    try { return { data: await service.read(request.params.serverId), meta: responseMeta(request.id, clock, mode) }; }
    catch (error) {
      if (!(error instanceof ServerNotFoundError)) throw error;
      return reply.code(404).send(errorResponse(request.id, clock, "SERVER_NOT_FOUND", "未找到指定的服务器实例", mode));
    }
  });
}
