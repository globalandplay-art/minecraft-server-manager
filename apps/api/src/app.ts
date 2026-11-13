import { WorldGenerationService } from "./services/world-generation-service.js";
import { randomUUID } from "node:crypto";
import { AccessCoordinator } from "./services/access-coordinator.js";
import { TailscaleReadOnlyService } from "./services/tailscale-readonly.js";
import { TailscaleControlService } from "./services/tailscale-control-service.js";
import { WindowsTailscaleReadRunner } from "./services/tailscale-cli-read-runner.js";
import { registerAccessRoutes } from "./routes/access.js";
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
import { registerServerRegistrationRoutes } from "./routes/server-registrations.js";
import { ServerRegistrationService } from "./services/server-registration-service.js";
import { isLocalAdapter } from "./adapters/contract.js";
import { activateInstance } from "./services/instance-activation.js";
import { removeInstance } from "./services/instance-removal.js";
import type { RuntimeFactory } from "./infra/runtime-contract.js";
import { registerWebSocketRoute } from "./routes/websocket.js";
import { registerWorldRoutes } from "./routes/worlds.js";
import { registerWorldLibraryRoutes, registerWorldStopInspectionRoute } from "./routes/world-library.js";
import { WorldLibraryStore } from "./services/world-library-store.js";
import { WorldLibraryImportService } from "./services/world-library-import-service.js";
import { registerWorldLibraryImportRoutes } from "./routes/world-library-imports.js";
import { registerWorldCreatePlanRoutes, registerWorldGenerationRoute, registerFirstManagedWorldRoutes } from "./routes/world-create-plans.js";
import { WorldCreatePlanService } from "./services/world-create-plan-service.js";
import { WorldCreateService } from "./services/world-create-service.js";
import { registerBackupRoutes } from "./routes/backups.js";
import { registerWhitelistRoutes } from "./routes/whitelist.js";
import { WhitelistService } from "./services/whitelist-service.js";
import { WhitelistOnlineService } from "./services/whitelist-online-service.js";
import type { WhitelistRconCoordinator } from "./services/whitelist-rcon-coordinator.js";
import { DomainError } from "./services/domain-errors.js";
import { EventStreamService } from "./services/event-stream-service.js";
import { OperationService } from "./services/operation-service.js";
import { MemoryOperationStore, type OperationStore } from "./services/operation-store.js";
import { ServerService } from "./services/server-service.js";
import type { TransactionJournalStore } from "./services/transaction-journal.js";
import type { ActiveWorldStateStore } from "./services/active-world-state-store.js";
import { BackupService } from "./services/backup-service.js";
import { WorldActivationReconciler } from "./services/world-activation-reconciler.js";
import { WorldActivationHistoryProtection } from "./services/world-activation-history-protection.js";
import { WorldActivationLiveHistory } from "./services/world-activation-live-history.js";
import { WorldActivationPlanService } from "./services/world-activation-plan-service.js";
import { WorldActivationService } from "./services/world-activation-service.js";
import { WorldReplacementService } from "./services/world-replacement-service.js";
import { WorldReplacementRecovery } from "./services/world-replacement-recovery.js";
import { registerWorldActivationRoutes } from "./routes/world-activation.js";
import { registerWorldReplacementRoutes } from "./routes/world-replacement.js";
import { AddonUploadService } from "./services/addon-upload-service.js";
import { AddonInstallService } from "./services/addon-install-service.js";
import { AddonInventory } from "./services/addon-inventory.js";
import { ManagerStartupRecovery } from "./services/manager-startup-recovery.js";
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
import { AccessOperationService } from "./services/access-operation-service.js";

