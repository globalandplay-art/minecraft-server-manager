import {
  apiErrorResponseSchema,
  commandRequestSchema,
  commandResponseSchema,
  emptyRequestSchema,
  lifecycleActionResponseSchema,
  logsQuerySchema,
  logsResponseSchema,
  operationParamsSchema,
  operationResponseSchema,
  serverParamsSchema,
  type CommandRequest,
  type CommandResponse,
  type EmptyRequest,
  type LifecycleActionResponse,
  type LogsQuery,
  type LogsResponse,
  type Mode,
  type OperationParams,
  type OperationResponse,
  type ServerParams
} from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";

import type { Clock } from "../clock.js";
import { installWriteRequestGuard, responseMeta } from "../infra/http.js";
import { DomainError } from "../services/domain-errors.js";
import type { ServerService } from "../services/server-service.js";

const errorResponses = {
  400: apiErrorResponseSchema,
  403: apiErrorResponseSchema,
  404: apiErrorResponseSchema,
  409: apiErrorResponseSchema,
  413: apiErrorResponseSchema,
  415: apiErrorResponseSchema,
  428: apiErrorResponseSchema,
  429: apiErrorResponseSchema,
  500: apiErrorResponseSchema,
  501: apiErrorResponseSchema,
  503: apiErrorResponseSchema,
  504: apiErrorResponseSchema
};

function requireIdempotencyKey(value: string | string[] | undefined): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    throw new DomainError(
      428,
      "PRECONDITION_REQUIRED",
      "生命周期操作需要随机 UUID Idempotency-Key",
      "idempotency-key-required"
    );
  }
  return value.toLowerCase();
}

export function registerOperationRoutes(
  app: FastifyInstance,
  service: ServerService,
  clock: Clock,
  mode: Mode
): void {
  const writeGuard = installWriteRequestGuard(clock, mode);

  for (const kind of ["start", "stop", "restart"] as const) {
    app.post<{
      Params: ServerParams;
      Body: EmptyRequest;
      Reply: LifecycleActionResponse;
    }>(
      `/api/v1/servers/:serverId/actions/${kind}`,
      {
        preHandler: writeGuard,
        schema: {
          params: serverParamsSchema,
          body: emptyRequestSchema,
          response: { 202: lifecycleActionResponseSchema, ...errorResponses }
        }
      },
      async (request, reply) => {
        const operation = await service.requestLifecycle(
          request.params.serverId,
          kind,
          requireIdempotencyKey(request.headers["idempotency-key"])
        );
        return reply.code(202).send({
          data: { operation },
          meta: responseMeta(request.id, clock, mode)
        });
      }
    );
  }

  app.get<{ Params: OperationParams; Reply: OperationResponse }>(
    "/api/v1/operations/:operationId",
    {
      schema: {
        params: operationParamsSchema,
        response: { 200: operationResponseSchema, ...errorResponses }
      }
    },
    async (request) => ({
      data: service.getOperation(request.params.operationId),
      meta: responseMeta(request.id, clock, mode)
    })
  );

  app.get<{ Params: ServerParams; Querystring: LogsQuery; Reply: LogsResponse }>(
    "/api/v1/servers/:serverId/logs",
    {
      schema: {
        params: serverParamsSchema,
        querystring: logsQuerySchema,
        response: { 200: logsResponseSchema, ...errorResponses }
      }
    },
    async (request) => ({
      data: await service.getLogs(
        request.params.serverId,
        request.query.after,
        request.query.limit ?? 200
      ),
      meta: responseMeta(request.id, clock, mode)
    })
  );

  app.post<{
    Params: ServerParams;
    Body: CommandRequest;
    Reply: CommandResponse;
  }>(
    "/api/v1/servers/:serverId/commands",
    {
      preHandler: writeGuard,
      schema: {
        params: serverParamsSchema,
        body: commandRequestSchema,
        response: { 200: commandResponseSchema, ...errorResponses }
      }
    },
    async (request) => ({
      data: await service.sendCommand(request.params.serverId, request.body.command),
      meta: responseMeta(request.id, clock, mode)
    })
  );
}
