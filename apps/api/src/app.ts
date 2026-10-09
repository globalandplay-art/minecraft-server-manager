import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { HttpAuthentication } from "./auth/http-auth.js";
import { PerformanceService } from "./services/performance-service.js";
import { registerPerformanceRoutes } from "./routes/performance.js";
import { CrashAnalysisService } from "./services/crash-analysis-service.js";
import { registerCrashAnalysisRoutes } from "./routes/crash-analysis.js";

import type { ApiErrorResponse } from "@mcsm/contracts";
import { authStatusResponseSchema, apiErrorResponseSchema, type Mode } from "@mcsm/contracts";
import { EVENTS_PROTOCOL } from "./auth/ws-auth.js";
import websocket from "@fastify/websocket";
import fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import type { MinecraftServerAdapter } from "./adapters/contract.js";
import { AdapterRegistry } from "./adapters/registry.js";
import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";
import { PropertiesWriteService } from "./services/properties-write-service.js";
import { registerPropertiesRoutes } from "./routes/properties.js";
import { registerAddonInstallRoutes, registerAddonLifecycleRoutes, registerAddonRoutes, registerAddonUploadRoutes } from "./routes/addons.js";
import { JSON_BODY_LIMIT_BYTES } from "./config/runtime.js";
import { createMockAdapters } from "./fixtures/servers.js";
import { errorResponse, installLocalRequestGuard } from "./infra/http.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerOperationRoutes } from "./routes/operations.js";
import { registerServerRoutes } from "./routes/servers.js";
import { registerWebSocketRoute } from "./routes/websocket.js";
import { registerWorldRoutes } from "./routes/worlds.js";
import { registerWorldCreatePlanRoutes } from "./routes/world-create-plans.js";
import { WorldCreatePlanService } from "./services/world-create-plan-service.js";
import { WorldCreateService } from "./services/world-create-service.js";
import { registerBackupRoutes } from "./routes/backups.js";
import { DomainError } from "./services/domain-errors.js";
import { EventStreamService } from "./services/event-stream-service.js";
import { OperationService } from "./services/operation-service.js";
import { MemoryOperationStore, type OperationStore } from "./services/operation-store.js";
import { ServerService } from "./services/server-service.js";
import type { TransactionJournalStore } from "./services/transaction-journal.js";
import type { ActiveWorldStateStore } from "./services/active-world-state-store.js";
import { BackupService } from "./services/backup-service.js";
import { AddonUploadService } from "./services/addon-upload-service.js";
import { AddonInstallService } from "./services/addon-install-service.js";
import { AddonInventory } from "./services/addon-inventory.js";
import { AddonLifecycleService } from "./services/addon-lifecycle-service.js";
import { BackupExportService } from "./services/backup-export-service.js";
import { WorldInventoryService } from "./services/world-inventory-service.js";
import { RestoreService } from "./services/restore-service.js";
import { registerRestoreRoutes } from "./routes/restores.js";
import { WorldImportUploadService } from "./services/world-import-upload-service.js";
import { registerWorldImportUploadRoutes } from "./routes/world-import-uploads.js";
import { WorldImportService } from "./services/world-import-service.js";
import { registerWorldImportRoutes } from "./routes/world-imports.js";
import { WorldArchiveService } from "./services/world-archive-service.js";
import { registerWorldArchiveRoutes } from "./routes/world-archives.js";
import { BackupScheduleService } from "./services/backup-schedule-service.js";
import { registerBackupScheduleRoutes } from "./routes/backup-schedules.js";
import { BackupRetentionService } from "./services/backup-retention-service.js";
import { registerBackupRetentionRoutes } from "./routes/backup-retention.js";

