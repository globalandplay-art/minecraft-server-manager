import {
  playersResponseSchema,
  type PlayersResponse,
  apiErrorResponseSchema,
  overviewResponseSchema,
  type OverviewResponse,
  type Mode,
  serverParamsSchema,
  serverResponseSchema,
  type ServerParams,
  type ServerResponse,
  serversResponseSchema,
  type ServersResponse
} from "@mcsm/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { Clock } from "../clock.js";
import { errorResponse, responseMeta } from "../infra/http.js";
import { ServerNotFoundError, type ServerService } from "../services/server-service.js";

async function sendServerError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
  clock: Clock,
  mode: Mode
): Promise<void> {
  if (error instanceof ServerNotFoundError) {
    await reply
      .code(404)
      .send(errorResponse(request.id, clock, "SERVER_NOT_FOUND", "未找到指定的服务器实例", mode));
    return;
  }

  throw error;
}

export function registerServerRoutes(
  app: FastifyInstance,
  service: ServerService,
  clock: Clock,
  mode: Mode = "mock"
): void {
  app.get<{ Params: ServerParams; Reply: PlayersResponse }>("/api/v1/servers/:serverId/players", {
    schema: { params: serverParamsSchema, response: { 200: playersResponseSchema,
      400: apiErrorResponseSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema, 500: apiErrorResponseSchema } }
  }, async (request) => ({ data: await service.getPlayers(request.params.serverId, () => clock.now().toISOString()),
    meta: responseMeta(request.id, clock, mode) }));
  app.get<{ Reply: ServersResponse }>(
    "/api/v1/servers",
    {
      schema: {
        response: {
          200: serversResponseSchema,
          403: apiErrorResponseSchema,
          500: apiErrorResponseSchema
        }
      }
    },
    async (request) => ({
      data: { items: await service.list() },
      meta: responseMeta(request.id, clock, mode)
    })
  );

  app.get<{ Params: ServerParams; Reply: ServerResponse }>(
    "/api/v1/servers/:serverId",
    {
      schema: {
        params: serverParamsSchema,
        response: {
          200: serverResponseSchema,
          400: apiErrorResponseSchema,
          403: apiErrorResponseSchema,
          404: apiErrorResponseSchema,
          500: apiErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      try {
        return {
          data: await service.get(request.params.serverId),
          meta: responseMeta(request.id, clock, mode)
        };
      } catch (error) {
        await sendServerError(error, request, reply, clock, mode);
        return reply;
      }
    }
  );

  app.get<{ Params: ServerParams; Reply: OverviewResponse }>(
    "/api/v1/servers/:serverId/overview",
    {
      schema: {
        params: serverParamsSchema,
        response: {
          200: overviewResponseSchema,
          400: apiErrorResponseSchema,
          403: apiErrorResponseSchema,
          404: apiErrorResponseSchema,
          500: apiErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      try {
        return {
          data: await service.getOverview(request.params.serverId),
          meta: responseMeta(request.id, clock, mode)
        };
      } catch (error) {
        await sendServerError(error, request, reply, clock, mode);
        return reply;
      }
    }
  );
}
