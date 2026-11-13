import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { ActiveWorldStateStore } from "../src/services/active-world-state-store.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";
import { TransactionJournalStore } from "../src/services/transaction-journal.js";
import { WorldImportUploadService } from "../src/services/world-import-upload-service.js";
import { WorldLibraryStore } from "../src/services/world-library-store.js";
import { WorldLibraryImportService } from "../src/services/world-library-import-service.js";
import { testWorldLevel as level, testWorldZip as zip } from "./fixtures/world-library-content.js";
import { buildApp } from "../src/app.js";
import { HttpAuthentication } from "../src/auth/http-auth.js";
import { SessionCore } from "../src/auth/session-core.js";
import { PasswordVerifier, SCRYPT_PROFILE } from "../src/auth/password.js";
import { createWorldFolderArchive } from "../../web/src/worldFolderArchive.js";
import { WorldActivationPlanService } from "../src/services/world-activation-plan-service.js";
import { WorldActivationService, type WorldActivationApproval } from "../src/services/world-activation-service.js";
import { BackupService } from "../src/services/backup-service.js";
import { WorldActivationReconciler } from "../src/services/world-activation-reconciler.js";
import { verifyActivationProtection } from "../src/services/world-activation-protection.js";
import { WorldActivationHistoryProtection } from "../src/services/world-activation-history-protection.js";
import { WorldActivationLiveHistory } from "../src/services/world-activation-live-history.js";
import { registerWorldActivationRoutes } from "../src/routes/world-activation.js";

const roots: string[] = [];
const clock = { now: () => new Date("2026-10-25T10:00:00.000Z") };
const properties = "# retained\nlevel-name=world\nmax-players=20\n";
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function complete(operations: OperationService, id: string) {
  await vi.waitFor(() => {
    expect(operations.get(id)?.state).toMatch(/^(succeeded|failed|interrupted)$/u);
    expect(operations.getServerState("library-test").activeOperationId).toBeNull();
  }, { timeout: 3000 });
  return operations.get(id)!;
}
async function fixture(inject?: (point: string) => Promise<void>, withDataVersion = true, dataVersion = 100) {
  const root = await mkdtemp(path.join(tmpdir(), "lt-independent-world-")); roots.push(root);
  const manager = path.join(root, "manager"), server = path.join(root, "server");
  await mkdir(manager); await mkdir(path.join(server, "world"), { recursive: true });
  const original = level("original", true, dataVersion); await writeFile(path.join(server, "world", "level.dat"), original);
  await writeFile(path.join(server, "server.properties"), properties);
  const status = { state: "stopped", ownership: "none", recoveryRequired: false };
  const start = vi.fn(), stop = vi.fn();
  const adapter = { mode: "local", serverId: "library-test", plan: { rootPath: server, serverInfo: { type: "vanilla", minecraftVersion: "26.3" } },
    getStatus: async () => ({ ...status }), getServerInfo: async () => ({ type: "vanilla", minecraftVersion: "26.3" }),
    getCapabilities: async () => ({ worlds: true, backup: true }), subscribe: () => () => {}, closeObserver: async () => {}, start, stop } as unknown as LocalMinecraftServerAdapter;
  const registry = new AdapterRegistry([adapter]); const journal = new TransactionJournalStore(manager);
  const store = new MemoryOperationStore(), operations = new OperationService(store, clock, journal); await operations.initialize();
  const states = new ActiveWorldStateStore(manager, [adapter]); await states.initialize();
  const library = new WorldLibraryStore(manager, clock), binding = { serverId: adapter.serverId, rootPath: server };
  await library.migrateLegacy(binding, states.snapshot(adapter.serverId)!);
  const uploads = new WorldImportUploadService(registry, operations, manager, undefined, journal, clock);
  const upload = await uploads.upload(adapter.serverId, "independent.zip", Readable.from([zip(level("imported", withDataVersion, dataVersion))]));
  const service = new WorldLibraryImportService(registry, operations, journal, library, uploads, states, clock, inject);
  const request = { name: "Independent", uploadId: upload.id };
  const catalogFile = path.join(manager, "world-library", adapter.serverId, "state.json");
  return { root, manager, server, adapter, status, registry, journal, store, operations, states, library, binding, uploads, service,
    request, catalogFile, original, start, stop };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function reconstructed(f: Fixture) {
  const journal = new TransactionJournalStore(f.manager), operations = new OperationService(f.store, clock, journal);
  const library = new WorldLibraryStore(f.manager, clock), uploads = new WorldImportUploadService(f.registry, operations, f.manager, undefined, journal, clock);
  return { journal, operations, library, service: new WorldLibraryImportService(f.registry, operations, journal, library, uploads, f.states, clock) };
}
async function httpFixture(worldActivationExecution = false) {
  const f = await fixture(); let sessionTime = 0; const sessions = new SessionCore(() => sessionTime);
  const authentication = new HttpAuthentication(new PasswordVerifier({ version: 1, username: "admin", revision: randomUUID(),
    salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }),
  { ready: () => true, record: async () => {}, close: async () => {} }, sessions);
  const app = buildApp({ mode: "local", adapters: [f.adapter], clock, managerRoot: f.manager, transactionJournal: f.journal,
    operationStore: f.store, activeWorldState: f.states, authentication, backupSchedulerTimers: false, worldActivationExecution });
  const token = sessions.create("local-http");
  const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui",
    cookie: `mcsm_local_session=${token.sessionToken}`, "x-csrf-token": token.csrfToken };
  const base = `/api/v1/servers/${f.adapter.serverId}/world-library`;
  return { ...f, app, authentication, sessions, headers, base, advanceSessionTime: (elapsedMs: number) => { sessionTime += elapsedMs; } };
}
describe("read-only replacement preparation (no replacement executor)", () => {
  it("binds source and current immutable identity without claiming or changing either world", async () => {
    const f = await fixture(), before = await readFile(f.catalogFile);
    const observed = await f.library.list(f.binding, f.states.snapshot(f.adapter.serverId));
    const plan = await f.service.planReplacement(f.adapter.serverId, { uploadId: f.request.uploadId });
    expect(plan).toMatchObject({ mode: "replace", currentWorldId: observed.activeWorldId, currentWorldName: "world",
      executionAvailable: false, requiresProtectedBackup: true, serverMustBeStopped: true,
      unavailableReason: "REPLACEMENT_TRANSACTION_PENDING" });
    expect(plan.currentContentRevision).toMatch(/^[0-9a-f]{64}$/u);
    expect(plan.propertiesRevision).toMatch(/^[0-9a-f]{64}$/u);
    expect(await readFile(f.catalogFile)).toEqual(before);
    expect(await readFile(path.join(f.server, "world", "level.dat"))).toEqual(f.original);
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
    expect((await f.journal.scan()).records).toHaveLength(0); expect(await f.store.list()).toHaveLength(0);
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    // A preview cannot consume the upload or reserve a new world identity.
    expect((await f.service.plan(f.adapter.serverId, f.request)).uploadId).toBe(f.request.uploadId);
  });
  it("rejects running servers without stopping them or creating evidence", async () => {
    const f = await fixture(); f.status.state = "running"; f.status.ownership = "managed";
    await expect(f.service.planReplacement(f.adapter.serverId, { uploadId: f.request.uploadId }))
      .rejects.toMatchObject({ code: "SERVER_MUST_BE_STOPPED" });
    expect(f.stop).not.toHaveBeenCalled(); expect((await f.journal.scan()).records).toHaveLength(0);
    expect(await f.store.list()).toHaveLength(0);
  });
  it("rejects a source belonging to another registered instance", async () => {
    const f = await fixture(), other = await fixture();
    const second = { ...other.adapter, serverId: "other-instance" } as LocalMinecraftServerAdapter;
    f.registry.add(second);
    const upload = await f.uploads.upload(second.serverId, "other.zip", Readable.from([zip(level("other", true))]));
    const catalog = await readFile(f.catalogFile), otherCatalog = await readFile(other.catalogFile);
    await expect(f.service.planReplacement(f.adapter.serverId, { uploadId: upload.id }))
      .rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect((await f.journal.scan()).records).toHaveLength(0); expect(await f.store.list()).toHaveLength(0);
    expect(await readFile(f.catalogFile)).toEqual(catalog); expect(await readFile(other.catalogFile)).toEqual(otherCatalog);
    expect((await f.uploads.validatedSource(second.serverId, upload.id)).revision).toBeTruthy();
  });
  it("uses observed target version rather than assuming the registered version is still valid", async () => {
    const f = await fixture();
    vi.spyOn(f.adapter, "getServerInfo").mockResolvedValue({ type: "vanilla", minecraftVersion: "future" } as Awaited<ReturnType<typeof f.adapter.getServerInfo>>);
    await expect(f.service.planReplacement(f.adapter.serverId, { uploadId: f.request.uploadId }))
      .rejects.toMatchObject({ code: "WORLD_VERSION_UNAVAILABLE" });
    expect((await f.journal.scan()).records).toHaveLength(0); expect(await f.store.list()).toHaveLength(0);
  });
  it("rejects newer uploaded world data without consuming the source", async () => {
    const f = await fixture();
    const newer = await f.uploads.upload(f.adapter.serverId, "newer.zip", Readable.from([zip(level("future", true, 101))]));
    await expect(f.service.planReplacement(f.adapter.serverId, { uploadId: newer.id }))
      .rejects.toMatchObject({ code: "WORLD_COMPATIBILITY_UNVERIFIED" });
    expect((await f.journal.scan()).records).toHaveLength(0); expect(await f.store.list()).toHaveLength(0);
    expect((await f.uploads.validatedSource(f.adapter.serverId, newer.id)).revision).toBeTruthy();
  });
  it("rejects changed configuration during the preview", async () => {
    const f = await fixture(), original = f.uploads.validatedSource.bind(f.uploads); let calls = 0;
    vi.spyOn(f.uploads, "validatedSource").mockImplementation(async (...args) => {
      const source = await original(...args);
      if (++calls === 2) await writeFile(path.join(f.server, "server.properties"), properties + "motd=external\n");
      return source;
    });
    await expect(f.service.planReplacement(f.adapter.serverId, { uploadId: f.request.uploadId }))
      .rejects.toMatchObject({ code: "WORLD_REVISION_CONFLICT" });
    expect((await f.journal.scan()).records).toHaveLength(0); expect(await f.store.list()).toHaveLength(0);
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties + "motd=external\n");
  });
  it("uses existing HTTP protection, rejects arbitrary targets and exposes no execution route", async () => {
    const f = await httpFixture();
    try {
      const url = `${f.base}/replacement-plan`, payload = { uploadId: f.request.uploadId };
      const accepted = await f.app.inject({ method: "POST", url, headers: f.headers, payload });
      expect(accepted.statusCode).toBe(200); expect(accepted.json().data.executionAvailable).toBe(false);
      for (const extra of [{ targetPath: "C:/outside" }, { name: "arbitrary" }, { mode: "replace" }]) {
        expect((await f.app.inject({ method: "POST", url, headers: f.headers, payload: { ...payload, ...extra } })).statusCode).toBe(400);
      }
      expect((await f.app.inject({ method: "POST", url, headers: { ...f.headers, "x-csrf-token": "invalid" }, payload })).statusCode).toBe(403);
      expect((await f.app.inject({ method: "POST", url, headers: { ...f.headers, cookie: "" }, payload })).statusCode).toBe(401);
      expect((await f.app.inject({ method: "POST", url: `${f.base}/replace`, headers: f.headers, payload })).statusCode).toBe(404);
      expect((await f.journal.scan()).records).toHaveLength(0); expect(await f.store.list()).toHaveLength(0);
      expect(await readFile(path.join(f.server, "world", "level.dat"))).toEqual(f.original);
    } finally { await f.app.close(); }
  });
});