export interface BuildAppOptions {
  authentication?: HttpAuthentication;
  clock?: Clock;
  adapters?: readonly MinecraftServerAdapter[];
  logger?: FastifyServerOptions["logger"];
  mode?: Mode;
  operationStore?: OperationStore;
  transactionRecovery?: Pick<TransactionJournalStore, "initialize">;
  transactionJournal?: TransactionJournalStore;
  managerRoot?: string;
  importAutomaticCleanup?: boolean;
  backupSchedulerTimers?: boolean;
  activeWorldState?: Pick<ActiveWorldStateStore, "initialize" | "isActive" | "reconcileAfterStart"> & Partial<Pick<ActiveWorldStateStore, "snapshot" | "prepareGeneration" | "installImportedWorld" | "archiveCurrentWorld">>;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const clock = options.clock ?? systemClock;
  const mode = options.mode ?? "mock";
  const adapters = options.adapters ?? createMockAdapters(clock);
  const requestedLogger = typeof options.logger === "object" ? options.logger : undefined;
  const logger: FastifyServerOptions["logger"] = options.logger === false || options.logger === undefined ? false : {
    // Keep destination and severity customization; hooks/formatters/mixins could observe raw arguments.
    level: requestedLogger?.level ?? "info",
    ...(requestedLogger?.stream ? { stream: requestedLogger.stream } : {}),
    ...(requestedLogger?.transport ? { transport: requestedLogger.transport } : {}),
    // Applied last even for custom logger options: request/error serializers must never expose bearers.
    serializers: { req: (request: { method?: string }) => ({ method: request.method ?? "UNKNOWN" }),
      err: () => ({ type: "RequestError", message: "Request failed", stack: "", code: "REQUEST_ERROR" }),
      res: (reply: { statusCode?: number }) => ({ statusCode: reply.statusCode ?? 0 }) },
    redact: { paths: ["req.headers", "req.body", "headers", "body", "cookie", "authorization", "sec-websocket-protocol"], remove: true }
  };
  const app = fastify({
    logger,
    trustProxy: false,
    bodyLimit: JSON_BODY_LIMIT_BYTES,
    genReqId: () => randomUUID()
  });
  void app.register(websocket, {
    options: { maxPayload: 4 * 1024, perMessageDeflate: false, clientTracking: true,
      ...(options.authentication ? {
        verifyClient: ({ req }: { req: IncomingMessage }) => options.authentication!.websocket.verify(req),
        handleProtocols: (protocols: Set<string>) => protocols.has(EVENTS_PROTOCOL) ? EVENTS_PROTOCOL : false
      } : {}) },
    errorHandler: (_error, socket) => { socket.terminate(); }
  });
  const registry = new AdapterRegistry(adapters);
  const operations = new OperationService(
    options.operationStore ?? new MemoryOperationStore(),
    clock,
    options.transactionRecovery ?? options.transactionJournal
  );
  const service = new ServerService(registry, operations, options.activeWorldState,
    options.transactionJournal !== undefined && options.managerRoot !== undefined,
    options.transactionJournal !== undefined && options.managerRoot !== undefined &&
      options.activeWorldState?.snapshot !== undefined && options.activeWorldState.prepareGeneration !== undefined,
    options.transactionJournal !== undefined && options.managerRoot !== undefined);
  const worlds = new WorldInventoryService(registry, clock, options.activeWorldState);
  const streams = new EventStreamService(registry, operations);
  let restores: RestoreService | undefined;
  let worldCreates: WorldCreateService | undefined;
  let worldImports: WorldImportService | undefined;
  let worldArchives: WorldArchiveService | undefined;
  let backupSchedules: BackupScheduleService | undefined;
  let backupRetention: BackupRetentionService | undefined;
  let properties: PropertiesWriteService | undefined;
  let addonInstalls: AddonInstallService | undefined;
  let addonLifecycle: AddonLifecycleService | undefined;