export interface BuildAppOptions {
  /** Trusted construction only; main leaves absent until production activation
   * acceptance. Not controlled by request data or environment variables. */
  worldActivationExecution?: boolean;
  /** First-replacement acceptance only; absent in main until real delivery Gates. */
  worldReplacementExecution?: boolean;
  /** Trusted backend opt-in for durable world generation preparation. */
  worldGenerationPreparation?: boolean;
  worldGenerationExecution?: boolean;
  /** Must be the same factory used for initial local adapters; otherwise hot loading stays disabled. */
  localRuntimeFactory?: RuntimeFactory;
  /** Trusted construction only. Production main supplies no writer until real
   * version rules/endpoint ownership gates pass; never selected by HTTP/env. */
  whitelistMembers?: (operations: OperationService) => WhitelistRconCoordinator;
  tailscaleReadOnly?: TailscaleReadOnlyService;
  tailscaleControl?: TailscaleControlService;
  accessOperations?: AccessOperationService;
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
  activeWorldState?: Pick<ActiveWorldStateStore, "initialize" | "isActive" | "reconcileAfterStart"> & Partial<Pick<ActiveWorldStateStore, "register" | "unregister" | "snapshot" | "prepareGeneration" | "installImportedWorld" | "archiveCurrentWorld" | "protectedGenerationRecovery">>;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const clock = options.clock ?? systemClock;
  const mode = options.mode ?? "mock";
  const accessOperations = options.accessOperations ?? new AccessOperationService();
  if (options.tailscaleControl && options.tailscaleControl.operations !== accessOperations) {
    throw new Error("Access control must share the same operation service.");
  }
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
  const managerRecovery = new ManagerStartupRecovery();
  let closing = false;
  app.addHook('preClose', async () => {
    closing = true;
    await Promise.all([managerRecovery.close(), worldGeneration?.close(), worldCreates?.close(), worldReplacements?.close(), worldReplacementRecovery?.close()]);
  });
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
  const worldLibrary = mode === "local" && options.managerRoot && options.activeWorldState?.snapshot
    ? new WorldLibraryStore(options.managerRoot, clock) : undefined;
  const streams = new EventStreamService(registry, operations);
  let restores: RestoreService | undefined;
  let worldGeneration: WorldGenerationService | undefined;
  let worldCreates: WorldCreateService | undefined;
  let worldImports: WorldImportService | undefined;
  let worldLibraryImports: WorldLibraryImportService | undefined;
  let worldActivationRecovery: WorldActivationReconciler | undefined;
  let worldReplacements: WorldReplacementService | undefined;
  let worldReplacementRecovery: WorldReplacementRecovery | undefined;
  let worldArchives: WorldArchiveService | undefined;
  let backupSchedules: BackupScheduleService | undefined;
  let backupRetention: BackupRetentionService | undefined;
  let properties: PropertiesWriteService | undefined;
  let addonInstalls: AddonInstallService | undefined;
  let addonLifecycle: AddonLifecycleService | undefined;