describe("independent world import executor (isolated files, Fake Minecraft adapter)", () => {
  async function dimensionUpload(f: Fixture, dimension: string) {
    const entries = [["level.dat", level("namespaced", true, 5023)],
      [`dimensions/${dimension}/region/r.0.0.mca`, Buffer.from("synthetic-region-not-real-Minecraft")]] as const;
    const files = entries.map(([relative, bytes]) => {
      const file = new File([bytes], path.posix.basename(relative));
      Object.defineProperty(file, "webkitRelativePath", { value: `world/${relative}` }); return file;
    });
    const archive = await createWorldFolderArchive(files);
    return f.uploads.upload(f.adapter.serverId, "namespaced.zip", Readable.from([Buffer.from(await archive.arrayBuffer())]));
  }
  it("imports and plans activation for observed standard namespaced storage without changing the active world", async () => {
    const f = await fixture(undefined, true, 5023), upload = await dimensionUpload(f, "minecraft/overworld");
    await mkdir(path.join(f.server, "world", "dimensions", "minecraft", "the_end", "data", "minecraft"), { recursive: true });
    await writeFile(path.join(f.server, "world", "dimensions", "minecraft", "the_end", "data", "minecraft", "raids.dat"), "synthetic");
    const plan = await f.service.plan(f.adapter.serverId, { name: "Namespaced", uploadId: upload.id });
    const operation = await f.service.importIndependent(f.adapter.serverId, plan, randomUUID());
    const terminal = await complete(f.operations, operation.id); expect(terminal.state).toBe("succeeded");
    expect(f.states.snapshot(f.adapter.serverId)?.levelName).toBe("world");
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
    const activation = new WorldActivationPlanService(f.registry, f.operations, f.library, f.states,
      (serverId, worldId) => f.service.verifyInactiveForActivation(serverId, worldId));
    expect((await activation.plan(f.adapter.serverId, terminal.result!.resourceId!)).levelName).toBe("Namespaced");
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it.each(["modded/overworld", "minecraft/custom"])("blocks a custom dimension %s with no operation or configuration changes", async dimension => {
    const f = await fixture(undefined, true, 5023), upload = await dimensionUpload(f, dimension);
    const before = await f.store.list(), config = await readFile(path.join(f.server, "server.properties"));
    await expect(f.service.plan(f.adapter.serverId, { name: "Custom", uploadId: upload.id })).rejects.toMatchObject({ code: "WORLD_COMPATIBILITY_UNVERIFIED" });
    expect(await f.store.list()).toEqual(before); expect((await f.journal.scan()).records).toEqual([]);
    expect(await readFile(path.join(f.server, "server.properties"))).toEqual(config);
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it.each(["import", "activation"])("blocks an unknown current-world dimension before %s admission", async phase => {
    const f = await fixture(undefined, true, 5023);
    let importedId = "";
    if (phase === "activation") {
      const plan = await f.service.plan(f.adapter.serverId, f.request);
      const accepted = await f.service.importIndependent(f.adapter.serverId, plan, randomUUID());
      importedId = (await complete(f.operations, accepted.id)).result!.resourceId!;
    }
    const custom = path.join(f.server, "world", "dimensions", "modded", "mystery", "data");
    await mkdir(custom, { recursive: true }); await writeFile(path.join(custom, "unknown.dat"), "synthetic");
    const before = await f.store.list(), config = await readFile(path.join(f.server, "server.properties"));
    const action = phase === "import" ? f.service.plan(f.adapter.serverId, f.request) :
      new WorldActivationPlanService(f.registry, f.operations, f.library, f.states,
        (serverId, worldId) => f.service.verifyInactiveForActivation(serverId, worldId)).plan(f.adapter.serverId, importedId);
    await expect(action).rejects.toMatchObject({ code: "WORLD_COMPATIBILITY_UNVERIFIED" });
    expect(await f.store.list()).toEqual(before); expect(await readFile(path.join(f.server, "server.properties"))).toEqual(config);
    expect((await f.journal.scan()).records.filter(record => record.intent.worldActivation)).toEqual([]);
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  async function installedFixture() {
    const f = await fixture();
    const plan = await f.service.plan(f.adapter.serverId, f.request);
    const operation = await f.service.importIndependent(f.adapter.serverId, plan, randomUUID());
    const terminal = await complete(f.operations, operation.id);
    expect(terminal.state).toBe("succeeded");
    const id = terminal.result!.resourceId!;
    const activation = new WorldActivationPlanService(f.registry, f.operations, f.library, f.states,
      (serverId, worldId) => f.service.verifyInactiveForActivation(serverId, worldId));
    return { ...f, id, activation };
  }
  async function activationFixture(inject?: (point: string) => Promise<void>) {
    const f = await installedFixture(), plan = await f.activation.plan(f.adapter.serverId, f.id);
    const approval: WorldActivationApproval = { worldId: plan.worldId, libraryRevision: plan.libraryRevision, currentWorldId: plan.currentWorldId,
      currentWorldRevision: plan.currentWorldRevision, targetWorldRevision: plan.targetWorldRevision, currentContentRevision: plan.currentContentRevision,
      targetContentRevision: plan.targetContentRevision, propertiesRevision: plan.propertiesRevision, confirmWorldName: plan.levelName };
    const backups = new BackupService(f.registry, f.operations, f.journal, f.manager, clock);
    const controller = new WorldActivationService(f.registry, f.operations, f.journal, f.library, f.activation, f.states, backups, f.manager, clock, inject);
    return { ...f, approval, controller, backups };
  }
  function activationRestart(f: Fixture, afterProof?: () => void) {
    const journal = new TransactionJournalStore(f.manager), operations = new OperationService(f.store, clock, journal);
    const library = new WorldLibraryStore(f.manager, clock), states = new ActiveWorldStateStore(f.manager, [f.adapter]);
    const uploads = new WorldImportUploadService(f.registry, operations, f.manager, undefined, journal, clock);
    const backups = new BackupService(f.registry, operations, journal, f.manager, clock);
    const reconciler = new WorldActivationReconciler(f.registry, operations, journal, library, uploads, backups, f.manager);
    const imports = new WorldLibraryImportService(f.registry, operations, journal, library, uploads, states, clock, undefined,
      async record => { const proof = await reconciler.verifiesSupersession(record); if (proof) afterProof?.(); return proof; });
    return { journal, operations, library, states, uploads, reconciler, imports };
  }
  async function guardedActivationFixture(inject?: (point: string) => Promise<void>,
    timing?: <T>(label: string, action: () => Promise<T>) => Promise<T>) {
    const f = await installedFixture(), originalId = (await f.library.list(f.binding, f.states.snapshot(f.adapter.serverId))).activeWorldId!;
    const backups = new BackupService(f.registry, f.operations, f.journal, f.manager, clock);
    const protection = new WorldActivationHistoryProtection(f.registry, f.journal, f.library, backups, f.manager);
    const plans = new WorldActivationPlanService(f.registry, f.operations, f.library, f.states, async (serverId, worldId, revision) => {
      const history = (await f.journal.scan()).records.filter(record => record.intent.worldActivation);
      if (!history.length) return f.service.verifyInactiveForActivation(serverId, worldId);
      const evidence = await protection.verifyTarget(serverId, worldId, revision);
      if (evidence.kind === "import") await f.service.verifyInactiveForActivation(serverId, worldId);
      return { historyProof: evidence.historyProof };
    });
    const controller = new WorldActivationService(f.registry, f.operations, f.journal, f.library, plans, f.states,
      backups, f.manager, clock, inject, protection);
    if (timing) {
      const verify = protection.verify.bind(protection), target = protection.verifyTarget.bind(protection);
      const source = backups.exportSource.bind(backups), scan = f.journal.scan.bind(f.journal);
      const reserve = f.library.reserveActivation.bind(f.library), finish = f.library.completeActivation.bind(f.library);
      const plan = plans.plan.bind(plans), admit = controller.activate.bind(controller);
      vi.spyOn(protection, "verify").mockImplementation((...args) => timing("history-protection", () => verify(...args)));
      vi.spyOn(protection, "verifyTarget").mockImplementation((...args) => timing("target-proof", () => target(...args)));
      vi.spyOn(backups, "exportSource").mockImplementation((...args) => timing("guard-manifest", () => source(...args)));
      vi.spyOn(f.journal, "scan").mockImplementation((...args) => timing("journal-scan", () => scan(...args)));
      vi.spyOn(f.library, "reserveActivation").mockImplementation((...args) => timing("head-reserve", () => reserve(...args)));
      vi.spyOn(f.library, "completeActivation").mockImplementation((...args) => timing("head-complete", () => finish(...args)));
      vi.spyOn(plans, "plan").mockImplementation((...args) => timing("plan", () => plan(...args)));
      vi.spyOn(controller, "activate").mockImplementation((...args) => timing("admission", () => admit(...args)));
    }
    const activate = async (worldId: string) => {
      const plan = await plans.plan(f.adapter.serverId, worldId);
      const operation = await controller.activate(f.adapter.serverId, { ...plan, confirmWorldName: plan.levelName }, randomUUID());
      const terminal = timing ? await timing("operation-wait", () => complete(f.operations, operation.id)) : await complete(f.operations, operation.id);
      expect(terminal.state).toBe("succeeded");
      expect(f.states.snapshot(f.adapter.serverId)?.levelName).toBe(plan.levelName);
    };
    return { ...f, originalId, backups, protection, plans, controller, activate };
  }
  it("executes an unmounted guarded round trip to the original world without reverting legitimate saves", async () => {
    const events: Array<{ label: string; startMs: number; durationMs: number }> = [], origin = performance.now();
    const measure = async <T,>(label: string, action: () => Promise<T>): Promise<T> => {
      const start = performance.now();
      try { return await action(); } finally {
        if (events.length < 512) events.push({ label, startMs: Math.round((start - origin) * 1000) / 1000,
          durationMs: Math.round((performance.now() - start) * 1000) / 1000 });
      }
    };
    const enabled = process.env.LT_WORLD_ACTIVATION_TIMING === "1";
    try {
    const f = enabled ? await measure("fixture", () => guardedActivationFixture(undefined, measure)) : await guardedActivationFixture(), originalId = f.originalId;
    const { activate, protection } = f;
    await activate(f.id);
    await writeFile(path.join(f.server, "Independent", "saved-after-activation.dat"), "legitimate imported-world save");
    await activate(originalId);
    await writeFile(path.join(f.server, "world", "saved-after-return.dat"), "legitimate original-world save");
    await activate(f.id);
    const history = (await f.journal.scan()).records.filter(record => record.intent.worldActivation);
    expect(history).toHaveLength(3);
    expect(history.filter(record => record.schemaVersion === 11)).toHaveLength(2);
    await protection.verify(f.adapter.serverId);
    expect(await readFile(path.join(f.server, "Independent", "saved-after-activation.dat"), "utf8")).toBe("legitimate imported-world save");
    expect(await readFile(path.join(f.server, "world", "saved-after-return.dat"), "utf8")).toBe("legitimate original-world save");
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    } finally {
      if (enabled) console.info("WORLD_ACTIVATION_TIMING", JSON.stringify({ clock: "node-performance-monotonic", limit: 512,
        inclusive: true, events }));
    }
  });
  it("rechecks historical guards before a repeated configuration switch and retains a pending head on damage", async () => {
    const damage: { run?: () => Promise<void> } = {};
    const f = await guardedActivationFixture(async point => { if (point === "activation-switch-intent") await damage.run?.(); });
    await f.activate(f.id);
    const first = (await f.journal.scan()).records.find(record => record.intent.worldActivation)!;
    damage.run = () => writeFile(path.join(f.manager, "backups", f.adapter.serverId, first.intent.worldActivation!.guardBackupId, "payload", "world", "level.dat"), "damaged old protection");
    const plan = await f.plans.plan(f.adapter.serverId, f.originalId), before = await readFile(path.join(f.server, "server.properties"));
    const operation = await f.controller.activate(f.adapter.serverId, { ...plan, confirmWorldName: plan.levelName }, randomUUID());
    expect((await complete(f.operations, operation.id)).state).not.toBe("succeeded");
    expect(f.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    expect((await f.library.list(f.binding, f.states.snapshot(f.adapter.serverId))).state).toBe("inspection-required");
    expect(await readFile(path.join(f.server, "server.properties"))).toEqual(before);
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it.each(["intact", "inactive-change", "missing-active-slot", "late-guard-change", "import-root", "late-upload-change", "fresh-unfinished"])("observes guarded history after reconstruction: %s", async damage => {
    const f = await guardedActivationFixture(); await f.activate(f.id);
    await writeFile(path.join(f.server, "Independent", "normal-save.dat"), "legitimate active save");
    const restarted = activationRestart(f);
    const protection = new WorldActivationHistoryProtection(f.registry, restarted.journal, restarted.library, f.backups, f.manager);
    const reader = new WorldActivationLiveHistory(f.registry, restarted.journal, restarted.library, protection, restarted.uploads, f.manager);
    if (damage === "import-root") {
      const record = (await f.journal.scan()).records.find(item => item.intent.worldLibraryImport)!;
      const changed = structuredClone(record); Object.assign(changed.intent.worldLibraryImport!, { rootIdentity: "0".repeat(64) });
      await writeFile(path.join(f.manager, "transactions", `${f.adapter.serverId}.${record.transactionId}.json`), JSON.stringify(changed));
    }
    if (damage === "fresh-unfinished") {
      const verify = protection.verify.bind(protection), scan = restarted.journal.scan.bind(restarted.journal);
      let afterProtection = false;
      vi.spyOn(protection, "verify").mockImplementation(async (...args) => { const result = await verify(...args); afterProtection = true; return result; });
      vi.spyOn(restarted.journal, "scan").mockImplementation(async () => {
        const result = await scan(), source = result.records.find(item => item.intent.worldLibraryImport)!;
        return afterProtection ? { ...result, records: [...result.records, { ...source, transactionId: randomUUID(), state: "active" as const }] } : result;
      });
    }
    if (damage === "late-upload-change") {
      const source = restarted.uploads.validatedSource.bind(restarted.uploads), status = f.adapter.getStatus.bind(f.adapter);
      let directory: string | undefined;
      vi.spyOn(restarted.uploads, "validatedSource").mockImplementation(async (...args) => {
        const result = await source(...args); directory = result.directory; return result;
      });
      vi.spyOn(f.adapter, "getStatus").mockImplementation(async () => {
        if (directory) await writeFile(path.join(directory, "world", "level.dat"), "late source corruption");
        return status();
      });
    }
    if (damage === "inactive-change") await writeFile(path.join(f.server, "world", "unexpected.dat"), "unattributed change");
    if (damage === "missing-active-slot") await rename(path.join(f.manager, "active-worlds", `${f.adapter.serverId}.json`), path.join(f.root, "preserved-slot.json"));
    if (damage === "late-guard-change") {
      const readSource = restarted.uploads.validatedSource.bind(restarted.uploads);
      vi.spyOn(restarted.uploads, "validatedSource").mockImplementation(async (...args) => {
        const result = await readSource(...args), record = (await f.journal.scan()).records.find(item => item.intent.worldActivation)!;
        await writeFile(path.join(f.manager, "backups", f.adapter.serverId, record.intent.worldActivation!.guardBackupId, "payload", "world", "level.dat"), "changed while checking imports");
        return result;
      });
    }
    const before = await readFile(path.join(f.server, "server.properties")), catalog = await readFile(f.catalogFile);
    if (damage === "intact") expect(await reader.verify(f.adapter.serverId)).toMatchObject({ worldId: f.id });
    else await expect(reader.verify(f.adapter.serverId)).rejects.toThrow();
    expect(await readFile(path.join(f.server, "server.properties"))).toEqual(before);
    expect(await readFile(f.catalogFile)).toEqual(catalog);
    expect(await readFile(path.join(f.server, "Independent", "normal-save.dat"), "utf8")).toBe("legitimate active save");
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it.each(["intact", "unrelated-gate", "damaged", "wrong-proof"])("consumes exact whole-history proof without clearing other causes: %s", async scenario => {
    const f = await guardedActivationFixture(); await f.activate(f.id);
    await writeFile(path.join(f.server, "Independent", "normal-save.dat"), "legitimate subsequent save");
    const restarted = activationRestart(f), protection = new WorldActivationHistoryProtection(f.registry, restarted.journal, restarted.library, f.backups, f.manager);
    const reader = new WorldActivationLiveHistory(f.registry, restarted.journal, restarted.library, protection, restarted.uploads, f.manager);
    if (scenario === "unrelated-gate") restarted.operations.requireRecovery([f.adapter.serverId]);
    if (scenario === "damaged") await writeFile(path.join(f.server, "world", "external.dat"), "unattributed inactive write");
    if (scenario === "wrong-proof") {
      const verify = reader.verify.bind(reader);
      vi.spyOn(reader, "verify").mockImplementation(async (...args) => {
        const proof = await verify(...args); proof.verifiedOperations[0]!.operationId = randomUUID(); return proof;
      });
    }
    const service = new WorldLibraryImportService(f.registry, restarted.operations, restarted.journal, restarted.library,
      restarted.uploads, restarted.states, clock, undefined, undefined, reader);
    const props = await readFile(path.join(f.server, "server.properties")), catalog = await readFile(f.catalogFile);
    await service.reconcileStartup(); await restarted.operations.initialize();
    expect(restarted.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(scenario !== "intact");
    const owners = (await restarted.journal.scan()).records.filter(record => record.intent.worldActivation || record.intent.worldLibraryImport);
    for (const record of owners) expect(restarted.operations.get(record.intent.operationId)?.state).toBe(
      scenario === "intact" || scenario === "unrelated-gate" ? "succeeded" : "interrupted");
    expect(await readFile(path.join(f.server, "server.properties"))).toEqual(props);
    expect(await readFile(f.catalogFile)).toEqual(catalog);
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it("does not trust a within-plan proof when guard contents change before admission", async () => {
    const f = await guardedActivationFixture(); await f.activate(f.id);
    const request = await f.plans.plan(f.adapter.serverId, f.originalId);
    expect(JSON.stringify(request)).not.toContain("historyProof");
    const first = (await f.journal.scan()).records.find(record => record.intent.worldActivation)!;
    const before = await readFile(f.catalogFile), inspect = f.plans.inspectUnderLease.bind(f.plans);
    vi.spyOn(f.plans, "inspectUnderLease").mockImplementation(async (...args) => {
      const result = await inspect(...args);
      await writeFile(path.join(f.manager, "backups", f.adapter.serverId, first.intent.worldActivation!.guardBackupId, "payload", "world", "level.dat"), "changed after source proof");
      return result;
    });
    await expect(f.controller.activate(f.adapter.serverId, { ...request, confirmWorldName: request.levelName }, randomUUID())).rejects.toThrow();
    expect((await f.journal.scan()).records.filter(record => record.intent.worldActivation)).toHaveLength(1);
    expect(await readFile(f.catalogFile)).toEqual(before);
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it.each(["active", "recovery-required"] as const)("refuses a fresh scoped %s transaction after within-plan source verification", async state => {
    const f = await guardedActivationFixture(); await f.activate(f.id);
    const request = await f.plans.plan(f.adapter.serverId, f.originalId), before = await readFile(f.catalogFile);
    const scan = f.journal.scan.bind(f.journal), inspect = f.plans.inspectUnderLease.bind(f.plans);
    const source = (await scan()).records.find(record => record.intent.worldLibraryImport)!;
    let afterPlan = false;
    vi.spyOn(f.plans, "inspectUnderLease").mockImplementation(async (...args) => {
      const plan = await inspect(...args); afterPlan = true; return plan;
    });
    // Fake newly observed concurrent journal only; no user or fixture journal
    // is overwritten to create this scheduling-window test.
    vi.spyOn(f.journal, "scan").mockImplementation(async () => {
      const original = await scan();
      return afterPlan ? { ...original, records: [...original.records, { ...source, transactionId: randomUUID(), state,
        intent: { ...source.intent, operationId: randomUUID() } }] } : original;
    });
    await expect(f.controller.activate(f.adapter.serverId, { ...request, confirmWorldName: request.levelName }, randomUUID())).rejects.toThrow();
    expect((await scan()).records.filter(record => record.intent.worldActivation)).toHaveLength(1);
    expect(await readFile(f.catalogFile)).toEqual(before);
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it.each(["activation-head-reserved", "activation-commit-persisted"])("retains head uncertainty after %s without replay", async boundary => {
    const f = await guardedActivationFixture(async point => { if (point === boundary) throw new Error("isolated interruption"); });
    const plan = await f.plans.plan(f.adapter.serverId, f.id);
    const operation = await f.controller.activate(f.adapter.serverId, { ...plan, confirmWorldName: plan.levelName }, randomUUID());
    expect((await complete(f.operations, operation.id)).state).not.toBe("succeeded");
    const catalogBefore = await readFile(f.catalogFile), propsBefore = await readFile(path.join(f.server, "server.properties"));
    const restarted = activationRestart(f); await restarted.journal.initialize();
    await restarted.reconciler.reconcileStartup(); await restarted.imports.reconcileStartup(); await restarted.operations.initialize();
    expect(restarted.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    expect(await readFile(f.catalogFile)).toEqual(catalogBefore);
    expect(await readFile(path.join(f.server, "server.properties"))).toEqual(propsBefore);
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it.each(["activation-commit-persisted", "activation-head-completed"].flatMap(boundary =>
    ["guard", "copy", "world", "checkpoint"].map(damage => ({ boundary, damage }))))("refuses success after $damage corruption at $boundary", async ({ boundary, damage }) => {
    const mutation: { run?: () => Promise<void> } = {};
    const f = await guardedActivationFixture(async point => { if (point === boundary) await mutation.run?.(); });
    mutation.run = async () => {
      const record = (await f.journal.scan()).records.find(item => item.intent.worldActivation)!, w = record.intent.worldActivation!;
      if (damage === "checkpoint") {
        const changed = structuredClone(record), point = changed.checkpoints.find(item => item.name === "activation-config-installed")!;
        Object.assign(point.details!, { checksumSha256: "0".repeat(64) });
        await writeFile(path.join(f.manager, "transactions", `${f.adapter.serverId}.${record.transactionId}.json`), JSON.stringify(changed));
        return;
      }
      const file = damage === "guard" ? path.join(f.manager, "backups", f.adapter.serverId, w.guardBackupId, "payload", "world", "level.dat") :
        damage === "copy" ? path.join(f.server, w.workspaceName, "properties.before") : path.join(f.server, "Independent", "new-file.dat");
      await writeFile(file, "corrupted during publication");
    };
    const plan = await f.plans.plan(f.adapter.serverId, f.id);
    const operation = await f.controller.activate(f.adapter.serverId, { ...plan, confirmWorldName: plan.levelName }, randomUUID());
    expect((await complete(f.operations, operation.id)).state).not.toBe("succeeded");
    expect(f.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    const catalog = JSON.parse(await readFile(f.catalogFile, "utf8"));
    expect(catalog.transitionHead.state).toBe("pending");
    await expect(f.protection.verify(f.adapter.serverId)).rejects.toThrow();
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it("verifies historical protection independently of later live world saves without authorizing head adoption", async () => {
    const f = await activationFixture(), operation = await f.controller.activate(f.adapter.serverId, f.approval, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("succeeded");
    const record = (await f.journal.scan()).records.find(item => item.intent.worldActivation)!;
    await writeFile(path.join(f.server, "world", "later-save.dat"), "a later save is not guard corruption");
    const backups = f.backups;
    const proof = await verifyActivationProtection(record, f.server, f.manager, backups);
    await proof.recheck();
    const gate = new WorldActivationHistoryProtection(f.registry, f.journal, f.library, backups, f.manager);
    // Existing schema10 history has no durable head: no automatic adoption.
    await expect(gate.verify(f.adapter.serverId)).rejects.toThrow();
    // Explicit test setup only: publish a head around already verified fixture
    // evidence. The product has no automatic adoption or execution caller.
    const pending = await f.library.reserveActivation(f.binding, f.approval.libraryRevision,
      { ...record, state: "active", checkpoints: [] }, []);
    await f.library.completeActivation(f.binding, pending, [record]);
    const accepted = await gate.verify(f.adapter.serverId);
    expect(accepted.records.map(item => item.transactionId)).toEqual([record.transactionId]);
    await writeFile(path.join(f.manager, "backups", f.adapter.serverId, record.intent.worldActivation!.guardBackupId, "payload", "world", "level.dat"), "corrupt");
    await expect(gate.verify(f.adapter.serverId)).rejects.toThrow();
    expect(await readFile(path.join(f.server, "world", "later-save.dat"), "utf8")).toBe("a later save is not guard corruption");
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it.each(["guard", "before", "approved", "workspace"])("rechecks historical protection when %s changes after the first observation", async damage => {
    const f = await activationFixture(), operation = await f.controller.activate(f.adapter.serverId, f.approval, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("succeeded");
    const record = (await f.journal.scan()).records.find(item => item.intent.worldActivation)!, value = record.intent.worldActivation!;
    const backups = f.backups;
    const proof = await verifyActivationProtection(record, f.server, f.manager, backups);
    if (damage === "guard") await writeFile(path.join(f.manager, "backups", f.adapter.serverId, value.guardBackupId, "payload", "world", "level.dat"), "damaged");
    else if (damage === "workspace") {
      const workspace = path.join(f.server, value.workspaceName);
      await rename(workspace, workspace + "-preserved"); await mkdir(workspace);
    } else await writeFile(path.join(f.server, value.workspaceName, damage === "before" ? "properties.before" : "properties.approved"), "damaged");
    const props = await readFile(path.join(f.server, "server.properties"));
    await expect(proof.recheck()).rejects.toThrow();
    expect(await readFile(path.join(f.server, "server.properties"))).toEqual(props);
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it.each(["guard", "before", "approved"])("rejects %s damage during the aggregate history gate's final status callback", async damage => {
    const f = await activationFixture(), operation = await f.controller.activate(f.adapter.serverId, f.approval, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("succeeded");
    const record = (await f.journal.scan()).records.find(item => item.intent.worldActivation)!, w = record.intent.worldActivation!;
    const pending = await f.library.reserveActivation(f.binding, f.approval.libraryRevision, { ...record, state: "active", checkpoints: [] }, []);
    await f.library.completeActivation(f.binding, pending, [record]);
    let calls = 0;
    const status = f.adapter.getStatus.bind(f.adapter);
    vi.spyOn(f.adapter, "getStatus").mockImplementation(async () => {
      if (++calls === 3) {
        const file = damage === "guard" ? path.join(f.manager, "backups", f.adapter.serverId, w.guardBackupId, "payload", "world", "level.dat") :
          path.join(f.server, w.workspaceName, damage === "before" ? "properties.before" : "properties.approved");
        await writeFile(file, "damaged during final status");
      }
      return status();
    });
    const props = await readFile(path.join(f.server, "server.properties"));
    const gate = new WorldActivationHistoryProtection(f.registry, f.journal, f.library, f.backups, f.manager);
    await expect(gate.verify(f.adapter.serverId)).rejects.toThrow();
    expect(calls).toBe(3);
    expect(await readFile(path.join(f.server, "server.properties"))).toEqual(props);
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it("verifies committed activation after legitimate target/settings changes without replay or rewriting world data", async () => {
    const f = await activationFixture(), operation = await f.controller.activate(f.adapter.serverId, f.approval, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("succeeded");
    await writeFile(path.join(f.server, "Independent", "new-chunk.dat"), "legitimate world save");
    const live = properties.replace("level-name=world", "level-name=Independent").replace("max-players=20", "max-players=25");
    await writeFile(path.join(f.server, "server.properties"), live);
    const restart = activationRestart(f); await restart.journal.initialize();
    await restart.reconciler.reconcileStartup(); await restart.imports.reconcileStartup(); await restart.operations.initialize();
    expect(restart.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
    expect(restart.operations.get(operation.id)?.state).toBe("succeeded");
    expect(restart.operations.get(operation.id)?.result?.resourceId).toBe(f.id);
    expect(await readFile(path.join(f.server, "Independent", "new-chunk.dat"), "utf8")).toBe("legitimate world save");
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(live);
    expect(await readFile(path.join(f.server, "world", "level.dat"))).toEqual(f.original);
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it.each(["guard", "copy", "active-slot", "target-metadata", "previous-world", "missing-checkpoint"])("keeps committed activation gated when %s evidence is damaged", async damage => {
    const f = await activationFixture(), operation = await f.controller.activate(f.adapter.serverId, f.approval, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("succeeded");
    const record = (await f.journal.scan()).records.find(item => item.intent.worldActivation)!, w = record.intent.worldActivation!;
    if (damage === "guard") await writeFile(path.join(f.manager, "backups", f.adapter.serverId, w.guardBackupId, "payload", "world", "level.dat"), "corrupt");
    if (damage === "copy") await rm(path.join(f.server, w.workspaceName, "properties.before"));
    if (damage === "active-slot") await rename(path.join(f.manager, "active-worlds", `${f.adapter.serverId}.json`), path.join(f.root, "preserved-active-slot.json"));
    if (damage === "target-metadata") await writeFile(path.join(f.server, "Independent", "level.dat"), "corrupt");
    if (damage === "previous-world") await writeFile(path.join(f.server, "world", "external.dat"), "unexpected old-world change");
    if (damage === "missing-checkpoint") await writeFile(path.join(f.manager, "transactions", `${f.adapter.serverId}.${record.transactionId}.json`),
      JSON.stringify({ ...record, checkpoints: record.checkpoints.slice(0, -1) }));
    const props = await readFile(path.join(f.server, "server.properties"));
    const restart = activationRestart(f); await restart.journal.initialize();
    await restart.reconciler.reconcileStartup(); await restart.imports.reconcileStartup(); await restart.operations.initialize();
    expect(restart.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    expect(restart.operations.get(operation.id)?.state).toBe("interrupted");
    expect(await readFile(path.join(f.server, "server.properties"))).toEqual(props);
    if (damage === "active-slot") await expect(readFile(path.join(f.manager, "active-worlds", `${f.adapter.serverId}.json`))).rejects.toMatchObject({ code: "ENOENT" });
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it("does not clear an unrelated recovery cause after verifying committed activation", async () => {
    const f = await activationFixture(), operation = await f.controller.activate(f.adapter.serverId, f.approval, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("succeeded");
    const restart = activationRestart(f); await restart.journal.initialize();
    restart.operations.requireRecovery([f.adapter.serverId]);
    await restart.reconciler.reconcileStartup(); await restart.imports.reconcileStartup(); await restart.operations.initialize();
    expect(restart.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
  });
  it.each(["guard", "before", "approved"])("rejects %s protection damage occurring during awaited source verification", async damage => {
    const f = await activationFixture(), operation = await f.controller.activate(f.adapter.serverId, f.approval, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("succeeded");
    const record = (await f.journal.scan()).records.find(item => item.intent.worldActivation)!, w = record.intent.worldActivation!;
    const restart = activationRestart(f), readSource = restart.uploads.validatedSource.bind(restart.uploads);
    let damaged = false;
    vi.spyOn(restart.uploads, "validatedSource").mockImplementation(async (...args) => {
      const source = await readSource(...args);
      if (!damaged) {
        damaged = true;
        const file = damage === "guard" ? path.join(f.manager, "backups", f.adapter.serverId, w.guardBackupId, "payload", "world", "level.dat")
          : path.join(f.server, w.workspaceName, damage === "before" ? "properties.before" : "properties.approved");
        await writeFile(file, "late damage");
      }
      return source;
    });
    await restart.journal.initialize(); await restart.reconciler.reconcileStartup(); await restart.imports.reconcileStartup(); await restart.operations.initialize();
    expect(damaged).toBe(true);
    expect(restart.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    expect(restart.operations.get(operation.id)?.state).toBe("interrupted");
  });
  it("rechecks live level-name after an awaited final process status observation", async () => {
    const f = await activationFixture(), operation = await f.controller.activate(f.adapter.serverId, f.approval, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("succeeded");
    let calls = 0;
    vi.spyOn(f.adapter, "getStatus").mockImplementation(async () => {
      if (++calls === 2) await writeFile(path.join(f.server, "server.properties"), properties);
      return { ...f.status } as Awaited<ReturnType<typeof f.adapter.getStatus>>;
    });
    const restart = activationRestart(f); await restart.journal.initialize();
    await restart.reconciler.reconcileStartup(); await restart.imports.reconcileStartup(); await restart.operations.initialize();
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(restart.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    expect(restart.operations.get(operation.id)?.state).toBe("interrupted");
  });
  it("does not reuse a proof when activation evidence disappears during the importer's next source read", async () => {
    const f = await activationFixture(), operation = await f.controller.activate(f.adapter.serverId, f.approval, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("succeeded");
    const record = (await f.journal.scan()).records.find(item => item.intent.worldActivation)!;
    let sawProof = false, removed = false;
    const restart = activationRestart(f, () => { sawProof = true; }), readSource = restart.uploads.validatedSource.bind(restart.uploads);
    vi.spyOn(restart.uploads, "validatedSource").mockImplementation(async (...args) => {
      const source = await readSource(...args);
      if (sawProof && !removed) {
        removed = true;
        await rename(path.join(f.manager, "transactions", `${f.adapter.serverId}.${record.transactionId}.json`), path.join(f.root, "preserved-late-activation.json"));
      }
      return source;
    });
    await restart.journal.initialize(); await restart.reconciler.reconcileStartup(); await restart.imports.reconcileStartup(); await restart.operations.initialize();
    expect(removed).toBe(true);
    expect(restart.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    expect(restart.operations.get(operation.id)?.state).toBe("interrupted");
    expect((await restart.journal.scan()).records).toHaveLength(1);
  });
  it("reconstructs the exact world result after commit precedes operation-result publication", async () => {
    const f = await activationFixture(), operation = await f.controller.activate(f.adapter.serverId, f.approval, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("succeeded");
    const saved = (await f.store.list()).find(item => item.operation.id === operation.id)!;
    await f.store.save({ ...saved, operation: { ...saved.operation, state: "running", result: null } });
    const restart = activationRestart(f); await restart.journal.initialize();
    await restart.reconciler.reconcileStartup(); await restart.imports.reconcileStartup(); await restart.operations.initialize();
    expect(restart.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
    expect(restart.operations.get(operation.id)).toMatchObject({ state: "succeeded", result: { resourceId: f.id, rollbackAvailable: false } });
  });
  it("integrates read-only activation recovery into real Fastify startup before state publication", async () => {
    const f = await activationFixture(), operation = await f.controller.activate(f.adapter.serverId, f.approval, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("succeeded");
    await writeFile(path.join(f.server, "Independent", "new-chunk.dat"), "saved data");
    const states = new ActiveWorldStateStore(f.manager, [f.adapter]);
    const app = buildApp({ mode: "local", adapters: [f.adapter], clock, managerRoot: f.manager, transactionJournal: new TransactionJournalStore(f.manager),
      operationStore: f.store, activeWorldState: states, backupSchedulerTimers: false });
    try {
      const response = await app.inject({ method: "GET", url: `/api/v1/operations/${operation.id}`, headers: { host: "127.0.0.1:8080" } });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({ state: "succeeded", result: { resourceId: f.id } });
      const library = await app.inject({ method: "GET", url: `/api/v1/servers/${f.adapter.serverId}/world-library`, headers: { host: "127.0.0.1:8080" } });
      expect(library.json().data.activeWorldId).toBe(f.id);
      expect(await readFile(path.join(f.server, "Independent", "new-chunk.dat"), "utf8")).toBe("saved data");
      expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it("serves a strict authenticated activation plan and keeps candidate execution disabled", async () => {
    const f = await httpFixture(), plan = await f.service.plan(f.adapter.serverId, f.request);
    const imported = await f.service.importIndependent(f.adapter.serverId, plan, randomUUID());
    const terminal = await complete(f.operations, imported.id), worldId = terminal.result!.resourceId!;
    const plans = new WorldActivationPlanService(f.registry, f.operations, f.library, f.states,
      (id, world) => f.service.verifyInactiveForActivation(id, world));
    registerWorldActivationRoutes(f.app, plans, clock, "local");
    try {
      const result = await f.app.inject({ method: "POST", url: `${f.base}/activation-plan`, headers: f.headers, payload: { worldId } });
      expect(result.statusCode).toBe(200); expect(result.json().data).toMatchObject({ worldId, executionAvailable: false, loadVerified: false });
      const body = result.json().data;
      for (const payload of [{ worldId, path: "untrusted" }, { worldId: [worldId] }, { worldId, allowStop: true }]) {
        const rejected = await f.app.inject({ method: "POST", url: `${f.base}/activation-plan`, headers: f.headers, payload });
        expect(rejected.statusCode).toBe(400);
      }
      const approval = { worldId, libraryRevision: body.libraryRevision, currentWorldId: body.currentWorldId,
        currentWorldRevision: body.currentWorldRevision, targetWorldRevision: body.targetWorldRevision,
        currentContentRevision: body.currentContentRevision, targetContentRevision: body.targetContentRevision,
        propertiesRevision: body.propertiesRevision, confirmWorldName: body.levelName };
      const denied = await f.app.inject({ method: "POST", url: `${f.base}/activate`, headers: { ...f.headers, "idempotency-key": randomUUID() }, payload: approval });
      expect(denied.statusCode).toBe(409); expect(denied.json().error.code).toBe("ACTION_UNAVAILABLE");
      const unauthenticated = await f.app.inject({ method: "POST", url: `${f.base}/activation-plan`, headers: { host: "127.0.0.1:8080", origin: f.headers.origin }, payload: { worldId } });
      expect(unauthenticated.statusCode).toBe(401);
      for (const headers of [{ ...f.headers, "x-csrf-token": "invalid" }, { ...f.headers, origin: "https://untrusted.invalid" }]) {
        const blocked = await f.app.inject({ method: "POST", url: `${f.base}/activation-plan`, headers, payload: { worldId } });
        expect(blocked.statusCode).toBe(403);
      }
      expect((await f.journal.scan()).records.some(record => record.intent.worldActivation)).toBe(false);
      expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
    } finally { await f.app.close(); }
  });
  async function activationHttpFixture(inject?: (point: string) => Promise<void>) {
    const f = await httpFixture(), importPlan = await f.service.plan(f.adapter.serverId, f.request);
    const imported = await f.service.importIndependent(f.adapter.serverId, importPlan, randomUUID());
    const terminal = await complete(f.operations, imported.id), worldId = terminal.result!.resourceId!;
    const backups = new BackupService(f.registry, f.operations, f.journal, f.manager, clock);
    const protection = new WorldActivationHistoryProtection(f.registry, f.journal, f.library, backups, f.manager);
    const plans = new WorldActivationPlanService(f.registry, f.operations, f.library, f.states,
      (id, world) => f.service.verifyInactiveForActivation(id, world));
    const controller = new WorldActivationService(f.registry, f.operations, f.journal, f.library, plans, f.states, backups, f.manager, clock, inject, protection);
    registerWorldActivationRoutes(f.app, plans, clock, "local", f.authentication, controller);
    const response = await f.app.inject({ method: "POST", url: `${f.base}/activation-plan`, headers: f.headers, payload: { worldId } });
    expect(response.statusCode).toBe(200);
    const plan = response.json().data;
    const approval = { worldId, libraryRevision: plan.libraryRevision, currentWorldId: plan.currentWorldId,
      currentWorldRevision: plan.currentWorldRevision, targetWorldRevision: plan.targetWorldRevision,
      currentContentRevision: plan.currentContentRevision, targetContentRevision: plan.targetContentRevision,
      propertiesRevision: plan.propertiesRevision, confirmWorldName: plan.levelName };
    return { ...f, plans, controller, worldId, approval, send: (body: typeof approval, key: string) =>
      f.app.inject({ method: "POST", url: `${f.base}/activate`, headers: { ...f.headers, "idempotency-key": key }, payload: body }) };
  }
  it("executes actual activation through candidate HTTP and replays only the same operation", async () => {
    const f = await activationHttpFixture(), key = randomUUID();
    try {
      const accepted = await f.send(f.approval, key); expect(accepted.statusCode).toBe(202);
      const operationId = accepted.json().data.operation.id;
      expect((await complete(f.operations, operationId)).state).toBe("succeeded");
      const replay = await f.send(f.approval, key); expect(replay.statusCode).toBe(202); expect(replay.json().data.operation.id).toBe(operationId);
      const conflict = await f.send({ ...f.approval, confirmWorldName: "different" }, key); expect(conflict.statusCode).toBe(409);
      expect((await f.journal.scan()).records.filter(record => record.intent.worldActivation)).toHaveLength(1);
      expect(JSON.parse(await readFile(f.catalogFile, "utf8")).transitionHead.state).toBe("committed");
      expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties.replace("level-name=world", "level-name=Independent"));
      expect(await readFile(path.join(f.server, "world", "level.dat"))).toEqual(f.original);
      expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    } finally { await f.app.close(); }
  });
  it("rejects stale activation approval through HTTP without new intent or config changes", async () => {
    const f = await activationHttpFixture();
    try {
      const before = await readFile(f.catalogFile), stored = await f.store.list();
      const response = await f.send({ ...f.approval, libraryRevision: "0".repeat(64) }, randomUUID());
      expect(response.statusCode).toBe(409);
      expect((await f.journal.scan()).records.some(record => record.intent.worldActivation)).toBe(false);
      expect(await readFile(f.catalogFile)).toEqual(before); expect(await f.store.list()).toEqual(stored);
      expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
    } finally { await f.app.close(); }
  });
  it("rejects invalid write headers, coercible approval fields and mismatched confirmation before admission", async () => {
    const f = await activationHttpFixture();
    try {
      const before = await readFile(f.catalogFile), stored = await f.store.list();
      const requests = [
        { payload: f.approval, headers: f.headers, status: 428 },
        { payload: f.approval, headers: { ...f.headers, "idempotency-key": "invalid" }, status: 428 },
        { payload: f.approval, headers: { ...f.headers, "idempotency-key": randomUUID(), "x-csrf-token": "invalid" }, status: 403 },
        { payload: f.approval, headers: { ...f.headers, "idempotency-key": randomUUID(), origin: "https://untrusted.invalid" }, status: 403 },
        { payload: { ...f.approval, worldId: [f.worldId] }, headers: { ...f.headers, "idempotency-key": randomUUID() }, status: 400 },
        { payload: { ...f.approval, allowStop: true }, headers: { ...f.headers, "idempotency-key": randomUUID() }, status: 400 },
        { payload: { ...f.approval, targetPath: "untrusted" }, headers: { ...f.headers, "idempotency-key": randomUUID() }, status: 400 },
        { payload: { ...f.approval, confirmWorldName: "wrong-world" }, headers: { ...f.headers, "idempotency-key": randomUUID() }, status: 409 }
      ];
      for (const request of requests) {
        const response = await f.app.inject({ method: "POST", url: `${f.base}/activate`, headers: request.headers, payload: request.payload });
        expect(response.statusCode).toBe(request.status);
        expect((await f.journal.scan()).records.some(record => record.intent.worldActivation)).toBe(false);
        expect(await readFile(f.catalogFile)).toEqual(before); expect(await f.store.list()).toEqual(stored);
      }
      expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
      expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    } finally { await f.app.close(); }
  });
  it.each(["revoked", "expired"])("rechecks HTTP activation authorization after awaited source validation: %s", async scenario => {
    const f = await activationHttpFixture();
    try {
      const before = await readFile(f.catalogFile), stored = await f.store.list(), source = f.uploads.validatedSource.bind(f.uploads);
      vi.spyOn(f.uploads, "validatedSource").mockImplementationOnce(async (...args) => {
        const result = await source(...args);
        if (scenario === "revoked") f.sessions.clear(); else f.advanceSessionTime(8 * 60 * 60_000 + 1);
        return result;
      });
      const response = await f.send(f.approval, randomUUID()); expect(response.statusCode).toBe(401);
      expect((await f.journal.scan()).records.some(record => record.intent.worldActivation)).toBe(false);
      expect(await readFile(f.catalogFile)).toEqual(before); expect(await f.store.list()).toEqual(stored);
      expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
    } finally { await f.app.close(); }
  });
  it("retains an unknown HTTP activation result and never repeats its switch", async () => {
    const f = await activationHttpFixture(async point => { if (point === "activation-config-installed") throw new Error("isolated boundary loss"); }), key = randomUUID();
    try {
      const accepted = await f.send(f.approval, key); expect(accepted.statusCode).toBe(202);
      const id = accepted.json().data.operation.id;
      expect((await complete(f.operations, id)).state).not.toBe("succeeded");
      const before = await readFile(f.catalogFile), props = await readFile(path.join(f.server, "server.properties"));
      const replay = await f.send(f.approval, key); expect(replay.statusCode).toBe(202); expect(replay.json().data.operation.id).toBe(id);
      expect((await f.journal.scan()).records.filter(record => record.intent.worldActivation)).toHaveLength(1);
      expect(await readFile(f.catalogFile)).toEqual(before); expect(await readFile(path.join(f.server, "server.properties"))).toEqual(props);
      expect(f.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
      expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    } finally { await f.app.close(); }
  });
  it("publishes repeated guarded recovery through the real Fastify startup coordinator", async () => {
    const f = await guardedActivationFixture(); await f.activate(f.id); await f.activate(f.originalId);
    const app = buildApp({ mode: "local", adapters: [f.adapter], clock, managerRoot: f.manager,
      transactionJournal: new TransactionJournalStore(f.manager), operationStore: f.store,
      activeWorldState: new ActiveWorldStateStore(f.manager, [f.adapter]), backupSchedulerTimers: false });
    try {
      await app.ready(); await app.managerRecovery.wait();
      const response = await app.inject({ method: "GET", url: `/api/v1/servers/${f.adapter.serverId}/world-library`, headers: { host: "127.0.0.1:8080" } });
      expect(response.statusCode).toBe(200); expect(response.json().data.activeWorldId).toBe(f.originalId);
      for (const record of (await f.journal.scan()).records) {
        const result = await app.inject({ method: "GET", url: `/api/v1/operations/${record.intent.operationId}`, headers: { host: "127.0.0.1:8080" } });
        expect(result.json().data.state).toBe("succeeded");
      }
      expect(app.managerRecovery.stages.some(stage => stage.phase === "world-library-import-reconcile" && stage.result === "PASS")).toBe(true);
      expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it("shares production activation operations across HTTP queries and WebSocket events", async () => {
    const f = await fixture();
    Object.assign(f.adapter, { streamSnapshot: async () => ({ streamId: "isolated-runtime", latestSequence: 0,
      status: { ...f.status, source: "process", observedAt: clock.now().toISOString(), activeOperationId: null }, logs: [] }) });
    const app = buildApp({ mode: "local", adapters: [f.adapter], clock, managerRoot: f.manager,
      transactionJournal: f.journal, operationStore: f.store, activeWorldState: f.states,
      backupSchedulerTimers: false, worldActivationExecution: true });
    const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui" };
    const base = `/api/v1/servers/${f.adapter.serverId}/world-library`;
    let socket: Awaited<ReturnType<typeof app.injectWS>> | undefined;
    const events: Array<{ type: string; operation?: { id: string; state: string } }> = [];
    try {
      await app.ready();
      const importPlan = await app.inject({ method: "POST", url: `${base}/import-plan`, headers, payload: f.request });
      expect(importPlan.statusCode).toBe(200);
      const importData = importPlan.json().data;
      const body = { name: importData.name, uploadId: importData.uploadId, mode: importData.mode, uploadRevision: importData.uploadRevision,
        libraryRevision: importData.libraryRevision, currentWorldId: importData.currentWorldId, currentWorldRevision: importData.currentWorldRevision };
      const imported = await app.inject({ method: "POST", url: `${base}/import`, headers: { ...headers, "idempotency-key": randomUUID() }, payload: body });
      expect(imported.statusCode).toBe(202);
      const wait = async (id: string) => {
        let outcome: { state: string; result: { resourceId: string } } | undefined;
        await vi.waitFor(async () => {
          const response = await app.inject({ method: "GET", url: `/api/v1/operations/${id}`, headers });
          expect(response.statusCode).toBe(200); outcome = response.json().data; expect(outcome!.state).toBe("succeeded");
        });
        return outcome!;
      };
      const worldId = (await wait(imported.json().data.operation.id)).result.resourceId;
      socket = await app.injectWS(`/ws/v1/servers/${f.adapter.serverId}/events`, { headers }, {
        onInit: client => client.on("message", data => events.push(JSON.parse(data.toString())))
      });
      const plan = await app.inject({ method: "POST", url: `${base}/activation-plan`, headers, payload: { worldId } });
      expect(plan.statusCode).toBe(200); expect(plan.json().data.executionAvailable).toBe(true); expect(plan.json().data.loadVerified).toBe(false);
      const planData = plan.json().data, levelName = planData.levelName;
      const approval = { worldId: planData.worldId, libraryRevision: planData.libraryRevision, currentWorldId: planData.currentWorldId,
        currentWorldRevision: planData.currentWorldRevision, targetWorldRevision: planData.targetWorldRevision,
        currentContentRevision: planData.currentContentRevision, targetContentRevision: planData.targetContentRevision, propertiesRevision: planData.propertiesRevision };
      const key = randomUUID(), payload = { ...approval, confirmWorldName: levelName };
      const accepted = await app.inject({ method: "POST", url: `${base}/activate`, headers: { ...headers, "idempotency-key": key }, payload });
      expect(accepted.statusCode).toBe(202);
      const operationId = accepted.json().data.operation.id, terminal = await wait(operationId);
      expect(terminal.result.resourceId).toBe(worldId);
      await vi.waitFor(() => expect(events.some(event => event.type === "operation" && event.operation?.id === operationId && event.operation.state === "succeeded")).toBe(true));
      const replay = await app.inject({ method: "POST", url: `${base}/activate`, headers: { ...headers, "idempotency-key": key }, payload });
      expect(replay.json().data.operation.id).toBe(operationId);
      const library = await app.inject({ method: "GET", url: base, headers }); expect(library.json().data.activeWorldId).toBe(worldId);
      expect(library.json().data.activationAvailable).toBe(true);
      const version = f.adapter.plan.serverInfo.minecraftVersion;
      try {
        f.adapter.plan.serverInfo.minecraftVersion = "1.21";
        const unsupported = await app.inject({ method: "GET", url: base, headers });
        expect(unsupported.statusCode).toBe(200);
        expect(unsupported.json().data.activationAvailable).toBe(false);
      } finally { f.adapter.plan.serverInfo.minecraftVersion = version; }
      expect((await f.journal.scan()).records.filter(record => record.intent.worldActivation)).toHaveLength(1);
      expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    } finally { socket?.close(); await app.close(); }
  });
  it("retains session and CSRF protection on the shared production activation composition", async () => {
    const f = await httpFixture(true);
    try {
      const importPlan = await f.app.inject({ method: "POST", url: `${f.base}/import-plan`, headers: f.headers, payload: f.request });
      const planData = importPlan.json().data;
      const request = { name: planData.name, uploadId: planData.uploadId, mode: planData.mode, uploadRevision: planData.uploadRevision,
        libraryRevision: planData.libraryRevision, currentWorldId: planData.currentWorldId, currentWorldRevision: planData.currentWorldRevision };
      const imported = await f.app.inject({ method: "POST", url: `${f.base}/import`, headers: { ...f.headers, "idempotency-key": randomUUID() }, payload: request });
      let worldId = "";
      await vi.waitFor(async () => {
        const operation = await f.app.inject({ method: "GET", url: `/api/v1/operations/${imported.json().data.operation.id}`, headers: f.headers });
        expect(operation.json().data.state).toBe("succeeded"); worldId = operation.json().data.result.resourceId;
      });
      const prepared = await f.app.inject({ method: "POST", url: `${f.base}/activation-plan`, headers: f.headers, payload: { worldId } });
      expect(prepared.statusCode).toBe(200);
      const plan = prepared.json().data, payload = { worldId, libraryRevision: plan.libraryRevision, currentWorldId: plan.currentWorldId,
        currentWorldRevision: plan.currentWorldRevision, targetWorldRevision: plan.targetWorldRevision,
        currentContentRevision: plan.currentContentRevision, targetContentRevision: plan.targetContentRevision,
        propertiesRevision: plan.propertiesRevision, confirmWorldName: plan.levelName };
      const before = await readFile(f.catalogFile), stored = await f.store.list();
      const denied = await f.app.inject({ method: "POST", url: `${f.base}/activate`, headers: { ...f.headers, "x-csrf-token": "invalid", "idempotency-key": randomUUID() }, payload });
      expect(denied.statusCode).toBe(403);
      const original = WorldImportUploadService.prototype.validatedSource;
      const spy = vi.spyOn(WorldImportUploadService.prototype, "validatedSource").mockImplementationOnce(async function (this: WorldImportUploadService, ...args) {
        const value = await original.apply(this, args); f.sessions.clear(); return value;
      });
      try {
        const rejected = await f.app.inject({ method: "POST", url: `${f.base}/activate`, headers: { ...f.headers, "idempotency-key": randomUUID() }, payload });
        expect(rejected.statusCode).toBe(401);
      } finally { spy.mockRestore(); }
      expect((await f.journal.scan()).records.some(record => record.intent.worldActivation)).toBe(false);
      expect(await readFile(f.catalogFile)).toEqual(before); expect(await f.store.list()).toEqual(stored);
      expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
    } finally { await f.app.close(); }
  });
  it("leaves production activation routes absent by default", async () => {
    const f = await httpFixture();
    try {
      const library = await f.app.inject({ method: "GET", url: f.base, headers: f.headers });
      expect(library.json().data.activationAvailable).toBe(false);
      const response = await f.app.inject({ method: "POST", url: `${f.base}/activation-plan`, headers: f.headers,
        payload: { worldId: "worldv2-12345678-1234-4123-8123-123456789012" } });
      expect(response.statusCode).toBe(404);
      expect((await f.journal.scan()).records).toHaveLength(0);
      expect(await f.store.list()).toHaveLength(0);
      expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
    } finally { await f.app.close(); }
  });
  it("keeps HTTP admission closed and joins a pending repeated recovery when Manager closes", async () => {
    const f = await guardedActivationFixture(); await f.activate(f.id); await f.activate(f.originalId);
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), reached = new Promise<void>(resolve => { entered = resolve; });
    const status = f.adapter.getStatus.bind(f.adapter);
    vi.spyOn(f.adapter, "getStatus").mockImplementation(async () => { entered(); await held; return status(); });
    const catalog = await readFile(f.catalogFile), props = await readFile(path.join(f.server, "server.properties"));
    const app = buildApp({ mode: "local", adapters: [f.adapter], clock, managerRoot: f.manager,
      transactionJournal: new TransactionJournalStore(f.manager), operationStore: f.store,
      activeWorldState: new ActiveWorldStateStore(f.manager, [f.adapter]), backupSchedulerTimers: false });
    try {
      await app.ready(); await reached;
      const response = await app.inject({ method: "GET", url: `/api/v1/servers/${f.adapter.serverId}/world-library`, headers: { host: "127.0.0.1:8080" } });
      expect(response.statusCode).toBe(503); expect(response.json().error.code).toBe("MANAGER_RECOVERY_PENDING");
      const confirmation = vi.spyOn(OperationService.prototype, "confirmPhysicalTransaction");
      let settled = false;
      const closing = app.close().then(() => { settled = true; });
      await vi.waitFor(() => expect(app.managerRecovery.state).toBe("closing"));
      expect(settled).toBe(false); expect(confirmation).not.toHaveBeenCalled();
      release(); await closing;
      expect(confirmation).not.toHaveBeenCalled();
      confirmation.mockRestore();
      expect(app.managerRecovery.available).toBe(false);
      expect(await readFile(f.catalogFile)).toEqual(catalog);
      expect(await readFile(path.join(f.server, "server.properties"))).toEqual(props);
      expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    } finally { release(); await app.close(); }
  });
  it("does not regenerate a missing historical active slot during real app startup", async () => {
    const f = await activationFixture(), operation = await f.controller.activate(f.adapter.serverId, f.approval, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("succeeded");
    const file = path.join(f.manager, "active-worlds", `${f.adapter.serverId}.json`);
    await rename(file, path.join(f.root, "preserved-startup-active-slot.json"));
    const states = new ActiveWorldStateStore(f.manager, [f.adapter]);
    const app = buildApp({ mode: "local", adapters: [f.adapter], clock, managerRoot: f.manager, transactionJournal: new TransactionJournalStore(f.manager),
      operationStore: f.store, activeWorldState: states, backupSchedulerTimers: false });
    try {
      const response = await app.inject({ method: "GET", url: `/api/v1/operations/${operation.id}`, headers: { host: "127.0.0.1:8080" } });
      expect(response.statusCode).toBe(200); expect(response.json().data.state).toBe("interrupted");
      await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
      expect(states.snapshot(f.adapter.serverId)).toBeNull();
      expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it("never promotes an anomalous historical slot across two real Manager startups", async () => {
    const f = await activationFixture(), operation = await f.controller.activate(f.adapter.serverId, f.approval, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("succeeded");
    const file = path.join(f.manager, "active-worlds", `${f.adapter.serverId}.json`);
    const anomalous = JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), state: "pending-generation" });
    await writeFile(file, anomalous);
    for (let boot = 0; boot < 2; boot++) {
      const states = new ActiveWorldStateStore(f.manager, [f.adapter]);
      const app = buildApp({ mode: "local", adapters: [f.adapter], clock, managerRoot: f.manager, transactionJournal: new TransactionJournalStore(f.manager),
        operationStore: f.store, activeWorldState: states, backupSchedulerTimers: false });
      try {
        const response = await app.inject({ method: "GET", url: `/api/v1/operations/${operation.id}`, headers: { host: "127.0.0.1:8080" } });
        expect(response.statusCode).toBe(200); expect(response.json().data.state).toBe("interrupted");
        expect(await readFile(file, "utf8")).toBe(anomalous); expect(states.snapshot(f.adapter.serverId)).toBeNull();
      } finally { await app.close(); }
    }
  });
  it("retains a missing active slot when the activation journal is corrupt and its operation is missing", async () => {
    const f = await activationFixture(), operation = await f.controller.activate(f.adapter.serverId, f.approval, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("succeeded");
    const record = (await f.journal.scan()).records.find(item => item.intent.worldActivation)!;
    const journalFile = path.join(f.manager, "transactions", `${f.adapter.serverId}.${record.transactionId}.json`);
    await rename(journalFile, path.join(f.root, "preserved-corrupt-journal-original.json")); await writeFile(journalFile, '{"corrupt":true}');
    const slot = path.join(f.manager, "active-worlds", `${f.adapter.serverId}.json`);
    await rename(slot, path.join(f.root, "preserved-corrupt-active-slot.json"));
    const store = new MemoryOperationStore();
    for (const saved of await f.store.list()) if (saved.operation.id !== operation.id) await store.save(saved);
    const states = new ActiveWorldStateStore(f.manager, [f.adapter]);
    const app = buildApp({ mode: "local", adapters: [f.adapter], clock, managerRoot: f.manager, transactionJournal: new TransactionJournalStore(f.manager),
      operationStore: store, activeWorldState: states, backupSchedulerTimers: false });
    try {
      const library = await app.inject({ method: "GET", url: `/api/v1/servers/${f.adapter.serverId}/world-library`, headers: { host: "127.0.0.1:8080" } });
      expect(library.statusCode).toBe(200);
      expect(library.json().data).toMatchObject({ state: "inspection-required", mutationsAvailable: false });
      await expect(readFile(slot)).rejects.toMatchObject({ code: "ENOENT" }); expect(states.snapshot(f.adapter.serverId)).toBeNull();
      expect(await readFile(journalFile, "utf8")).toBe('{"corrupt":true}');
      expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it("executes first activation with a verified pinned backup, preserving both worlds and never starting Java", async () => {
    const f = await activationFixture(), targetBefore = await readFile(path.join(f.server, "Independent", "level.dat"));
    const key = randomUUID(), operation = await f.controller.activate(f.adapter.serverId, f.approval, key);
    expect((await complete(f.operations, operation.id)).state).toBe("succeeded");
    expect((await f.controller.activate(f.adapter.serverId, f.approval, key)).id).toBe(operation.id);
    expect(f.states.snapshot(f.adapter.serverId)?.levelName).toBe("Independent");
    expect((await f.library.list(f.binding, f.states.snapshot(f.adapter.serverId))).activeWorldId).toBe(f.id);
    expect(await readFile(path.join(f.server, "world", "level.dat"))).toEqual(f.original);
    expect(await readFile(path.join(f.server, "Independent", "level.dat"))).toEqual(targetBefore);
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties.replace("level-name=world", "level-name=Independent"));
    const record = (await f.journal.scan()).records.find(item => item.intent.worldActivation)!;
    expect(record.state).toBe("committed");
    const guard = await f.backups.exportSource(f.adapter.serverId, record.intent.worldActivation!.guardBackupId);
    expect(guard.manifest.pinned).toBe(true);
    expect(await readFile(path.join(guard.directory, "payload", "world", "level.dat"))).toEqual(f.original);
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    const restarted = reconstructed(f); await restarted.journal.initialize(); await restarted.operations.initialize();
    expect(restarted.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    // A committed receipt alone intentionally cannot authorize post-restart use.
  });
  it.each(["activation-intent-persisted", "activation-guard-verified", "activation-config-installed", "activation-state-installed"])("retains evidence and gates interruption at %s", async point => {
    const f = await activationFixture(async name => { if (name === point) throw new Error("controlled activation interruption"); });
    const key = randomUUID(), operation = await f.controller.activate(f.adapter.serverId, f.approval, key);
    expect((await complete(f.operations, operation.id)).state).toBe("interrupted");
    expect((await f.controller.activate(f.adapter.serverId, f.approval, key)).id).toBe(operation.id);
    expect(await readFile(path.join(f.server, "world", "level.dat"))).toEqual(f.original);
    const record = (await f.journal.scan()).records.find(item => item.intent.worldActivation)!;
    expect(record.state).toBe("recovery-required");
    if (point !== "activation-intent-persisted") expect((await f.backups.exportSource(f.adapter.serverId, record.intent.worldActivation!.guardBackupId)).manifest.pinned).toBe(true);
    const restarted = reconstructed(f); await restarted.journal.initialize(); await restarted.operations.initialize();
    expect(restarted.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it("rejects substituted staged configuration before switching the active world", async () => {
    const f = await activationFixture(async point => {
      if (point !== "activation-switch-intent") return;
      const record = (await f.journal.scan()).records.find(item => item.intent.worldActivation)!;
      await writeFile(path.join(f.server, record.intent.worldActivation!.workspaceName, "properties.after"), "level-name=OtherWorld\n");
    });
    const operation = await f.controller.activate(f.adapter.serverId, f.approval, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("interrupted");
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
    expect(f.states.snapshot(f.adapter.serverId)?.levelName).toBe("world");
    expect(await readFile(path.join(f.server, "world", "level.dat"))).toEqual(f.original);
  });
  it.each([
    ["activation-config-staged", "properties.before"], ["activation-config-staged", "properties.approved"],
    ["activation-switch-intent", "properties.before"], ["activation-switch-intent", "properties.approved"]
  ])("requires intact protection copies at %s: %s", async (point, name) => {
    const f = await activationFixture(async current => {
      if (current !== point) return;
      const record = (await f.journal.scan()).records.find(item => item.intent.worldActivation)!;
      await writeFile(path.join(f.server, record.intent.worldActivation!.workspaceName, name!), "corrupt protection copy");
    });
    const operation = await f.controller.activate(f.adapter.serverId, f.approval, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("interrupted");
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
    expect(f.states.snapshot(f.adapter.serverId)?.levelName).toBe("world");
    expect(await readFile(path.join(f.server, "world", "level.dat"))).toEqual(f.original);
  });
  it("does not change configuration when protection backup verification fails", async () => {
    const f = await activationFixture();
    vi.spyOn(f.backups, "exportSource").mockRejectedValueOnce(new Error("controlled guard verification failure"));
    const operation = await f.controller.activate(f.adapter.serverId, f.approval, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("interrupted");
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
    expect(f.states.snapshot(f.adapter.serverId)?.levelName).toBe("world");
    const record = (await f.journal.scan()).records.find(item => item.intent.worldActivation)!;
    expect(record.state).toBe("recovery-required");
    expect(await readFile(path.join(f.manager, "backups", f.adapter.serverId, record.intent.worldActivation!.guardBackupId, "payload", "world", "level.dat"))).toEqual(f.original);
  });
  it("rejects corrupted guard payload before configuration switching", async () => {
    const f = await activationFixture(async point => {
      if (point !== "activation-guard-verified") return;
      const record = (await f.journal.scan()).records.find(item => item.intent.worldActivation)!;
      await writeFile(path.join(f.manager, "backups", f.adapter.serverId, record.intent.worldActivation!.guardBackupId, "payload", "world", "level.dat"), "corrupt guard");
    });
    const operation = await f.controller.activate(f.adapter.serverId, f.approval, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("interrupted");
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
    expect(f.states.snapshot(f.adapter.serverId)?.levelName).toBe("world");
    expect(await readFile(path.join(f.server, "world", "level.dat"))).toEqual(f.original);
  });
  it.each(["world", "Independent"])("rejects final-checkpoint content changes in %s before committing", async target => {
    const f = await activationFixture(async point => {
      if (point === "activation-final-verified") await writeFile(path.join(f.server, target, "late.dat"), "late external change");
    });
    const operation = await f.controller.activate(f.adapter.serverId, f.approval, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("interrupted");
    expect((await f.journal.scan()).records.find(item => item.intent.worldActivation)?.state).toBe("recovery-required");
    expect(f.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it("rejects stale approval and incorrect target confirmation before creating activation evidence", async () => {
    const f = await activationFixture(), before = JSON.stringify(await f.journal.scan());
    await expect(f.controller.activate(f.adapter.serverId, { ...f.approval, confirmWorldName: "OtherWorld" }, randomUUID())).rejects.toMatchObject({ code: "WORLD_REVISION_CONFLICT" });
    await expect(f.controller.activate(f.adapter.serverId, { ...f.approval, propertiesRevision: "0".repeat(64) }, randomUUID())).rejects.toMatchObject({ code: "WORLD_REVISION_CONFLICT" });
    expect(JSON.stringify(await f.journal.scan())).toBe(before);
    await expect(readdir(path.join(f.manager, "backups"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
  });
  it("prepares activation against immutable identity without changing configuration, journals or active world", async () => {
    const f = await installedFixture();
    const before = JSON.stringify(await f.journal.scan()), active = f.states.snapshot(f.adapter.serverId);
    const plan = await f.activation.plan(f.adapter.serverId, f.id);
    expect(plan).toMatchObject({ worldId: f.id, levelName: "Independent", executionAvailable: false, loadVerified: false,
      serverMustBeStopped: true, unavailableReason: "ACTIVATION_TRANSACTION_PENDING" });
    expect(plan.currentWorldId).not.toBe(f.id);
    expect(plan.propertiesRevision).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(await f.journal.scan())).toBe(before);
    expect(f.states.snapshot(f.adapter.serverId)).toEqual(active);
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it("refuses activation preflight for tampered inactive content and missing installation journal", async () => {
    const f = await installedFixture();
    await writeFile(path.join(f.server, "Independent", "extra.dat"), "external modification");
    await expect(f.activation.plan(f.adapter.serverId, f.id)).rejects.toBeDefined();
    await rm(path.join(f.server, "Independent", "extra.dat"));
    const record = (await f.journal.scan()).records[0]!;
    await rename(path.join(f.manager, "transactions", `${f.adapter.serverId}.${record.transactionId}.json`), path.join(f.root, "preserved-activation-intent.json"));
    await expect(f.activation.plan(f.adapter.serverId, f.id)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it("refuses an active target, malformed IDs, running process and unsupported version", async () => {
    const f = await installedFixture();
    const list = await f.library.list(f.binding, f.states.snapshot(f.adapter.serverId));
    await expect(f.activation.plan(f.adapter.serverId, list.activeWorldId!)).rejects.toMatchObject({ code: "ACTION_UNAVAILABLE" });
    await expect(f.activation.plan(f.adapter.serverId, "../world")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    f.status.state = "running";
    await expect(f.activation.plan(f.adapter.serverId, f.id)).rejects.toMatchObject({ code: "SERVER_MUST_BE_STOPPED" });
    f.status.state = "stopped"; f.adapter.plan.serverInfo.minecraftVersion = "unknown";
    await expect(f.activation.plan(f.adapter.serverId, f.id)).rejects.toMatchObject({ code: "WORLD_COMPATIBILITY_UNVERIFIED" });
  });
  it("detects current world changes during asynchronous preflight without writing a new transaction", async () => {
    const f = await installedFixture(); let checks = 0;
    const activation = new WorldActivationPlanService(f.registry, f.operations, f.library, f.states, async (serverId, worldId) => {
      await f.service.verifyInactiveForActivation(serverId, worldId);
      if (++checks === 2) await writeFile(path.join(f.server, "world", "late.dat"), "external change");
    });
    const before = JSON.stringify(await f.journal.scan());
    await expect(activation.plan(f.adapter.serverId, f.id)).rejects.toBeDefined();
    expect(JSON.stringify(await f.journal.scan())).toBe(before);
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
  });
  it("rejects same-content properties replacement during activation preflight", async () => {
    const f = await installedFixture(); let checks = 0;
    const activation = new WorldActivationPlanService(f.registry, f.operations, f.library, f.states, async (serverId, worldId) => {
      await f.service.verifyInactiveForActivation(serverId, worldId);
      if (++checks === 2) {
        await rename(path.join(f.server, "server.properties"), path.join(f.root, "preserved-properties"));
        await writeFile(path.join(f.server, "server.properties"), properties);
      }
    });
    const before = JSON.stringify(await f.journal.scan()), active = f.states.snapshot(f.adapter.serverId);
    await expect(activation.plan(f.adapter.serverId, f.id)).rejects.toMatchObject({ code: "WORLD_REVISION_CONFLICT" });
    expect(JSON.stringify(await f.journal.scan())).toBe(before);
    expect(f.states.snapshot(f.adapter.serverId)).toEqual(active);
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
    expect(await readFile(path.join(f.root, "preserved-properties"), "utf8")).toBe(properties);
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it("revalidates browser folder ZIP through the real upload pipeline before independent installation", async () => {
    const f = await fixture();
    const bytes = level("folder-import");
    const source = new File([new Uint8Array(bytes)], "level.dat");
    Object.defineProperty(source, "webkitRelativePath", { value: "SelectedWorld/level.dat" });
    const archive = await createWorldFolderArchive([source]);
    const staged = await f.uploads.upload(f.adapter.serverId, archive.name, Readable.from([Buffer.from(await archive.arrayBuffer())]));
    const plan = await f.service.plan(f.adapter.serverId, { name: "FolderWorld", uploadId: staged.id });
    const operation = await f.service.importIndependent(f.adapter.serverId, plan, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("succeeded");
    expect(await readFile(path.join(f.server, "FolderWorld", "level.dat"))).toEqual(bytes);
    expect(await readFile(path.join(f.server, "world", "level.dat"))).toEqual(f.original);
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it("installs a distinct lineage without changing current world/configuration and replays no duplicate", async () => {
    const f = await fixture(); const active = f.states.snapshot(f.adapter.serverId);
    const plan = await f.service.plan(f.adapter.serverId, f.request); const key = randomUUID();
    const operation = await f.service.importIndependent(f.adapter.serverId, plan, key);
    expect((await complete(f.operations, operation.id)).state).toBe("succeeded");
    expect((await f.service.importIndependent(f.adapter.serverId, plan, key)).id).toBe(operation.id);
    expect(await readFile(path.join(f.server, "world", "level.dat"))).toEqual(f.original);
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
    expect(f.states.snapshot(f.adapter.serverId)).toEqual(active); expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    const catalog = await f.library.list(f.binding, active);
    expect(catalog.items).toHaveLength(2); expect(catalog.activeWorldId).toBe(plan.currentWorldId);
    const record = (await f.journal.scan()).records[0]!;
    expect(record.state).toBe("committed"); expect(record.intent.worldLibraryImport?.worldId).toBe(f.operations.get(operation.id)?.result?.resourceId);
    expect((await f.uploads.list(f.adapter.serverId)).items[0]?.state).toBe("consumed");
    const restart = reconstructed(f); await restart.journal.initialize(); await restart.service.reconcileStartup(); await restart.operations.initialize();
    expect(restart.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
  });
  it.each(["identity-intent-persisted", "independent-world-staged", "independent-world-installed", "independent-identity-installed"])("preserves evidence and never resumes writes after interruption at %s", async point => {
    const f = await fixture(async name => { if (name === point) throw new Error("controlled test interruption"); });
    const plan = await f.service.plan(f.adapter.serverId, f.request);
    const operation = await f.service.importIndependent(f.adapter.serverId, plan, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("interrupted");
    const before = (await readdir(f.server)).sort();
    const record = (await f.journal.scan()).records[0]!; const chosen = record.intent.worldLibraryImport!.worldId;
    const restart = reconstructed(f); await restart.journal.initialize(); await restart.service.reconcileStartup(); await restart.operations.initialize();
    expect(restart.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    expect((await restart.journal.scan()).records[0]?.intent.worldLibraryImport?.worldId).toBe(chosen);
    expect((await readdir(f.server)).sort()).toEqual(before);
    expect(await readFile(path.join(f.server, "world", "level.dat"))).toEqual(f.original);
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
  });
  it("detects a rolled-back catalog using independent committed journal evidence", async () => {
    const f = await fixture(); const oldCatalog = await readFile(f.catalogFile);
    const plan = await f.service.plan(f.adapter.serverId, f.request);
    const operation = await f.service.importIndependent(f.adapter.serverId, plan, randomUUID()); await complete(f.operations, operation.id);
    await writeFile(f.catalogFile, oldCatalog);
    const restart = reconstructed(f); await restart.journal.initialize(); await restart.service.reconcileStartup(); await restart.operations.initialize();
    expect(restart.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    expect(await readFile(f.catalogFile)).toEqual(oldCatalog);
  });
  it.each(["journal-only", "journal-and-catalog"])("does not accept missing %s as a new instance", async scenario => {
    const f = await fixture(); const plan = await f.service.plan(f.adapter.serverId, f.request);
    const operation = await f.service.importIndependent(f.adapter.serverId, plan, randomUUID()); await complete(f.operations, operation.id);
    const record = (await f.journal.scan()).records[0]!;
    await rename(path.join(f.manager, "transactions", `${f.adapter.serverId}.${record.transactionId}.json`), path.join(f.root, "preserved-intent.json"));
    if (scenario === "journal-and-catalog") await rename(path.join(f.manager, "world-library"), path.join(f.root, "preserved-library"));
    const restart = reconstructed(f); await restart.journal.initialize(); await restart.service.reconcileStartup(); await restart.operations.initialize();
    expect(restart.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    expect(restart.operations.get(operation.id)?.state).toBe("interrupted");
  });
  it.each(["original", "workspace", "staged-world", "installed-world"])("rejects a same-byte %s directory substitution", async target => {
    let server = "";
    const f = await fixture(async point => {
      if (point !== (target === "installed-world" ? "independent-world-installed" : "independent-world-staged")) return;
      const workspaceName = (await readdir(server)).find(name => name.startsWith(".manager-world-library-"))!;
      const selected = target === "original" ? path.join(server, "world") : target === "workspace" ? path.join(server, workspaceName)
        : target === "installed-world" ? path.join(server, "Independent") : path.join(server, workspaceName, "world");
      const preserved = path.join(f.root, "preserved-directory");
      await rename(selected, preserved); await cp(preserved, selected, { recursive: true, errorOnExist: true, force: false });
    });
    server = f.server;
    const plan = await f.service.plan(f.adapter.serverId, f.request);
    const operation = await f.service.importIndependent(f.adapter.serverId, plan, randomUUID());
    expect((await complete(f.operations, operation.id)).state).toBe("interrupted");
    expect(f.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
    if (target === "original") expect(await readFile(path.join(f.root, "preserved-directory", "level.dat"))).toEqual(f.original);
  });
  it("refuses running-server imports and incomplete compatibility evidence without stopping or creating intent", async () => {
    const f = await fixture(); f.status.state = "running"; f.status.ownership = "managed";
    await expect(f.service.plan(f.adapter.serverId, f.request)).rejects.toMatchObject({ code: "SERVER_MUST_BE_STOPPED" });
    expect((await f.journal.scan()).records).toHaveLength(0); expect(f.stop).not.toHaveBeenCalled();
    const unknown = await fixture(undefined, false);
    await expect(unknown.service.plan(unknown.adapter.serverId, unknown.request)).rejects.toMatchObject({ code: "WORLD_COMPATIBILITY_UNVERIFIED" });
    expect((await unknown.journal.scan()).records).toHaveLength(0);
  });
  it("rejects stale plan revisions before creating any installation intent", async () => {
    const f = await fixture(); const plan = await f.service.plan(f.adapter.serverId, f.request);
    await expect(f.service.importIndependent(f.adapter.serverId, { ...plan, libraryRevision: "0".repeat(64) }, randomUUID())).rejects.toMatchObject({ code: "WORLD_REVISION_CONFLICT" });
    expect((await f.journal.scan()).records).toHaveLength(0); expect((await readdir(f.server)).sort()).toEqual(["server.properties", "world"]);
  });
  it("wires the real Fastify plan/import API, persistent operation and unchanged active world", async () => {
    const f = await httpFixture();
    try {
      const observed = await f.app.inject({ method: "GET", url: f.base, headers: f.headers });
      expect(observed.statusCode).toBe(200); expect(observed.json().data.mutationsAvailable).toBe(true);
      const planned = await f.app.inject({ method: "POST", url: f.base + "/import-plan", headers: f.headers, payload: f.request });
      expect(planned.statusCode).toBe(200); expect(planned.json().data.changesActiveWorld).toBe(false);
      const { executionAvailable: _available, serverMustBeStopped: _stopped, changesActiveWorld: _changes, ...request } = planned.json().data;
      void _available; void _stopped; void _changes;
      const headers = { ...f.headers, "idempotency-key": randomUUID() };
      const result = await f.app.inject({ method: "POST", url: f.base + "/import", headers, payload: request });
      expect(result.statusCode).toBe(202);
      const id = result.json().data.operation.id;
      await vi.waitFor(async () => expect((await f.store.list()).find(item => item.operation.id === id)?.operation.state).toBe("succeeded"), { timeout: 3000 });
      const repeated = await f.app.inject({ method: "POST", url: f.base + "/import", headers, payload: request });
      expect(repeated.statusCode).toBe(202); expect(repeated.json().data.operation.id).toBe(id);
      const conflict = await f.app.inject({ method: "POST", url: f.base + "/import", headers, payload: { ...request, name: "Another" } });
      expect(conflict.statusCode).toBe(409); expect(await f.store.list()).toHaveLength(1);
      expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(properties);
      expect(await readFile(path.join(f.server, "world", "level.dat"))).toEqual(f.original);
    } finally { await f.app.close(); }
  });
  it("rejects unauthenticated/CSRF/Origin/DTO/key errors without installing or admitting work", async () => {
    const f = await httpFixture();
    try {
      const planned = await f.app.inject({ method: "POST", url: f.base + "/import-plan", headers: f.headers, payload: f.request });
      const data = planned.json().data;
      const request = { name: data.name, uploadId: data.uploadId, mode: data.mode, uploadRevision: data.uploadRevision,
        libraryRevision: data.libraryRevision, currentWorldId: data.currentWorldId, currentWorldRevision: data.currentWorldRevision };
      const headers = { ...f.headers, "idempotency-key": randomUUID() };
      const cases = [
        { headers: { ...headers, cookie: "" }, payload: request, status: 401 },
        { headers: { ...headers, "x-csrf-token": "invalid" }, payload: request, status: 403 },
        { headers: { ...headers, origin: "https://untrusted.invalid" }, payload: request, status: 403 },
        { headers, payload: { ...request, directory: "C:\\arbitrary" }, status: 400 },
        { headers, payload: { ...request, mode: "replace" }, status: 400 },
        { headers: { ...headers, "idempotency-key": "" }, payload: request, status: 428 }
      ];
      for (const item of cases) expect((await f.app.inject({ method: "POST", url: f.base + "/import", headers: item.headers, payload: item.payload })).statusCode).toBe(item.status);
      expect(await f.store.list()).toHaveLength(0); expect((await f.journal.scan()).records).toHaveLength(0);
      expect((await readdir(f.server)).sort()).toEqual(["server.properties", "world"]);
    } finally { await f.app.close(); }
  });
  it("rechecks administrator session after asynchronous source preflight before operation persistence", async () => {
    const f = await httpFixture(); let restore = () => {};
    try {
      const planned = await f.app.inject({ method: "POST", url: f.base + "/import-plan", headers: f.headers, payload: f.request });
      const data = planned.json().data;
      const request = { name: data.name, uploadId: data.uploadId, mode: data.mode, uploadRevision: data.uploadRevision,
        libraryRevision: data.libraryRevision, currentWorldId: data.currentWorldId, currentWorldRevision: data.currentWorldRevision };
      const original = WorldImportUploadService.prototype.validatedSource;
      const spy = vi.spyOn(WorldImportUploadService.prototype, "validatedSource").mockImplementationOnce(async function (this: WorldImportUploadService, ...args) {
        const value = await original.apply(this, args); f.sessions.clear(); return value;
      }); restore = () => spy.mockRestore();
      const response = await f.app.inject({ method: "POST", url: f.base + "/import", headers: { ...f.headers, "idempotency-key": randomUUID() }, payload: request });
      expect(response.statusCode).toBe(401); expect(await f.store.list()).toHaveLength(0);
      expect((await f.journal.scan()).records).toHaveLength(0); expect((await readdir(f.server)).sort()).toEqual(["server.properties", "world"]);
    } finally { restore(); await f.app.close(); }
  });
});
