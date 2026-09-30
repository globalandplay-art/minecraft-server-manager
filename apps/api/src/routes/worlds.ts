import {
  apiErrorResponseSchema,
  type Mode,
  serverParamsSchema,
  type ServerParams,
  type WorldsResponse,
  worldsResponseSchema
} from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";

import type { Clock } from "../clock.js";
import { responseMeta } from "../infra/http.js";
import type { WorldInventoryService } from "../services/world-inventory-service.js";

export function registerWorldRoutes(
  app: FastifyInstance,
  service: WorldInventoryService,
  clock: Clock,
  mode: Mode
): void {
  app.get<{ Params: ServerParams; Reply: WorldsResponse }>(
    "/api/v1/servers/:serverId/worlds",
    {
      schema: {
        params: serverParamsSchema,
        response: {
          200: worldsResponseSchema,
          400: apiErrorResponseSchema,
          403: apiErrorResponseSchema,
          404: apiErrorResponseSchema,
          409: apiErrorResponseSchema,
          500: apiErrorResponseSchema,
          501: apiErrorResponseSchema
        }
      }
    },
    async (request) => ({
      data: { items: await service.list(request.params.serverId) },
      meta: responseMeta(request.id, clock, mode)
    })
  );
}
