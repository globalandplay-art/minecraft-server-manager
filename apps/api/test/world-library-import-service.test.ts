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
async function fixture(inject?: (point: string) => Promise<void>, withDataVersion = true) {
  const root = await mkdtemp(path.join(tmpdir(), "lt-independent-world-")); roots.push(root);
  const manager = path.join(root, "manager"), server = path.join(root, "server");
  await mkdir(manager); await mkdir(path.join(server, "world"), { recursive: true });
  const original = level("original"); await writeFile(path.join(server, "world", "level.dat"), original);
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
  const upload = await uploads.upload(adapter.serverId, "independent.zip", Readable.from([zip(level("imported", withDataVersion))]));
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
async function httpFixture() {
  const f = await fixture(); const sessions = new SessionCore(() => 0);
  const authentication = new HttpAuthentication(new PasswordVerifier({ version: 1, username: "admin", revision: randomUUID(),
    salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }),
  { ready: () => true, record: async () => {}, close: async () => {} }, sessions);
  const app = buildApp({ mode: "local", adapters: [f.adapter], clock, managerRoot: f.manager, transactionJournal: f.journal,
    operationStore: f.store, activeWorldState: f.states, authentication, backupSchedulerTimers: false });
  const token = sessions.create("local-http");
  const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui",
    cookie: `mcsm_local_session=${token.sessionToken}`, "x-csrf-token": token.csrfToken };
  const base = `/api/v1/servers/${f.adapter.serverId}/world-library`;
  return { ...f, app, sessions, headers, base };
}
describe("independent world import executor (isolated files, Fake Minecraft adapter)", () => {
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
  function activationRestart(f: Awaited<ReturnType<typeof activationFixture>>, afterProof?: () => void) {
    const journal = new TransactionJournalStore(f.manager), operations = new OperationService(f.store, clock, journal);
    const library = new WorldLibraryStore(f.manager, clock), states = new ActiveWorldStateStore(f.manager, [f.adapter]);
    const uploads = new WorldImportUploadService(f.registry, operations, f.manager, undefined, journal, clock);
    const backups = new BackupService(f.registry, operations, journal, f.manager, clock);
    const reconciler = new WorldActivationReconciler(f.registry, operations, journal, library, uploads, backups, f.manager);
    const imports = new WorldLibraryImportService(f.registry, operations, journal, library, uploads, states, clock, undefined,
      async record => { const proof = await reconciler.verifiesSupersession(record); if (proof) afterProof?.(); return proof; });
    return { journal, operations, library, states, uploads, reconciler, imports };
  }
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