  app.addHook("onRequest", installLocalRequestGuard(clock, mode,
    options.authentication?.observeLocalGuardDenial.bind(options.authentication)));
  options.authentication?.install(app, clock, mode);
  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0];
    if (!managerRecovery.available && !pathname?.startsWith('/api/v1/auth/')) {
      return reply.code(503).send(errorResponse(request.id, clock,
        managerRecovery.state === 'failed' ? 'MANAGER_RECOVERY_REQUIRED' : 'MANAGER_RECOVERY_PENDING',
        '管理器正在核验启动恢复状态，实例操作尚未开放', mode));
    }
  });
  const whitelistMembers = options.whitelistMembers?.(operations);
  const whitelist = new WhitelistService(registry, operations, clock, whitelistMembers);
  registerWhitelistRoutes(app, whitelist, clock, mode, options.authentication,
    mode === "local" && !whitelistMembers ? new WhitelistOnlineService(registry, operations, whitelist, clock) : undefined);
  if (!options.authentication) app.get("/api/v1/auth/status", {
    exposeHeadRoute: false, schema: { response: { 200: authStatusResponseSchema, 400: apiErrorResponseSchema } }
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (request.raw.url !== "/api/v1/auth/status") return reply.code(400).send(errorResponse(request.id, clock, "VALIDATION_ERROR", "Invalid status request", mode));
    return { data: { configured: false, authenticationRequired: false, auditReady: false } };
  });
  app.addHook("onReady", async () => {
    await accessOperations.initialize();
    const initialScan = await managerRecovery.stage('transaction-scan', async () => options.transactionJournal?.initialize());
    if (initialScan?.issues.some(issue => !issue.serverId)) throw new Error('MANAGER_RECOVERY_UNATTRIBUTED_JOURNAL');
    const deferred = initialScan?.records.some(record => record.intent.worldReplacement || record.intent.worldActivation?.sequence && record.intent.worldActivation.sequence > 1 || record.intent.addonLifecycle?.serverType ||
      record.intent.addonInstall?.confirmUnknownCompatibility === true ||
      (record.intent.addonInstall || record.intent.addonLifecycle) && ['forge', 'neoforge'].includes(registry.getLocal(record.intent.serverId)?.plan.serverInfo.type ?? '')) ?? false;
    const phase = managerRecovery.stage.bind(managerRecovery);
    const initialize = async () => {
    managerRecovery.check();
    // Preserve recovery ordering inside the existing bounded admission task.
    await phase('restore-reconcile', async () => { await restores?.reconcileStartup(); });
    await phase('world-create-reconcile', async () => { await worldCreates?.reconcileStartup(); });
    await phase('world-import-reconcile', async () => { await worldImports?.reconcileStartup(); });
    const headServers = new Set<string>();
    if (worldLibrary) for (const serverId of new Set(initialScan?.records.filter(record => record.intent.worldActivation).map(record => record.intent.serverId))) {
      managerRecovery.check();
      const adapter = registry.getLocal(serverId);
      if (!adapter) continue;
      try { if (await worldLibrary.hasActivationHead({ serverId, rootPath: adapter.plan.rootPath })) headServers.add(serverId); }
      catch { headServers.add(serverId); }
    }
    const replacementServers = await phase('world-replacement-observe', async () => worldReplacementRecovery?.reconcileStartup(managerRecovery.check) ?? new Set<string>());
    await phase('world-activation-reconcile', async () => { await worldActivationRecovery?.reconcileStartup(new Set([...headServers, ...replacementServers])); });
    await phase('world-library-import-reconcile', async () => { await worldLibraryImports?.reconcileStartup(managerRecovery.check, replacementServers,
      options.transactionJournal && options.operationStore ? { journal: options.transactionJournal, receipts: options.operationStore } : undefined); });
    const archiveWorlds = await phase('world-archive-reconcile', async () => worldArchives?.reconcileStartup());
    await phase('properties-reconcile', async () => { await properties?.reconcileStartup(); });
    if (deferred && whitelistMembers) throw new Error('MANAGER_RECOVERY_UNCANCELLABLE_EXTENSION');
    await phase('addon-install-reconcile', async () => { await addonInstalls?.reconcileStartup(managerRecovery.check, phase); });
    await phase('addon-lifecycle-reconcile', async () => { await addonLifecycle?.reconcileStartup(managerRecovery.check, phase); });
    await phase('operation-state-publication', () => operations.initialize(managerRecovery.check));
    try { await whitelistMembers?.initialize(); }
    catch {
      whitelistMembers?.close();
      // Local authentication and unrelated management must remain available.
      // No raw exception/path/output from private evidence is logged.
      app.log.warn("Whitelist member evidence unavailable; member writes remain disabled.");
    }
    const scan = await options.transactionJournal?.scan();
    const restoreWorlds = new Map((scan?.records ?? []).filter((r) => r.intent.restore && ["active", "recovery-required"].includes(r.state))
      .map((r) => [r.intent.serverId, r.intent.restore!.levelName] as const));
    const importWorlds = new Map((scan?.records ?? []).filter((r) => r.intent.worldImport && ["active","recovery-required"].includes(r.state))
      .map((r) => [r.intent.serverId,[r.intent.worldImport!.previousName,r.intent.worldImport!.nextName]] as const));
    const archiveServers = new Set((scan?.records ?? []).filter((r) => r.intent.worldArchive).map((r) => r.intent.serverId));
    const activationServers = new Set((scan?.records ?? []).filter(record => record.intent.worldActivation || record.intent.worldReplacement || record.intent.worldChange?.generation).map(record => record.intent.serverId));
    for (const serverId of scan?.recoveryServerIds ?? []) activationServers.add(serverId);
    for (const issue of scan?.issues ?? []) {
      if (issue.serverId) activationServers.add(issue.serverId);
      else for (const adapter of registry.list()) activationServers.add(adapter.serverId);
    }
    for (const operation of await operations.storedOutcomes()) if (["world-activate", "world-replace"].includes(operation.kind)) activationServers.add(operation.serverId);
    const activeRecovery = await phase('active-world-state', async () => options.activeWorldState?.initialize(restoreWorlds,importWorlds,archiveWorlds,archiveServers,managerRecovery.check,activationServers) ?? []);
    operations.requireStartupWorldRecovery(activeRecovery, serverId => options.activeWorldState?.protectedGenerationRecovery?.(serverId) ?? null);
    await phase('world-library-observation', async () => {
      if (!worldLibrary) return;
      for (const adapter of registry.list().filter(isLocalAdapter)) {
        managerRecovery.check();
        const state = options.activeWorldState?.snapshot?.(adapter.serverId);
        if (adapter.plan.serverInfo.type !== 'vanilla' || state?.state !== 'active' ||
            operations.getServerState(adapter.serverId).recoveryRequired) continue;
        try {
          await worldLibrary.migrateLegacy({ serverId: adapter.serverId, rootPath: adapter.plan.rootPath }, state);
        } catch {
          // This sidecar is not yet a V2 mutation authority. Preserve legacy recovery
          // semantics and expose inspection-required, never recreate damaged evidence.
          app.log.warn('World library identity unavailable; V2 mutations remain disabled.');
        }
      }
    });
    await phase('schedule-state', async () => { await backupSchedules?.initialize(managerRecovery.check); });
    managerRecovery.check();
    };
    const task = managerRecovery.start(initialize, deferred);
    void task.then(async () => {
      if (!managerRecovery.available || closing) return;
      try {
        if (options.backupSchedulerTimers !== false) backupSchedules?.start();
        backupRetention?.start();
      } catch {
        managerRecovery.fail();
        await Promise.all([backupRetention?.close(), backupSchedules?.close()]);
      }
    }).catch(() => { managerRecovery.fail(); });
    if (!deferred) { await task; await managerRecovery.wait(); }
  });
  app.addHook("onClose", async () => {
    await managerRecovery.close();
    // A failed drain must not dispose adapters still used by owned proofs/jobs.
    await Promise.all([worldGeneration?.close(), worldCreates?.close(), worldReplacements?.close(), worldReplacementRecovery?.close()]);
    whitelistMembers?.close();
    await Promise.all([backupRetention?.close(), backupSchedules?.close()]);
    streams.close();
    await service.close();
  });
  registerHealthRoute(app, clock, mode, options.transactionJournal !== undefined && options.managerRoot !== undefined);
  registerAccessRoutes(app, new AccessCoordinator(options.authentication !== undefined), clock, mode, accessOperations,
    options.authentication, options.tailscaleReadOnly ?? new TailscaleReadOnlyService(new WindowsTailscaleReadRunner()),
    options.tailscaleControl ?? new TailscaleControlService(accessOperations));
  app.addHook("onClose", async () => { await accessOperations.close(); });
  const addonInventory = new AddonInventory();
  registerAddonRoutes(app, registry, clock, mode, addonInventory, options.transactionJournal !== undefined && options.managerRoot !== undefined);
  registerServerRoutes(app, service, clock, mode);
  const performanceService = new PerformanceService(registry, clock);
  registerServerRegistrationRoutes(app, mode === 'local' && options.managerRoot
    ? new ServerRegistrationService(options.managerRoot, () => registry.list().filter(isLocalAdapter),
      options.activeWorldState?.register && options.localRuntimeFactory ? (registration, authorize) => activateInstance(registration, {
        root: options.managerRoot!, registry, operations, streams, factory: options.localRuntimeFactory!,
        active: { register: async adapter => {
          const detach = await options.activeWorldState!.register!(adapter);
          try {
            const state = options.activeWorldState!.snapshot?.(adapter.serverId);
            if (worldLibrary && state?.state === 'active') await worldLibrary.migrateLegacy({ serverId: adapter.serverId, rootPath: adapter.plan.rootPath }, state);
            return detach;
          } catch (error) { detach(); throw error; }
        } },
        ...(options.transactionJournal ? { journal: options.transactionJournal } : {}), closing: () => closing
      }, authorize) : undefined,
      (target, publish, authorize) => {
        const action = () => removeInstance(target, publish, authorize, { registry, operations, streams,
          factory: options.localRuntimeFactory, journal: options.transactionJournal, closing: () => closing, detached: () => performanceService.unregister(target.id),
          active: options.activeWorldState?.unregister ? { unregister: options.activeWorldState.unregister.bind(options.activeWorldState) } : undefined });
        return backupSchedules ? backupSchedules.withRegistrationChange(action) : action();
      }, id => operations.isUnregistered(id)) : undefined, clock, mode, options.authentication);
  registerPerformanceRoutes(app, performanceService, clock, mode);
  registerCrashAnalysisRoutes(app, new CrashAnalysisService(registry, clock), clock, mode);
  registerOperationRoutes(app, service, clock, mode, options.authentication);
  registerWorldRoutes(app, worlds, clock, mode);
  let worldActivationEnabled = false;
  if (worldLibrary && options.activeWorldState?.snapshot) registerWorldLibraryRoutes(app, worldLibrary, registry,
    options.activeWorldState.snapshot.bind(options.activeWorldState), clock, mode, id => worldLibraryImports?.available(id) ?? Promise.resolve(false),
    () => worldActivationEnabled, options.transactionJournal && options.operationStore ? { journal: options.transactionJournal, receipts: options.operationStore } : undefined,
    async catalog => {
      if (!worldGeneration || !catalog.revision) return undefined;
      const receipt = (await operations.readStartupWorldStopCandidate(catalog.serverId))?.stop.worldLifecycle;
      if (!receipt || receipt.catalogRevision !== catalog.revision) return undefined;
      if (catalog.state === "ready") return receipt.worldId === catalog.activeWorldId ? receipt.worldId : undefined;
      return catalog.items.some(item => item.worldId === receipt.worldId && item.state === "present" && item.origin === "generation")
        ? receipt.worldId : undefined;
    }, operations.readStartupWorldStopCandidate.bind(operations));
  if (options.transactionJournal !== undefined && options.managerRoot !== undefined) {
    const uploads = new WorldImportUploadService(registry, operations, options.managerRoot,undefined,options.transactionJournal,clock,options.importAutomaticCleanup ?? false);
    const backups = new BackupService(registry, operations, options.transactionJournal, options.managerRoot, clock);
    if (worldLibrary && options.activeWorldState?.snapshot) {
      const recovery = new WorldActivationReconciler(registry, operations, options.transactionJournal, worldLibrary, uploads, backups, options.managerRoot);
      worldActivationRecovery = recovery;
      const historyProtection = new WorldActivationHistoryProtection(registry, options.transactionJournal, worldLibrary, backups, options.managerRoot);
      const historyRecovery = new WorldActivationLiveHistory(registry, options.transactionJournal, worldLibrary, historyProtection, uploads,
        options.managerRoot, managerRecovery.check);
      worldLibraryImports = new WorldLibraryImportService(registry, operations, options.transactionJournal, worldLibrary, uploads,
        { snapshot: options.activeWorldState.snapshot.bind(options.activeWorldState) }, clock, undefined, record => recovery.verifiesSupersession(record), historyRecovery);
      worldReplacements = new WorldReplacementService(operations, options.transactionJournal, worldLibrary,
        worldLibraryImports, uploads, backups, options.managerRoot, clock);
      worldReplacementRecovery = new WorldReplacementRecovery(registry, operations, options.transactionJournal, worldLibrary,
        uploads, backups, options.managerRoot, () => {
          if (closing || !managerRecovery.available) throw new DomainError(503, "ACTION_UNAVAILABLE", "Manager recovery is not ready", "manager-recovery-unavailable");
          return undefined;
        });
      registerWorldReplacementRoutes(app, worldLibraryImports, clock, mode, options.authentication,
        options.worldReplacementExecution ? worldReplacements : undefined,
        options.worldReplacementExecution ? worldReplacementRecovery : undefined);
      registerWorldLibraryImportRoutes(app, worldLibraryImports, clock, mode, options.authentication);
      if (options.worldActivationExecution && options.activeWorldState.installImportedWorld) {
        const imports = worldLibraryImports;
        const plans = new WorldActivationPlanService(registry, operations, worldLibrary,
          { snapshot: options.activeWorldState.snapshot.bind(options.activeWorldState) }, async (serverId, worldId, revision) => {
            const scan = await options.transactionJournal!.scan();
            if (scan.issues.some(issue => !issue.serverId || issue.serverId === serverId) || scan.records.some(record =>
              record.intent.serverId === serverId && (record.intent.worldArchive || ["active", "recovery-required"].includes(record.state)))) {
              throw new DomainError(409, "RECOVERY_REQUIRED", "World activation history requires inspection", "world-activation-source-unverified", true);
            }
            if (!scan.records.some(record => record.intent.serverId === serverId && record.intent.worldActivation)) return imports.verifyInactiveForActivation(serverId, worldId);
            const source = await historyProtection.verifyTarget(serverId, worldId, revision);
            if (source.kind === "import") await imports.verifyInactiveForActivation(serverId, worldId);
            return { historyProof: source.historyProof };
          });
        const activation = new WorldActivationService(registry, operations, options.transactionJournal, worldLibrary, plans,
          { snapshot: options.activeWorldState.snapshot.bind(options.activeWorldState),
            installImportedWorld: options.activeWorldState.installImportedWorld.bind(options.activeWorldState) },
          backups, options.managerRoot, clock, undefined, historyProtection);
        registerWorldActivationRoutes(app, plans, clock, mode, options.authentication, activation);
        worldActivationEnabled = true;
      }
    }
    registerWorldImportUploadRoutes(app, uploads, clock, mode);
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
    if (active?.snapshot && active.prepareGeneration && (!options.worldGenerationPreparation || (options.operationStore && worldLibrary))) {
      worldCreates = new WorldCreateService(registry, operations, options.transactionJournal, backups, options.managerRoot,
        { snapshot: active.snapshot.bind(active), prepareGeneration: active.prepareGeneration.bind(active) }, clock, undefined,
        options.worldGenerationPreparation && options.operationStore && worldLibrary ? { library: worldLibrary } : undefined);
    }
    if (worldCreates && active?.snapshot && options.worldGenerationPreparation && options.worldGenerationExecution &&
        options.authentication && options.operationStore && worldLibrary) {
      worldGeneration = new WorldGenerationService(registry, operations, options.transactionJournal,
        backups, options.managerRoot, worldLibrary, options.operationStore, true);
      registerWorldGenerationRoute(app, worldGeneration, clock, mode, options.authentication);
      registerFirstManagedWorldRoutes(app, worldGeneration, clock, mode, options.authentication);
      registerWorldStopInspectionRoute(app, registry, operations, worldLibrary,
        { journal: options.transactionJournal, receipts: options.operationStore }, active.snapshot.bind(active), clock, mode, options.authentication);
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
      new BackupExportService(backups, operations),
      options.authentication
    );
  }
  registerPropertiesRoutes(app, properties, clock, mode);
  registerWorldCreatePlanRoutes(app, new WorldCreatePlanService(registry, operations, Boolean(worldCreates)), clock, mode, worldCreates, options.authentication);
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

  return Object.assign(app, { managerRecovery });
}
