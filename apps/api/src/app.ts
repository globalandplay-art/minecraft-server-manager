import { randomUUID } from "node:crypto";

import type { ApiErrorResponse } from "@mcsm/contracts";
import type { Mode } from "@mcsm/contracts";
import websocket from "@fastify/websocket";
import fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import type { MinecraftServerAdapter } from "./adapters/contract.js";
import { AdapterRegistry } from "./adapters/registry.js";
import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";
import { JSON_BODY_LIMIT_BYTES } from "./config/runtime.js";
import { createMockAdapters } from "./fixtures/servers.js";
import { errorResponse, installLocalRequestGuard } from "./infra/http.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerOperationRoutes } from "./routes/operations.js";
import { registerServerRoutes } from "./routes/servers.js";
import { registerWebSocketRoute } from "./routes/websocket.js";
import { registerWorldRoutes } from "./routes/worlds.js";
import { DomainError } from "./services/domain-errors.js";
import { EventStreamService } from "./services/event-stream-service.js";
import { OperationService } from "./services/operation-service.js";
import { MemoryOperationStore, type OperationStore } from "./services/operation-store.js";
import { ServerService } from "./services/server-service.js";
import type { TransactionJournalStore } from "./services/transaction-journal.js";
import type { ActiveWorldStateStore } from "./services/active-world-state-store.js";
import { WorldInventoryService } from "./services/world-inventory-service.js";

export interface BuildAppOptions {
  clock?: Clock;
  adapters?: readonly MinecraftServerAdapter[];
  logger?: FastifyServerOptions["logger"];
  mode?: Mode;
  operationStore?: OperationStore;
  transactionRecovery?: Pick<TransactionJournalStore, "initialize">;
  activeWorldState?: Pick<ActiveWorldStateStore, "initialize" | "isActive" | "reconcileAfterStart">;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const clock = options.clock ?? systemClock;
  const mode = options.mode ?? "mock";
  const adapters = options.adapters ?? createMockAdapters(clock);
  const app = fastify({
    logger: options.logger ?? false,
    trustProxy: false,
    bodyLimit: JSON_BODY_LIMIT_BYTES,
    genReqId: () => randomUUID()
  });
  void app.register(websocket, {
    options: { maxPayload: 4 * 1024, perMessageDeflate: false, clientTracking: true }
  });
  const registry = new AdapterRegistry(adapters);
  const operations = new OperationService(
    options.operationStore ?? new MemoryOperationStore(),
    clock,
    options.transactionRecovery
  );
  const service = new ServerService(registry, operations, options.activeWorldState);
  const worlds = new WorldInventoryService(registry, clock, options.activeWorldState);
  const streams = new EventStreamService(registry, operations);

  app.addHook("onRequest", installLocalRequestGuard(clock, mode));
  app.addHook("onReady", async () => {
    await operations.initialize();
    operations.requireRecovery(await options.activeWorldState?.initialize() ?? []);
  });
  app.addHook("onClose", async () => {
    streams.close();
    await service.close();
  });
  registerHealthRoute(app, clock, mode);
  registerServerRoutes(app, service, clock, mode);
  registerOperationRoutes(app, service, clock, mode);
  registerWorldRoutes(app, worlds, clock, mode);
  // @fastify/websocket installs an onRoute hook in its encapsulated scope.
  // Register WebSocket routes in a following plugin so the hook can replace
  // the HTTP handler with the upgrade handler before the route is compiled.
  void app.register(async (websocketRoutes) => {
    registerWebSocketRoute(websocketRoutes, streams, clock, mode);
  });

  app.setNotFoundHandler(async (request, reply) => {
    const payload: ApiErrorResponse = errorResponse(
      request.id,
      clock,
      "RESOURCE_NOT_FOUND",
      "请求的 API 资源不存在",
      mode
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
        .send(errorResponse(request.id, clock, "UPLOAD_TOO_LARGE", "请求体超过 64 KiB 限制", mode));
      return;
    }

    if (hasValidation) {
      await reply
        .code(400)
        .send(errorResponse(request.id, clock, "VALIDATION_ERROR", "请求参数格式无效", mode));
      return;
    }

    if (error instanceof DomainError) {
      await reply
        .code(error.statusCode)
        .send(errorResponse(request.id, clock, error.code, error.safeMessage, mode, error.reason));
      return;
    }

    request.log.error(
      { requestId: request.id, errorCode: "UNHANDLED_REQUEST_ERROR" },
      "Unhandled request error"
    );
    await reply
      .code(500)
      .send(errorResponse(request.id, clock, "INTERNAL_ERROR", "服务器处理请求时发生错误", mode));
  });

  return app;
}