  app.addHook("onRequest", installLocalRequestGuard(clock, mode,
    options.authentication?.observeLocalGuardDenial.bind(options.authentication)));
  options.authentication?.install(app, clock, mode);
  if (!options.authentication) app.get("/api/v1/auth/status", {
    exposeHeadRoute: false, schema: { response: { 200: authStatusResponseSchema, 400: apiErrorResponseSchema } }
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (request.raw.url !== "/api/v1/auth/status") return reply.code(400).send(errorResponse(request.id, clock, "VALIDATION_ERROR", "Invalid status request", mode));
    return { data: { configured: false, authenticationRequired: false, auditReady: false } };
  });
  app.addHook("onReady", async () => {
    await options.transactionJournal?.initialize();
    await restores?.reconcileStartup();
    await worldCreates?.reconcileStartup();
    await worldImports?.reconcileStartup();
    const archiveWorlds = await worldArchives?.reconcileStartup();
    await properties?.reconcileStartup();
    await addonInstalls?.reconcileStartup();
    await addonLifecycle?.reconcileStartup();
    await operations.initialize();
    const scan = await options.transactionJournal?.scan();
    const restoreWorlds = new Map((scan?.records ?? []).filter((r) => r.intent.restore && ["active", "recovery-required"].includes(r.state))
      .map((r) => [r.intent.serverId, r.intent.restore!.levelName] as const));
    const importWorlds = new Map((scan?.records ?? []).filter((r) => r.intent.worldImport && ["active","recovery-required"].includes(r.state))
      .map((r) => [r.intent.serverId,[r.intent.worldImport!.previousName,r.intent.worldImport!.nextName]] as const));
    const archiveServers = new Set((scan?.records ?? []).filter((r) => r.intent.worldArchive).map((r) => r.intent.serverId));
    operations.requireRecovery(await options.activeWorldState?.initialize(restoreWorlds,importWorlds,archiveWorlds,archiveServers) ?? []);
    await backupSchedules?.initialize();
    if (options.backupSchedulerTimers !== false) backupSchedules?.start();
    backupRetention?.start();
  });
  app.addHook("onClose", async () => {
    await Promise.all([backupRetention?.close(), backupSchedules?.close()]);
    streams.close();
    await service.close();
  });
  registerHealthRoute(app, clock, mode, options.transactionJournal !== undefined && options.managerRoot !== undefined);
  const addonInventory = new AddonInventory();
  registerAddonRoutes(app, registry, clock, mode, addonInventory, options.transactionJournal !== undefined && options.managerRoot !== undefined);
  registerServerRoutes(app, service, clock, mode);
  registerPerformanceRoutes(app, new PerformanceService(registry, clock), clock, mode);
  registerCrashAnalysisRoutes(app, new CrashAnalysisService(registry, clock), clock, mode);
  registerOperationRoutes(app, service, clock, mode);
  registerWorldRoutes(app, worlds, clock, mode);
  if (options.transactionJournal !== undefined && options.managerRoot !== undefined) {
    const uploads = new WorldImportUploadService(registry, operations, options.managerRoot,undefined,options.transactionJournal,clock,options.importAutomaticCleanup ?? false);
    registerWorldImportUploadRoutes(app, uploads, clock, mode);
    const backups = new BackupService(registry, operations, options.transactionJournal, options.managerRoot, clock);
    const addonUploads = new AddonUploadService(registry, operations, options.managerRoot, clock);
    registerAddonUploadRoutes(app, addonUploads, clock, mode);
    addonInstalls = new AddonInstallService(registry, operations, options.transactionJournal, backups, addonUploads,
      addonInventory, options.managerRoot, clock);
    registerAddonInstallRoutes(app, addonInstalls, clock, mode);
    addonLifecycle = new AddonLifecycleService(registry, operations, options.transactionJournal, backups, addonInventory, options.managerRoot, clock);
    registerAddonLifecycleRoutes(app, addonLifecycle, clock, mode);
    backupRetention = new BackupRetentionService(registry, operations, backups, options.transactionJournal, options.managerRoot, clock);
    registerBackupRetentionRoutes(app, backupRetention, clock, mode);
    if (options.activeWorldState?.snapshot) {
      backupSchedules = new BackupScheduleService(registry, operations, backups, options.managerRoot, clock,
        (serverId) => options.activeWorldState!.snapshot!(serverId)?.state === "active");
      registerBackupScheduleRoutes(app, backupSchedules, clock, mode);
    }
    const active = options.activeWorldState;
    if (active?.snapshot) {
      properties = new PropertiesWriteService(registry, operations, options.transactionJournal, options.managerRoot,
        { snapshot: active.snapshot.bind(active) }, clock);
    }
    if (active?.snapshot && active.archiveCurrentWorld) {
      worldArchives = new WorldArchiveService(registry,operations,options.transactionJournal,backups,options.managerRoot,
        { snapshot:active.snapshot.bind(active),archiveCurrentWorld:active.archiveCurrentWorld.bind(active) },clock);
      registerWorldArchiveRoutes(app,worldArchives,clock,mode);
    }
    if (active?.snapshot && active.prepareGeneration) {
      worldCreates = new WorldCreateService(registry, operations, options.transactionJournal, backups, options.managerRoot,
        { snapshot: active.snapshot.bind(active), prepareGeneration: active.prepareGeneration.bind(active) }, clock);
    }
    if (active?.snapshot && active.installImportedWorld) {
      worldImports = new WorldImportService(registry,operations,options.transactionJournal,backups,options.managerRoot,
        { snapshot:active.snapshot.bind(active),installImportedWorld:active.installImportedWorld.bind(active) },clock,uploads);
      registerWorldImportRoutes(app,worldImports,clock,mode);
    }
    restores = new RestoreService(registry, operations, backups, options.transactionJournal, options.managerRoot, clock);
    registerRestoreRoutes(app, restores, clock, mode);
    registerBackupRoutes(
      app,
      backups,
      clock,
      mode,
      new BackupExportService(backups, operations)
    );
  }
  registerPropertiesRoutes(app, properties, clock, mode);
  registerWorldCreatePlanRoutes(app, new WorldCreatePlanService(registry, operations, Boolean(worldCreates)), clock, mode, worldCreates);
  // @fastify/websocket installs an onRoute hook in its encapsulated scope.
  // Register WebSocket routes in a following plugin so the hook can replace
  // the HTTP handler with the upgrade handler before the route is compiled.
  void app.register(async (websocketRoutes) => {
    registerWebSocketRoute(websocketRoutes, streams, clock, mode, options.authentication?.websocket);
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
        .send(errorResponse(request.id, clock, "UPLOAD_TOO_LARGE", "请求体超过此路由的大小限制", mode));
      return;
    }

    if (errorCode === "FST_ERR_CTP_INVALID_JSON_BODY") {
      await reply.code(400).send(errorResponse(request.id, clock, "VALIDATION_ERROR", "请求 JSON 格式无效", mode));
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
