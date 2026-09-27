import { randomUUID } from "node:crypto";

import type { ApiErrorResponse } from "@mcsm/contracts";
import fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import type { MinecraftServerAdapter } from "./adapters/contract.js";
import { AdapterRegistry } from "./adapters/registry.js";
import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";
import { JSON_BODY_LIMIT_BYTES } from "./config/runtime.js";
import { createMockAdapters } from "./fixtures/servers.js";
import { errorResponse, installLocalRequestGuard } from "./infra/http.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerServerRoutes } from "./routes/servers.js";
import { ServerService } from "./services/server-service.js";

export interface BuildAppOptions {
  clock?: Clock;
  adapters?: readonly MinecraftServerAdapter[];
  logger?: FastifyServerOptions["logger"];
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const clock = options.clock ?? systemClock;
  const adapters = options.adapters ?? createMockAdapters(clock);
  const app = fastify({
    logger: options.logger ?? false,
    trustProxy: false,
    bodyLimit: JSON_BODY_LIMIT_BYTES,
    genReqId: () => randomUUID()
  });
  const service = new ServerService(new AdapterRegistry(adapters));

  app.addHook("onRequest", installLocalRequestGuard(clock));
  registerHealthRoute(app, clock);
  registerServerRoutes(app, service, clock);

  app.setNotFoundHandler(async (request, reply) => {
    const payload: ApiErrorResponse = errorResponse(
      request.id,
      clock,
      "RESOURCE_NOT_FOUND",
      "请求的 API 资源不存在"
    );
    await reply.code(404).send(payload);
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (reply.sent) {
      return;
    }

    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    const hasValidation =
      typeof error === "object" && error !== null && "validation" in error;

    if (errorCode === "FST_ERR_CTP_BODY_TOO_LARGE") {
      await reply
        .code(413)
        .send(errorResponse(request.id, clock, "UPLOAD_TOO_LARGE", "请求体超过 64 KiB 限制"));
      return;
    }

    if (hasValidation) {
      await reply
        .code(400)
        .send(errorResponse(request.id, clock, "VALIDATION_ERROR", "请求参数格式无效"));
      return;
    }

    request.log.error(
      { requestId: request.id, errorCode: "UNHANDLED_REQUEST_ERROR" },
      "Unhandled request error"
    );
    await reply
      .code(500)
      .send(errorResponse(request.id, clock, "INTERNAL_ERROR", "服务器处理请求时发生错误"));
  });

  return app;
}
