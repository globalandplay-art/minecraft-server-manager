import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { ActiveWorldStateStore } from "../src/services/active-world-state-store.js";
import { BackupService } from "../src/services/backup-service.js";
import { OperationService, type ReplacementOutcomeProof } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";
import { TransactionJournalStore } from "../src/services/transaction-journal.js";
import { WorldImportUploadService } from "../src/services/world-import-upload-service.js";
import { WorldLibraryImportService } from "../src/services/world-library-import-service.js";
import { WorldLibraryStore } from "../src/services/world-library-store.js";
import { WorldReplacementService, type WorldReplacementApproval } from "../src/services/world-replacement-service.js";
import { replacementExecutionCheckpoints } from "../src/services/world-transition-records.js";
import { testWorldLevel, testWorldZip } from "./fixtures/world-library-content.js";
import { verifyReplacementCurrentState } from "../src/services/world-replacement-live.js";
import { DomainError } from "../src/services/domain-errors.js";
import { WorldReplacementRecovery } from "../src/services/world-replacement-recovery.js";
import { buildApp } from "../src/app.js";
import { HttpAuthentication } from "../src/auth/http-auth.js";
import { SessionCore } from "../src/auth/session-core.js";
import { PasswordVerifier, SCRYPT_PROFILE } from "../src/auth/password.js";

const roots: string[] = [], clock = { now: () => new Date("2026-10-27T04:00:00.000Z") };
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(inject?: (point: string) => Promise<void>, withInactive = false) {
  const parent = await mkdtemp(path.join(tmpdir(), "lt-replacement-executor-")); roots.push(parent);
  const root = path.join(parent, "server"), manager = path.join(parent, "manager"), serverId = "replace-test";
  await mkdir(manager); await mkdir(path.join(root, "world"), { recursive: true });
  const original = testWorldLevel("original", true, 5023), imported = testWorldLevel("imported", true, 5023);
  await writeFile(path.join(root, "world", "level.dat"), original);
  const properties = "# retained\nlevel-name=world\nmax-players=20\n"; await writeFile(path.join(root, "server.properties"), properties);
  const status = { state: "stopped", ownership: "none", recoveryRequired: false }, start = vi.fn(), stop = vi.fn();
  const adapter = { mode: "local", serverId, plan: { rootPath: root, serverInfo: { type: "vanilla", minecraftVersion: "26.3" } },
    getStatus: async () => ({ ...status }), getServerInfo: async () => ({ type: "vanilla", minecraftVersion: "26.3" }),
    getCapabilities: async () => ({ worlds: true, backup: true }), subscribe: () => () => {}, closeObserver: vi.fn(async () => {}), start, stop } as unknown as LocalMinecraftServerAdapter;
  const registry = new AdapterRegistry([adapter]), journal = new TransactionJournalStore(manager), store = new MemoryOperationStore();
  const operations = new OperationService(store, clock, journal); await operations.initialize();
  const states = new ActiveWorldStateStore(manager, [adapter]); await states.initialize();
  const library = new WorldLibraryStore(manager, clock), binding = { serverId, rootPath: root }; await library.migrateLegacy(binding, states.snapshot(serverId)!);
  const uploads = new WorldImportUploadService(registry, operations, manager, undefined, journal, clock);
  const upload = await uploads.upload(serverId, "replacement.zip", Readable.from([testWorldZip(imported)]));
  const imports = new WorldLibraryImportService(registry, operations, journal, library, uploads, states, clock);
  let inactiveId: string | undefined, inactiveUploadId: string | undefined, inactiveKey: string | undefined;
  let inactiveRequest: Awaited<ReturnType<WorldLibraryImportService["plan"]>> | undefined;
  if (withInactive) {
    const inactive = await uploads.upload(serverId, "inactive.zip", Readable.from([testWorldZip(testWorldLevel("inactive", true, 5023))]));
    inactiveUploadId = inactive.id;
    const plan = await imports.plan(serverId, { name: "Inactive", uploadId: inactive.id });
    inactiveRequest = plan; inactiveKey = randomUUID();
    const operation = await imports.importIndependent(serverId, plan, inactiveKey);
    await vi.waitFor(() => { expect(operations.get(operation.id)?.state).toBe("succeeded"); expect(operations.getServerState(serverId).activeOperationId).toBeNull(); }, { timeout: 5000 });
    inactiveId = operations.get(operation.id)!.result!.resourceId!;
  }
  const backups = new BackupService(registry, operations, journal, manager, clock);
  const service = new WorldReplacementService(operations, journal, library, imports, uploads, backups, manager, clock, inject);
  const plan = await imports.planReplacement(serverId, { uploadId: upload.id });
  const body: WorldReplacementApproval = { uploadId: upload.id, uploadRevision: plan.uploadRevision, libraryRevision: plan.libraryRevision,
    currentWorldId: plan.currentWorldId, currentWorldRevision: plan.currentWorldRevision, currentContentRevision: plan.currentContentRevision,
    propertiesRevision: plan.propertiesRevision, confirmWorldName: plan.currentWorldName };
  const catalogFile = path.join(manager, "world-library", serverId, "state.json"), activeFile = path.join(manager, "active-worlds", `${serverId}.json`);
  return { root, manager, serverId, original, imported, properties, status, start, stop, registry, adapter, journal, store,
    operations, states, library, binding, uploads, imports, backups, service, body, catalogFile, activeFile, inactiveId, inactiveUploadId, inactiveKey, inactiveRequest };
}
async function complete(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  await vi.waitFor(() => {
    expect(f.operations.get(id)?.state).toMatch(/^(succeeded|failed|interrupted)$/u);
    expect(f.operations.getServerState(f.serverId).activeOperationId).toBeNull();
  }, { timeout: 5000 });
  return f.operations.get(id)!;
}

async function httpFixture(enabled = true, existing?: Awaited<ReturnType<typeof fixture>>) {
  const f = existing ?? await fixture(); let sessionTime = 0; const sessions = new SessionCore(() => sessionTime);
  const authentication = new HttpAuthentication(new PasswordVerifier({ version: 1, username: "admin", revision: randomUUID(),
    salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }),
  { ready: () => true, record: async () => {}, close: async () => {} }, sessions);
  const app = buildApp({ mode: "local", adapters: [f.adapter], clock, managerRoot: f.manager, transactionJournal: f.journal,
    operationStore: f.store, activeWorldState: f.states, authentication, backupSchedulerTimers: false, worldReplacementExecution: enabled });
  const token = sessions.create("local-http");
  const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui",
    cookie: `mcsm_local_session=${token.sessionToken}`, "x-csrf-token": token.csrfToken };
  await app.ready();
  return { ...f, app, sessions, authentication, headers, base: `/api/v1/servers/${f.serverId}/world-library`,
    expire: () => { sessionTime += 8 * 60 * 60_000 + 1; } };
}

describe("trusted first-replacement HTTP integration", () => {
  it("defaults to a disabled preview and refuses execution and verification", async () => {
    const f = await httpFixture(false);
    try {
      const plan = await f.app.inject({ method: "POST", url: `${f.base}/replacement-plan`, headers: f.headers, payload: { uploadId: f.body.uploadId } });
      expect(plan.statusCode).toBe(200); expect(plan.json().data.executionAvailable).toBe(false);
      for (const [endpoint, payload] of [["replace", f.body], ["replacement-verification", { operationId: randomUUID(), intent: "confirm-current-state" }]] as const) {
        const response = await f.app.inject({ method: "POST", url: `${f.base}/${endpoint}`, headers: f.headers, payload });
        expect(response.statusCode).toBe(404);
      }
      expect(await f.store.list()).toEqual([]); expect((await f.journal.scan()).records).toEqual([]);
    } finally { await f.app.close(); }
  });
  it("executes through the shared runtime and requires explicit physical confirmation", async () => {
    const f = await httpFixture(), key = randomUUID();
    try {
      const plan = await f.app.inject({ method: "POST", url: `${f.base}/replacement-plan`, headers: f.headers, payload: { uploadId: f.body.uploadId } });
      expect(plan.statusCode).toBe(200); expect(plan.json().data).toMatchObject({ executionAvailable: true, unavailableReason: null });
      const submit = () => f.app.inject({ method: "POST", url: `${f.base}/replace`, headers: { ...f.headers, "idempotency-key": key }, payload: f.body });
      const accepted = await submit(); expect(accepted.statusCode).toBe(202); const id = accepted.json().data.operation.id;
      await vi.waitFor(async () => {
        const response = await f.app.inject({ url: `/api/v1/operations/${id}`, headers: f.headers });
        expect(response.json().data.state).toBe("succeeded");
      }, { timeout: 5000 });
      const blocked = await f.app.inject({ method: "POST", url: `/api/v1/servers/${f.serverId}/actions/start`,
        headers: { ...f.headers, "idempotency-key": randomUUID() }, payload: {} });
      expect(blocked.statusCode).toBe(409); expect(blocked.json().error.code).toBe("RECOVERY_REQUIRED");
      const conflict = await f.app.inject({ method: "POST", url: `${f.base}/replace`, headers: { ...f.headers, "idempotency-key": key }, payload: { ...f.body, confirmWorldName: "Other" } });
      expect(conflict.statusCode).toBe(409); expect(conflict.json().error.code).toBe("OPERATION_CONFLICT");
      const wrongServer = await f.app.inject({ method: "POST", url: "/api/v1/servers/other-instance/world-library/replacement-verification", headers: f.headers,
        payload: { operationId: id, intent: "confirm-current-state" } });
      expect(wrongServer.statusCode).toBe(409);
      const record = (await f.journal.scan()).records[0]!, before = structuredClone(record);
      const confirmed = await f.app.inject({ method: "POST", url: `${f.base}/replacement-verification`, headers: f.headers,
        payload: { operationId: id, intent: "confirm-current-state" } });
      expect(confirmed.statusCode).toBe(200); expect(confirmed.json().data).toMatchObject({ id, state: "succeeded", result: { resourceId: record.intent.worldReplacement!.worldId } });
      expect((await submit()).json().data.operation.id).toBe(id); expect((await f.journal.scan()).records).toEqual([before]);
      expect(await readFile(path.join(f.root, "world", "level.dat"))).toEqual(f.imported);
      expect(await readFile(path.join(f.root, record.intent.worldReplacement!.workspaceName, "previous-world", "level.dat"))).toEqual(f.original);
      expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    } finally { await f.app.close(); }
  });
  it("rejects malformed or untrusted replacement requests before writing any receipt", async () => {
    const f = await httpFixture();
    try {
      for (const body of [{ ...f.body, targetPath: "outside" }, { ...f.body, allowStop: true }, { ...f.body, currentContentRevision: 12 },
        { ...f.body, confirmWorldName: "" }, { ...f.body, uploadId: "../world" }]) {
        const response = await f.app.inject({ method: "POST", url: `${f.base}/replace`, headers: { ...f.headers, "idempotency-key": randomUUID() }, payload: body });
        expect(response.statusCode).toBe(400);
      }
      const missingKey = await f.app.inject({ method: "POST", url: `${f.base}/replace`, headers: f.headers, payload: f.body });
      expect(missingKey.statusCode).toBe(428);
      const wrongConfirmation = await f.app.inject({ method: "POST", url: `${f.base}/replace`, headers: { ...f.headers, "idempotency-key": randomUUID() }, payload: { ...f.body, confirmWorldName: "Other" } });
      expect(wrongConfirmation.statusCode).toBe(409);
      const stale = await f.app.inject({ method: "POST", url: `${f.base}/replace`, headers: { ...f.headers, "idempotency-key": randomUUID() }, payload: { ...f.body, propertiesRevision: "0".repeat(64) } });
      expect(stale.statusCode).toBe(409); expect(stale.json().error.code).toBe("WORLD_REVISION_CONFLICT");
      const forged = await f.app.inject({ method: "POST", url: `${f.base}/replacement-verification`, headers: f.headers,
        payload: { operationId: randomUUID(), intent: "confirm-current-state", proof: {} } });
      expect(forged.statusCode).toBe(400); expect(await f.store.list()).toEqual([]);
    } finally { await f.app.close(); }
  });
  it("keeps session, CSRF and origin guards on all replacement endpoints", async () => {
    const f = await httpFixture();
    try {
      for (const [endpoint, payload] of [["replacement-plan", { uploadId: f.body.uploadId }], ["replace", f.body],
        ["replacement-verification", { operationId: randomUUID(), intent: "confirm-current-state" }]] as const) {
        const noSession = await f.app.inject({ method: "POST", url: `${f.base}/${endpoint}`, headers: { ...f.headers, cookie: "" }, payload });
        expect(noSession.statusCode).toBe(401);
        const csrf = await f.app.inject({ method: "POST", url: `${f.base}/${endpoint}`, headers: { ...f.headers, "x-csrf-token": "wrong" }, payload });
        expect(csrf.statusCode).toBe(403);
        const origin = await f.app.inject({ method: "POST", url: `${f.base}/${endpoint}`, headers: { ...f.headers, origin: "https://untrusted.invalid" }, payload });
        expect(origin.statusCode).toBe(403);
      }
      expect(await f.store.list()).toEqual([]); expect((await f.journal.scan()).records).toEqual([]);
    } finally { await f.app.close(); }
  });
  it.each(["revoked", "expired"])("rechecks %s authorization after replacement preflight and before receipt persistence", async scenario => {
    const f = await httpFixture(); const prepare = WorldLibraryImportService.prototype.prepareReplacementUnderLease;
    const spy = vi.spyOn(WorldLibraryImportService.prototype, "prepareReplacementUnderLease").mockImplementation(async function(this: WorldLibraryImportService, ...args) {
      const result = await prepare.apply(this, args); if (scenario === "revoked") f.sessions.clear(); else f.expire(); return result;
    });
    try {
      const result = await f.app.inject({ method: "POST", url: `${f.base}/replace`, headers: { ...f.headers, "idempotency-key": randomUUID() }, payload: f.body });
      expect(result.statusCode).toBe(401); expect(await f.store.list()).toEqual([]); expect((await f.journal.scan()).records).toEqual([]);
      expect(await readFile(path.join(f.root, "world", "level.dat"))).toEqual(f.original);
    } finally { spy.mockRestore(); await f.app.close(); }
  });
  it.each(["revoked", "expired"])("does not confirm a replacement after %s authorization during physical verification", async scenario => {
    const f = await httpFixture(); let spy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const accepted = await f.app.inject({ method: "POST", url: `${f.base}/replace`, headers: { ...f.headers, "idempotency-key": randomUUID() }, payload: f.body });
      expect(accepted.statusCode).toBe(202); const id = accepted.json().data.operation.id;
      await vi.waitFor(async () => {
        const response = await f.app.inject({ url: `/api/v1/operations/${id}`, headers: f.headers }); expect(response.json().data.state).toBe("succeeded");
      }, { timeout: 5000 });
      const before = await f.store.list(), records = (await f.journal.scan()).records, source = WorldImportUploadService.prototype.validatedSource;
      let first = true;
      spy = vi.spyOn(WorldImportUploadService.prototype, "validatedSource").mockImplementation(async function(this: WorldImportUploadService, ...args) {
        const result = await source.apply(this, args);
        if (first) { first = false; if (scenario === "revoked") f.sessions.clear(); else f.expire(); } return result;
      });
      const response = await f.app.inject({ method: "POST", url: `${f.base}/replacement-verification`, headers: f.headers,
        payload: { operationId: id, intent: "confirm-current-state" } });
      expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe("RECOVERY_REQUIRED");
      expect(first).toBe(false); expect(await f.store.list()).toEqual(before); expect((await f.journal.scan()).records).toEqual(records);
    } finally { spy?.mockRestore(); await f.app.close(); }
  });
});

describe("replacement and ordinary-import recovery group", () => {
  it("settles both receipts through authenticated Fastify verification after Manager reconstruction", async () => {
    const original = await fixture(undefined, true);
    const replacement = await original.service.replace(original.serverId, original.body, randomUUID());
    await complete(original, replacement.id);
    const records = (await original.journal.scan()).records;
    const catalog = await readFile(original.catalogFile), active = await readFile(original.activeFile);
    const birth = records.find(record => record.intent.worldLibraryImport)!;
    const f = await httpFixture(true, original);
    try {
      await f.app.managerRecovery.wait();
      for (const id of [replacement.id, birth.intent.operationId]) {
        const before = await f.app.inject({ url: `/api/v1/operations/${id}`, headers: f.headers });
        expect(before.statusCode).toBe(200); expect(before.json().data.state).toBe("interrupted");
      }
      const response = await f.app.inject({ method: "POST", url: `${f.base}/replacement-verification`, headers: f.headers,
        payload: { operationId: replacement.id, intent: "confirm-current-state" } });
      expect(response.statusCode).toBe(200);
      for (const id of [replacement.id, birth.intent.operationId]) {
        const after = await f.app.inject({ url: `/api/v1/operations/${id}`, headers: f.headers });
        expect(after.statusCode).toBe(200); expect(after.json().data.state).toBe("succeeded");
      }
      expect((await f.journal.scan()).records).toEqual(records);
      expect(await readFile(f.catalogFile)).toEqual(catalog); expect(await readFile(f.activeFile)).toEqual(active);
      expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    } finally { await f.app.close(); }
    expect(f.adapter.closeObserver).toHaveBeenCalledOnce();
  });
  async function groupFixture() {
    const f = await fixture(undefined, true), operation = await f.service.replace(f.serverId, f.body, randomUUID()); await complete(f, operation.id);
    const restarted = new OperationService(f.store, clock, f.journal); await restarted.initialize();
    const birth = (await f.journal.scan()).records.find(record => record.intent.worldLibraryImport)!;
    const proof = (consume: (value: ReplacementOutcomeProof) => Promise<void>) => f.uploads.withLease(async () =>
      consume(await verifyReplacementCurrentState(f.adapter, f.manager, f.journal, f.library, f.backups, f.uploads)));
    return { ...f, operation, restarted, birth, proof };
  }
  it("explicitly confirms the complete import group after restart without replaying any file transaction", async () => {
    const f = await groupFixture(), records = (await f.journal.scan()).records, receipt = await f.store.list();
    await expect(f.restarted.verifyReplacementOutcome(f.serverId, f.operation.id, f.proof, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    const recovered = await f.restarted.verifyReplacementOutcome(f.serverId, f.operation.id, f.proof, () => undefined, true);
    expect(recovered.state).toBe("succeeded"); expect(f.restarted.get(f.birth.intent.operationId)?.state).toBe("succeeded");
    expect(f.restarted.getServerState(f.serverId).recoveryRequired).toBe(false); expect((await f.journal.scan()).records).toEqual(records);
    for (const old of receipt) {
      const saved = (await f.store.list()).find(record => record.operation.id === old.operation.id)!;
      expect({ ...saved, operation: old.operation }).toEqual(old);
    }
    expect(await readFile(path.join(f.root, "Inactive", "level.dat"))).toEqual(testWorldLevel("inactive", true, 5023));
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it.each(["missing", "duplicate", "foreign", "world", "digest"])("does not admit a non-closed import proof set: %s", async problem => {
    const f = await groupFixture(), before = await f.store.list();
    await expect(f.restarted.verifyReplacementOutcome(f.serverId, f.operation.id, consume => f.uploads.withLease(async () => {
      const proof = await verifyReplacementCurrentState(f.adapter, f.manager, f.journal, f.library, f.backups, f.uploads);
      const imports = structuredClone(proof.verifiedImports); expect(imports).toHaveLength(1);
      if (problem === "missing") imports.length = 0;
      else if (problem === "duplicate") imports.push({ ...imports[0]! });
      else if (problem === "foreign") imports[0]!.operationId = randomUUID();
      else if (problem === "world") imports[0]!.worldId = `worldv2-${randomUUID()}`;
      else imports[0]!.recordDigest = "0".repeat(64);
      await consume({ ...proof, verifiedImports: imports });
    }), () => undefined, true)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await f.store.list()).toEqual(before); expect(f.restarted.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it.each(["missing", "failed", "wrong-resource"])("prechecks every receipt before any group write: %s", async problem => {
    const f = await groupFixture(), store = new MemoryOperationStore();
    for (const record of await f.store.list()) {
      if (record.operation.id === f.birth.intent.operationId) {
        if (problem === "missing") continue;
        const operation = problem === "failed" ? { ...record.operation, state: "failed" as const } :
          { ...record.operation, result: { resourceId: `worldv2-${randomUUID()}`, rollbackAvailable: false } };
        await store.save({ ...record, operation }); continue;
      }
      await store.save(record);
    }
    const restarted = new OperationService(store, clock, f.journal); await restarted.initialize();
    const before = await store.list();
    await expect(restarted.verifyReplacementOutcome(f.serverId, f.operation.id, f.proof, () => undefined, true)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await store.list()).toEqual(before); expect(restarted.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("keeps partial group persistence unknown and can explicitly retry without replay", async () => {
    const f = await groupFixture(), records = (await f.journal.scan()).records, save = f.store.save.bind(f.store);
    const events: string[] = []; f.restarted.subscribe(operation => events.push(operation.state)); let failed = false;
    const spy = vi.spyOn(f.store, "save").mockImplementation(async record => {
      if (record.operation.id === f.birth.intent.operationId && record.operation.step === "replacement-import-verified-recovery" && !failed) { failed = true; throw new Error("injected-group-save"); }
      await save(record);
    });
    await expect(f.restarted.verifyReplacementOutcome(f.serverId, f.operation.id, f.proof, () => undefined, true)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(failed).toBe(true); expect(f.restarted.get(f.operation.id)?.state).toBe("interrupted");
    expect(f.restarted.get(f.birth.intent.operationId)?.state).toBe("interrupted"); expect(events).not.toContain("succeeded");
    spy.mockRestore();
    expect((await f.restarted.verifyReplacementOutcome(f.serverId, f.operation.id, f.proof, () => undefined, true)).state).toBe("succeeded");
    expect(f.restarted.getServerState(f.serverId).recoveryRequired).toBe(false); expect((await f.journal.scan()).records).toEqual(records);
  });
  it("masks import GET, same-key replay and subscriptions until final proof returns", async () => {
    const f = await groupFixture(); let calls = 0, observed = false;
    const events: string[] = [], execute = vi.fn(); f.restarted.subscribe(operation => events.push(operation.state));
    await f.restarted.verifyReplacementOutcome(f.serverId, f.operation.id, async consume => {
      await f.uploads.withLease(async () => {
        const proof = await verifyReplacementCurrentState(f.adapter, f.manager, f.journal, f.library, f.backups, f.uploads);
        await consume({ ...proof, recheck: async () => {
          if (++calls === 2) {
            observed = true; expect(f.restarted.get(f.birth.intent.operationId)?.state).toBe("interrupted");
            const replay = await f.restarted.requestBackup(f.serverId, f.inactiveKey!, JSON.stringify(f.inactiveRequest), execute, undefined, "world-library-import");
            expect(replay.id).toBe(f.birth.intent.operationId); expect(replay.state).toBe("interrupted"); expect(events).not.toContain("succeeded");
          }
          await proof.recheck();
        } });
        expect(events).not.toContain("succeeded");
      });
    }, () => undefined, true);
    expect(observed).toBe(true); expect(execute).not.toHaveBeenCalled(); expect(f.restarted.get(f.birth.intent.operationId)?.state).toBe("succeeded");
  });
  it("does not replace a newer replay mapping when expired import keys were reused", async () => {
    const f = await fixture(undefined, true), future = new Date(clock.now().getTime() + 2 * 24 * 60 * 60_000);
    const time = vi.spyOn(clock, "now").mockReturnValue(future);
    try {
      const upload = await f.uploads.upload(f.serverId, "second.zip", Readable.from([testWorldZip(testWorldLevel("second", true, 5023))]));
      const request = await f.imports.plan(f.serverId, { name: "Second", uploadId: upload.id });
      const second = await f.imports.importIndependent(f.serverId, request, f.inactiveKey!); expect((await complete(f, second.id)).state).toBe("succeeded");
      const plan = await f.imports.planReplacement(f.serverId, { uploadId: f.body.uploadId });
      const body = { ...f.body, libraryRevision: plan.libraryRevision, currentWorldRevision: plan.currentWorldRevision,
        currentContentRevision: plan.currentContentRevision, propertiesRevision: plan.propertiesRevision };
      const replacement = await f.service.replace(f.serverId, body, randomUUID()); await complete(f, replacement.id);
      const restarted = new OperationService(f.store, clock, f.journal); await restarted.initialize();
      await restarted.verifyReplacementOutcome(f.serverId, replacement.id, consume => f.uploads.withLease(async () =>
        consume(await verifyReplacementCurrentState(f.adapter, f.manager, f.journal, f.library, f.backups, f.uploads))), () => undefined, true);
      const execute = vi.fn(), replay = await restarted.requestBackup(f.serverId, f.inactiveKey!, JSON.stringify(request), execute, undefined, "world-library-import");
      expect(replay.id).toBe(second.id); expect(replay.state).toBe("succeeded"); expect(execute).not.toHaveBeenCalled();
      expect((await f.journal.scan()).records).toHaveLength(3);
    } finally { time.mockRestore(); }
  });
  it.each(["physical", "authorization", "unrelated", "owner-return"])("retains the entire group after final %s failure", async problem => {
    const f = await groupFixture(); let permitted = true, calls = 0; const events: string[] = [];
    f.restarted.subscribe(operation => events.push(operation.state));
    await expect(f.restarted.verifyReplacementOutcome(f.serverId, f.operation.id, async consume => {
      await f.uploads.withLease(async () => {
        const proof = await verifyReplacementCurrentState(f.adapter, f.manager, f.journal, f.library, f.backups, f.uploads);
        await consume({ ...proof, recheck: async () => {
          if (++calls === 2) {
            if (problem === "physical") await writeFile(path.join(f.root, "world", "late-change"), "changed");
            if (problem === "authorization") permitted = false;
            if (problem === "unrelated") f.restarted.requireRecovery([f.serverId]);
            expect(f.restarted.get(f.operation.id)?.state).toBe("interrupted"); expect(f.restarted.get(f.birth.intent.operationId)?.state).toBe("interrupted");
          }
          await proof.recheck();
        } });
      });
      if (problem === "owner-return") throw new Error("owner-failed-after-consume");
    }, () => { if (!permitted) throw new Error("revoked"); return undefined; }, true)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(f.restarted.get(f.operation.id)?.state).toBe("interrupted"); expect(f.restarted.get(f.birth.intent.operationId)?.state).toBe("interrupted");
    expect(f.restarted.getServerState(f.serverId).recoveryRequired).toBe(true); expect(events).not.toContain("succeeded");
  });
});

describe("unmounted first-world replacement executor", () => {
  it("owns a paused execution plan until close can safely drain it", async () => {
    const f = await fixture(); let release!: () => void, enter!: () => void, first = true;
    const held = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
    const status = f.adapter.getStatus.bind(f.adapter);
    vi.spyOn(f.adapter, "getStatus").mockImplementation(async () => { if (first) { first = false; enter(); await held; } return status(); });
    const planning = f.service.plan(f.serverId, { uploadId: f.body.uploadId });
    const failed = expect(planning).rejects.toMatchObject({ code: "ACTION_UNAVAILABLE" });
    let closing: Promise<void> | undefined, closed = false;
    try {
      await entered; closing = f.service.close().then(() => { closed = true; }); await Promise.resolve(); expect(closed).toBe(false);
    } finally { release(); }
    await failed; await closing; expect(await f.store.list()).toEqual([]); expect((await f.journal.scan()).records).toEqual([]);
    expect(await readFile(path.join(f.root, "world", "level.dat"))).toEqual(f.original);
  });
  it("uses app-owned recovery leases to confirm a complete current state without replay", async () => {
    const f = await fixture(), operation = await f.service.replace(f.serverId, f.body, randomUUID()); await complete(f, operation.id);
    const recovery = new WorldReplacementRecovery(f.registry, f.operations, f.journal, f.library, f.uploads, f.backups, f.manager, () => undefined);
    const records = (await f.journal.scan()).records;
    expect((await recovery.verify(f.serverId, operation.id, () => undefined)).state).toBe("succeeded");
    expect(f.operations.getServerState(f.serverId).recoveryRequired).toBe(false);
    expect((await f.journal.scan()).records).toEqual(records);
    await recovery.close();
    await expect(recovery.verify(f.serverId, operation.id, () => undefined)).rejects.toMatchObject({ code: "ACTION_UNAVAILABLE" });
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it("startup observation retains the interrupted receipt until explicit app-owned verification", async () => {
    const f = await fixture(), operation = await f.service.replace(f.serverId, f.body, randomUUID()); await complete(f, operation.id);
    const restarted = new OperationService(f.store, clock, f.journal); await restarted.initialize();
    const recovery = new WorldReplacementRecovery(f.registry, restarted, f.journal, f.library, f.uploads, f.backups, f.manager, () => undefined);
    const before = await f.store.list();
    expect(await recovery.reconcileStartup()).toEqual(new Set([f.serverId]));
    expect(await f.store.list()).toEqual(before);
    await expect(recovery.verify(f.serverId, operation.id, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect((await recovery.verify(f.serverId, operation.id, () => undefined, true)).state).toBe("succeeded");
    expect(restarted.getServerState(f.serverId).recoveryRequired).toBe(false); await recovery.close();
  });
  it.each(["closing", "authorization"])("revokes and drains an in-flight app recovery on %s", async problem => {
    const f = await fixture(), operation = await f.service.replace(f.serverId, f.body, randomUUID()); await complete(f, operation.id);
    let release!: () => void, enter!: () => void, permitted = true;
    const paused = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { enter = resolve; });
    const source = f.uploads.validatedSource.bind(f.uploads); let first = true;
    vi.spyOn(f.uploads, "validatedSource").mockImplementation(async (...args) => {
      if (first) { first = false; enter(); await paused; } return source(...args);
    });
    const recovery = new WorldReplacementRecovery(f.registry, f.operations, f.journal, f.library, f.uploads, f.backups, f.manager, () => undefined);
    const receipt = await f.store.list();
    const verifying = recovery.verify(f.serverId, operation.id, () => {
      if (!permitted) throw new DomainError(403, "FORBIDDEN", "Authorization expired"); return undefined;
    }, true);
    const failure = expect(verifying).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    let closed = false, closing: Promise<void> | undefined;
    try {
      await started;
      if (problem === "closing") { closing = recovery.close().then(() => { closed = true; }); await Promise.resolve(); expect(closed).toBe(false); }
      else permitted = false;
      expect(f.operations.getServerState(f.serverId).recoveryRequired).toBe(true);
    } finally { release(); }
    await failure; await closing; await recovery.close();
    expect(await f.store.list()).toEqual(receipt); expect(f.operations.getServerState(f.serverId).recoveryRequired).toBe(true);
    await expect(f.uploads.withLease(async () => {})).resolves.toBeUndefined();
  });
  it("Manager restart observes replacement without auto-settlement or world mutation", async () => {
    const f = await fixture(), operation = await f.service.replace(f.serverId, f.body, randomUUID()); await complete(f, operation.id);
    const catalog = await readFile(f.catalogFile), active = await readFile(f.activeFile), records = (await f.journal.scan()).records;
    const app = buildApp({ mode: "local", adapters: [f.adapter], clock, managerRoot: f.manager, transactionJournal: f.journal,
      operationStore: f.store, activeWorldState: f.states, backupSchedulerTimers: false });
    try {
      await app.ready(); await app.managerRecovery.wait();
      expect(app.managerRecovery.stages.some(item => item.phase === "world-replacement-observe" && item.result === "PASS")).toBe(true);
      const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui" };
      const response = await app.inject({ url: `/api/v1/operations/${operation.id}`, headers });
      expect(response.statusCode).toBe(200); expect(response.json().data.state).toBe("interrupted");
      const start = await app.inject({ method: "POST", url: `/api/v1/servers/${f.serverId}/actions/start`,
        headers: { ...headers, "idempotency-key": randomUUID() }, payload: {} });
      expect(start.statusCode).toBe(409); expect(start.json().error.code).toBe("RECOVERY_REQUIRED");
      expect(await readFile(f.catalogFile)).toEqual(catalog); expect(await readFile(f.activeFile)).toEqual(active);
      expect((await f.journal.scan()).records).toEqual(records); expect(f.start).not.toHaveBeenCalled();
    } finally { await app.close(); }
    expect(f.adapter.closeObserver).toHaveBeenCalledOnce();
  });
  it("Manager close joins replacement verification before disposing its adapters", async () => {
    const f = await fixture(); let release!: () => void, enter!: () => void, first = true;
    const paused = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
    const close = WorldReplacementRecovery.prototype.close;
    const spy = vi.spyOn(WorldReplacementRecovery.prototype, "close").mockImplementation(async function(this: WorldReplacementRecovery) {
      if (first) { first = false; enter(); await paused; } await close.call(this);
    });
    const app = buildApp({ mode: "local", adapters: [f.adapter], clock, managerRoot: f.manager, transactionJournal: f.journal,
      operationStore: f.store, activeWorldState: f.states, backupSchedulerTimers: false });
    try {
      await app.ready(); const closing = app.close();
      try { await entered; expect(f.adapter.closeObserver).not.toHaveBeenCalled(); } finally { release(); }
      await closing; expect(f.adapter.closeObserver).toHaveBeenCalledOnce();
    } finally { release(); spy.mockRestore(); await app.close(); }
  });
  it("Manager close drains its actual paused replacement proof before adapter disposal", async () => {
    const f = await fixture(), operation = await f.service.replace(f.serverId, f.body, randomUUID()); await complete(f, operation.id);
    const captured: { recovery?: WorldReplacementRecovery } = {};
    const reconcile = WorldReplacementRecovery.prototype.reconcileStartup;
    const observer = vi.spyOn(WorldReplacementRecovery.prototype, "reconcileStartup").mockImplementation(function(this: WorldReplacementRecovery, check) {
      captured.recovery = this; return reconcile.call(this, check);
    });
    const app = buildApp({ mode: "local", adapters: [f.adapter], clock, managerRoot: f.manager, transactionJournal: f.journal,
      operationStore: f.store, activeWorldState: f.states, backupSchedulerTimers: false });
    let release!: () => void, enter!: () => void, pausedOnce = false;
    const held = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
    let sourceSpy: ReturnType<typeof vi.spyOn> | undefined, closing: Promise<void> | undefined;
    try {
      await app.ready(); await app.managerRecovery.wait(); expect(captured.recovery).toBeDefined();
      const before = await f.store.list(), source = WorldImportUploadService.prototype.validatedSource;
      sourceSpy = vi.spyOn(WorldImportUploadService.prototype, "validatedSource").mockImplementation(async function(this: WorldImportUploadService, ...args) {
        if (!pausedOnce) { pausedOnce = true; enter(); await held; } return source.apply(this, args);
      });
      const verifying = captured.recovery!.verify(f.serverId, operation.id, () => undefined, true);
      const failed = expect(verifying).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
      await entered; let closed = false;
      closing = app.close().then(() => { closed = true; }); await Promise.resolve();
      expect(closed).toBe(false); expect(f.adapter.closeObserver).not.toHaveBeenCalled();
      release(); await failed; await closing;
      expect(await f.store.list()).toEqual(before); expect(f.adapter.closeObserver).toHaveBeenCalledOnce();
    } finally { release(); sourceSpy?.mockRestore(); observer.mockRestore(); await closing; await app.close(); }
  });
  it("Manager does not dispose adapters when replacement verification drain is blocked", async () => {
    const f = await fixture();
    const spy = vi.spyOn(WorldReplacementRecovery.prototype, "close").mockRejectedValue(new DomainError(409, "CLEANUP_BLOCKED", "Owned work remains", "replacement-recovery-close-deadline", true));
    const app = buildApp({ mode: "local", adapters: [f.adapter], clock, managerRoot: f.manager, transactionJournal: f.journal,
      operationStore: f.store, activeWorldState: f.states, backupSchedulerTimers: false });
    try {
      await app.ready(); await expect(app.close()).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
      expect(f.adapter.closeObserver).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it.each(["replacement-before-displace-rename", "replacement-before-install-rename"])("stops closing after final awaited validation at %s", async boundary => {
    let reached = 0, closing: Promise<void> | undefined;
    const f = await fixture(async point => { if (point === boundary) { reached++; closing = f.service.close(); } });
    const operation = await f.service.replace(f.serverId, f.body, randomUUID());
    expect((await complete(f, operation.id)).state).toBe("interrupted"); await closing; expect(reached).toBe(1);
    const record = (await f.journal.scan()).records[0]!, value = record.intent.worldReplacement!;
    if (boundary === "replacement-before-displace-rename") {
      expect(await readFile(path.join(f.root, "world", "level.dat"))).toEqual(f.original);
      await expect(readFile(path.join(f.root, value.workspaceName, "previous-world", "level.dat"))).rejects.toMatchObject({ code: "ENOENT" });
    } else {
      expect(await readFile(path.join(f.root, value.workspaceName, "previous-world", "level.dat"))).toEqual(f.original);
      expect(await readFile(path.join(f.root, value.workspaceName, "world", "level.dat"))).toEqual(f.imported);
      await expect(readFile(path.join(f.root, "world", "level.dat"))).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(f.operations.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("rejects replacement admission after close without a receipt or intent", async () => {
    const f = await fixture(); await f.service.close();
    await expect(f.service.replace(f.serverId, f.body, randomUUID())).rejects.toMatchObject({ reason: "manager-closing" });
    expect((await f.journal.scan()).records).toHaveLength(0); expect(await f.store.list()).toHaveLength(0);
  });
  it.each(["replacement-displace-intent", "replacement-new-world-renamed"])("cooperatively closes at %s and drains before returning", async point => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), paused = new Promise<void>(resolve => { release = resolve; });
    const f = await fixture(async name => { if (name === point) { entered(); await paused; } });
    const operation = await f.service.replace(f.serverId, f.body, randomUUID()); await started;
    let drained = false; const closing = f.service.close().then(() => { drained = true; });
    try { await Promise.resolve(); expect(drained).toBe(false); }
    finally { release(); }
    await closing; expect((await complete(f, operation.id)).state).toBe("interrupted");
    expect(f.operations.getServerState(f.serverId).recoveryRequired).toBe(true);
    const record = (await f.journal.scan()).records[0]!, value = record.intent.worldReplacement!;
    const old = path.join(f.root, ...(point === "replacement-new-world-renamed" ? [value.workspaceName, "previous-world"] : ["world"]), "level.dat");
    expect(await readFile(old)).toEqual(f.original);
  });
  it("reports cleanup blocked without dropping an outstanding owner or forcing file cleanup", async () => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), paused = new Promise<void>(resolve => { release = resolve; });
    const f = await fixture(async name => { if (name === "replacement-displace-intent") { entered(); await paused; } });
    const operation = await f.service.replace(f.serverId, f.body, randomUUID()); await started;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const closed = expect(f.service.close()).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
      await vi.advanceTimersByTimeAsync(5000); await closed;
      expect(f.operations.getServerState(f.serverId).activeOperationId).toBe(operation.id);
      expect(await readFile(path.join(f.root, "world", "level.dat"))).toEqual(f.original);
    } finally { vi.useRealTimers(); release(); }
    expect((await complete(f, operation.id)).state).toBe("interrupted"); await f.service.close();
  });
  it("revokes a retained consume callback after its owner closes without settlement", async () => {
    const f = await fixture(), operation = await f.service.replace(f.serverId, f.body, randomUUID()); await complete(f, operation.id);
    const proof = await f.uploads.withLease(() => verifyReplacementCurrentState(f.adapter, f.manager, f.journal, f.library, f.backups, f.uploads));
    let escaped: ((proof: ReplacementOutcomeProof) => Promise<void>) | undefined;
    const receipt = await f.store.list();
    await expect(f.operations.verifyReplacementOutcome(f.serverId, operation.id, async consume => { escaped = consume; }, () => undefined, true))
      .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    await expect(escaped!(proof)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await f.store.list()).toEqual(receipt); expect(f.operations.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("revokes and drains detached verification before releasing the instance lease", async () => {
    const f = await fixture(), operation = await f.service.replace(f.serverId, f.body, randomUUID()); await complete(f, operation.id);
    let release!: () => void, entered!: () => void, ownerReturned = false;
    const paused = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const receipt = await f.store.list(); let detached: Promise<void> | undefined;
    const settlement = f.operations.verifyReplacementOutcome(f.serverId, operation.id, consume => f.uploads.withLease(async () => {
      const proof = await verifyReplacementCurrentState(f.adapter, f.manager, f.journal, f.library, f.backups, f.uploads);
      detached = consume({ ...proof, recheck: async () => { entered(); await paused; await proof.recheck(); } });
      void detached.catch(() => {}); ownerReturned = true;
    }), () => undefined, true);
    await started; await vi.waitFor(() => expect(ownerReturned).toBe(true));
    expect(f.operations.get(operation.id)?.state).toBe("interrupted");
    release(); await expect(settlement).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    await expect(detached).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await f.store.list()).toEqual(receipt); expect(f.operations.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("does not expose receipt success while final physical verification is pending", async () => {
    const f = await fixture(), operation = await f.service.replace(f.serverId, f.body, randomUUID()); await complete(f, operation.id);
    let observedFinal = false, calls = 0;
    await f.operations.verifyReplacementOutcome(f.serverId, operation.id, consume => f.uploads.withLease(async () => {
      const proof = await verifyReplacementCurrentState(f.adapter, f.manager, f.journal, f.library, f.backups, f.uploads);
      await consume({ ...proof, recheck: async () => {
        if (++calls === 2) { observedFinal = true; expect(f.operations.get(operation.id)?.state).toBe("interrupted"); }
        await proof.recheck();
      } });
    }), () => undefined, true);
    expect(observedFinal).toBe(true); expect(f.operations.get(operation.id)?.state).toBe("succeeded");
  });
  it("clears only the exact live inspection cause after trusted current-state proof under both leases", async () => {
    const f = await fixture(), operation = await f.service.replace(f.serverId, f.body, randomUUID()); await complete(f, operation.id);
    const receipt = await f.store.list();
    const result = await f.operations.verifyReplacementOutcome(f.serverId, operation.id, consume => f.uploads.withLease(async () => {
      const proof = await verifyReplacementCurrentState(f.adapter, f.manager, f.journal, f.library, f.backups, f.uploads);
      await consume(proof);
      // Instance lease remains held even after the internal gate is cleared.
      await expect(f.operations.runReadAdmission(f.serverId, async () => {})).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
      await expect(f.uploads.withLease(async () => {})).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    }), () => undefined);
    expect(result.state).toBe("succeeded"); expect(await f.store.list()).toEqual(receipt);
    expect(f.operations.getServerState(f.serverId).recoveryRequired).toBe(false);
    await expect(f.operations.runReadAdmission(f.serverId, async () => "ready")).resolves.toBe("ready");
    expect(() => f.operations.confirmPhysicalTransaction(operation.id)).toThrow();
  });
  it("requires explicit recovery to settle a restarted interrupted receipt without replaying data changes", async () => {
    const f = await fixture(), key = randomUUID(), operation = await f.service.replace(f.serverId, f.body, key); await complete(f, operation.id);
    const record = (await f.journal.scan()).records[0]!, bytes = await readFile(path.join(f.manager, "transactions", `${f.serverId}.${record.transactionId}.json`));
    const restarted = new OperationService(f.store, clock, f.journal); await restarted.initialize();
    const receipt = await f.store.list();
    const withProof = (consume: (proof: ReplacementOutcomeProof) => Promise<void>) =>
      f.uploads.withLease(async () => consume(await verifyReplacementCurrentState(f.adapter, f.manager, f.journal, f.library, f.backups, f.uploads)));
    await expect(restarted.verifyReplacementOutcome(f.serverId, operation.id, withProof, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await f.store.list()).toEqual(receipt);
    const recovered = await restarted.verifyReplacementOutcome(f.serverId, operation.id, withProof, () => undefined, true);
    expect(recovered).toMatchObject({ state: "succeeded", step: "replacement-verified-recovery", result: { resourceId: record.intent.worldReplacement!.worldId } });
    expect(restarted.getServerState(f.serverId).recoveryRequired).toBe(false);
    expect(await readFile(path.join(f.manager, "transactions", `${f.serverId}.${record.transactionId}.json`))).toEqual(bytes);
    expect(await readFile(path.join(f.root, "world", "level.dat"))).toEqual(f.imported);
    const replay = new WorldReplacementService(restarted, f.journal, f.library, f.imports, f.uploads, f.backups, f.manager, clock);
    expect((await replay.replace(f.serverId, f.body, key)).id).toBe(operation.id); expect((await f.journal.scan()).records).toHaveLength(1);
  });
  it.each(["unrelated", "admission-revoked", "receipt-write", "late-physical", "double-consume", "no-consume"])("retains recovery on outcome settlement failure: %s", async problem => {
    const f = await fixture(), key = randomUUID(), operation = await f.service.replace(f.serverId, f.body, key); await complete(f, operation.id);
    const record = (await f.journal.scan()).records[0]!, journalFile = path.join(f.manager, "transactions", `${f.serverId}.${record.transactionId}.json`), bytes = await readFile(journalFile);
    let admitted = true, proofCalls = 0; const events: string[] = [], unsubscribe = f.operations.subscribe(event => events.push(event.state));
    if (problem === "unrelated") f.operations.requireRecovery([f.serverId]);
    if (problem === "receipt-write") f.store.failWrites = true;
    const result = f.operations.verifyReplacementOutcome(f.serverId, operation.id, consume => f.uploads.withLease(async () => {
      if (problem === "no-consume") return;
      const proof = await verifyReplacementCurrentState(f.adapter, f.manager, f.journal, f.library, f.backups, f.uploads);
      if (problem === "admission-revoked") admitted = false;
      const wrapped = { ...proof, recheck: async () => {
        if (++proofCalls === 2 && problem === "late-physical") await writeFile(path.join(f.root, "world", "post-settlement.dat"), "late change");
        await proof.recheck();
      } };
      await consume(wrapped); if (problem === "double-consume") await consume(proof);
    }), () => { if (!admitted) throw new DomainError(403, "FORBIDDEN", "Admission revoked"); return undefined; }, true);
    await expect(result).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" }); unsubscribe();
    f.store.failWrites = false;
    expect(f.operations.getServerState(f.serverId).recoveryRequired).toBe(true);
    expect(f.operations.getServerState(f.serverId).activeOperationId).toBeNull();
    expect(await readFile(journalFile)).toEqual(bytes); expect(events).not.toContain("succeeded");
    if (problem === "late-physical" || problem === "double-consume") {
      expect(f.operations.get(operation.id)?.state).toBe("interrupted");
      expect((await f.service.replace(f.serverId, f.body, key)).state).toBe("interrupted");
    }
  });
  it.each(["valid", "missing-birth", "wrong-object", "wrong-identity-checkpoint"])("audits explicitly retired import birth metadata: %s", async problem => {
    const f = await fixture(undefined, true), operation = await f.service.replace(f.serverId, f.body, randomUUID()); await complete(f, operation.id);
    const records = (await f.journal.scan()).records, replacement = records.find(record => record.intent.worldReplacement)!, value = replacement.intent.worldReplacement!;
    const birth = records.find(record => record.intent.worldLibraryImport)!, imported = birth.intent.worldLibraryImport!;
    // Binding-only fixture: relocate the synthetic birth metadata to the retained
    // predecessor. This is not evidence that this alternate import was executed.
    Object.assign(imported, { worldId: value.previousWorldId, targetName: "world" }); Object.assign(birth.intent, { resourceId: value.previousWorldId });
    for (const point of birth.checkpoints) if (point.details) {
      point.details.resourceId = value.previousWorldId;
      if (["independent-world-staged", "independent-world-installed"].includes(point.name)) point.details.filesystemIdentity = value.currentObjectIdentity;
    }
    const catalog = JSON.parse(await readFile(f.catalogFile, "utf8"));
    catalog.entries = catalog.entries.filter((entry: { worldId: string }) => entry.worldId !== f.inactiveId);
    Object.assign(catalog.entries.find((entry: { worldId: string }) => entry.worldId === value.previousWorldId), {
      origin: "import", operationId: birth.intent.operationId, admissionRevision: imported.libraryRevision, legacySlotId: null });
    await writeFile(f.catalogFile, JSON.stringify(catalog) + "\n");
    if (problem === "missing-birth") records.splice(records.indexOf(birth), 1);
    if (problem === "wrong-object") birth.checkpoints.find(point => point.name === "independent-world-staged")!.details!.filesystemIdentity = "0".repeat(64);
    if (problem === "wrong-identity-checkpoint") birth.checkpoints.find(point => point.name === "independent-identity-installed")!.details!.checksumSha256 = "0".repeat(64);
    // New reader observes this deliberately constructed metadata fixture; the
    // original store correctly refuses any external catalog revision change.
    const reader = new WorldLibraryStore(f.manager, clock);
    const bytes = await readFile(f.catalogFile), result = reader.auditReplacementImportBindings(f.binding, records, replacement);
    if (problem === "valid") await expect(result).resolves.toHaveLength(1);
    else await expect(result).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await readFile(f.catalogFile)).toEqual(bytes);
  });
  it("keeps authentic inactive import births and retained sources verified on every current-state recheck", async () => {
    const f = await fixture(undefined, true), operation = await f.service.replace(f.serverId, f.body, randomUUID());
    expect((await complete(f, operation.id)).state).toBe("succeeded");
    const proof = await f.uploads.withLease(() => verifyReplacementCurrentState(f.adapter, f.manager, f.journal, f.library, f.backups, f.uploads));
    await f.uploads.withLease(() => proof.recheck());
    await writeFile(path.join(f.manager, "world-imports", f.inactiveUploadId!, "world", "level.dat"), "corrupt-retained-inactive-source");
    await expect(f.uploads.withLease(() => proof.recheck())).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(f.operations.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it.each(["root", "admission", "identity-checkpoint", "missing-record", "missing-source", "missing-claim", "malformed-claim"])("rejects inactive birth evidence drift: %s", async problem => {
    const f = await fixture(undefined, true), operation = await f.service.replace(f.serverId, f.body, randomUUID()); await complete(f, operation.id);
    const records = (await f.journal.scan()).records, birth = records.find(record => record.intent.worldLibraryImport)!;
    const file = path.join(f.manager, "transactions", `${f.serverId}.${birth.transactionId}.json`);
    if (problem === "root") Object.assign(birth.intent.worldLibraryImport!, { rootIdentity: "0".repeat(64) });
    if (problem === "identity-checkpoint") birth.checkpoints.find(point => point.name === "independent-identity-installed")!.details!.checksumSha256 = "0".repeat(64);
    if (problem === "root" || problem === "identity-checkpoint") await writeFile(file, JSON.stringify(birth));
    if (problem === "admission") { const c = JSON.parse(await readFile(f.catalogFile, "utf8")); c.entries.find((entry: { worldId: string }) => entry.worldId === f.inactiveId).admissionRevision = "0".repeat(64); await writeFile(f.catalogFile, JSON.stringify(c)); }
    if (problem === "missing-record") await rename(file, path.join(f.manager, "retained-birth.json"));
    if (problem === "missing-source") await rename(path.join(f.manager, "world-imports", f.inactiveUploadId!), path.join(f.manager, "retained-inactive-source"));
    if (problem === "missing-claim") await rm(path.join(f.manager, "world-imports", f.inactiveUploadId!, "consumed.json"));
    if (problem === "malformed-claim") await writeFile(path.join(f.manager, "world-imports", f.inactiveUploadId!, "consumed.json"), "{}");
    await expect(f.uploads.withLease(() => verifyReplacementCurrentState(f.adapter, f.manager, f.journal, f.library, f.backups, f.uploads)))
      .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it.each(["deleted", "equal-byte-new-object"])("rejects retained inactive claim %s after proof construction", async problem => {
    const f = await fixture(undefined, true), operation = await f.service.replace(f.serverId, f.body, randomUUID()); await complete(f, operation.id);
    const proof = await f.uploads.withLease(() => verifyReplacementCurrentState(f.adapter, f.manager, f.journal, f.library, f.backups, f.uploads));
    const file = path.join(f.manager, "world-imports", f.inactiveUploadId!, "consumed.json"), bytes = await readFile(file);
    await rename(file, path.join(f.manager, "retained-inactive-claim.json"));
    if (problem === "equal-byte-new-object") await writeFile(file, bytes);
    await expect(f.uploads.withLease(() => proof.recheck())).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it("observes legitimate post-replacement saves and settings changes without clearing inspection", async () => {
    const f = await fixture(), operation = await f.service.replace(f.serverId, f.body, randomUUID());
    expect((await complete(f, operation.id)).state).toBe("succeeded");
    await writeFile(path.join(f.root, "world", "level.dat"), testWorldLevel("normal-world-save", true, 5023));
    await writeFile(path.join(f.root, "world", "new-region.dat"), "legitimate updated region");
    await writeFile(path.join(f.root, "server.properties"), f.properties.replace("max-players=20", "max-players=25"));
    const before = await readFile(f.catalogFile), proof = await f.uploads.withLease(() => verifyReplacementCurrentState(f.adapter, f.manager, f.journal, f.library, f.backups, f.uploads));
    expect(proof.operationId).toBe(operation.id); expect(proof.worldId).toBe(f.operations.get(operation.id)?.result?.resourceId);
    await f.uploads.withLease(() => proof.recheck());
    expect(await readFile(f.catalogFile)).toEqual(before); expect(f.operations.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it.each(["head-pending", "guard", "preserved", "approval", "target-corrupt", "wrong-level", "claim", "missing-active"])("keeps read-only current-state proof closed on %s", async problem => {
    const f = await fixture(), operation = await f.service.replace(f.serverId, f.body, randomUUID()); await complete(f, operation.id);
    const record = (await f.journal.scan()).records[0]!, value = record.intent.worldReplacement!;
    if (problem === "head-pending") { const c = JSON.parse(await readFile(f.catalogFile, "utf8")); c.transitionHead.state = "pending"; c.transitionHead.recordDigest = null; await writeFile(f.catalogFile, JSON.stringify(c)); }
    if (problem === "guard") await writeFile(path.join(f.manager, "backups", f.serverId, value.guardBackupId, "payload", "world", "level.dat"), "corrupt");
    if (problem === "preserved") await writeFile(path.join(f.root, value.workspaceName, "previous-world", "level.dat"), "corrupt");
    if (problem === "approval") await writeFile(path.join(f.root, value.workspaceName, "active.before"), "{}");
    if (problem === "target-corrupt") await writeFile(path.join(f.root, "world", "level.dat"), "invalid-NBT");
    if (problem === "wrong-level") await writeFile(path.join(f.root, "server.properties"), "level-name=Other\n");
    if (problem === "claim") await writeFile(path.join(f.manager, "world-imports", value.uploadId, "consumed.json"), "{}");
    if (problem === "missing-active") await rm(f.activeFile);
    await expect(f.uploads.withLease(() => verifyReplacementCurrentState(f.adapter, f.manager, f.journal, f.library, f.backups, f.uploads)))
      .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(f.operations.getServerState(f.serverId).recoveryRequired).toBe(true);
    if (problem === "missing-active") await expect(readFile(f.activeFile)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects journal or target mutation after current-state observation without repairing it", async () => {
    const f = await fixture(), operation = await f.service.replace(f.serverId, f.body, randomUUID()); await complete(f, operation.id);
    const proof = await f.uploads.withLease(() => verifyReplacementCurrentState(f.adapter, f.manager, f.journal, f.library, f.backups, f.uploads));
    await writeFile(path.join(f.root, "world", "changed-after-observation.dat"), "late change");
    await expect(f.uploads.withLease(() => proof.recheck())).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await readFile(path.join(f.root, "world", "changed-after-observation.dat"), "utf8")).toBe("late change");
  });
  it.each(["catalog-object", "target-object", "journal", "running", "cancel"])("rejects current-state proof freshness change: %s", async problem => {
    const f = await fixture(), operation = await f.service.replace(f.serverId, f.body, randomUUID()); await complete(f, operation.id);
    let cancelled = false;
    const proof = await f.uploads.withLease(() => verifyReplacementCurrentState(f.adapter, f.manager, f.journal, f.library, f.backups, f.uploads,
      () => { if (cancelled) throw new Error("cancelled"); }));
    if (problem === "catalog-object") { const bytes = await readFile(f.catalogFile); await rename(f.catalogFile, path.join(f.manager, "retained-catalog.json")); await writeFile(f.catalogFile, bytes); }
    if (problem === "target-object") { await rename(path.join(f.root, "world"), path.join(f.root, "retained-world")); await cp(path.join(f.root, "retained-world"), path.join(f.root, "world"), { recursive: true }); }
    if (problem === "journal") { const record = (await f.journal.scan()).records[0]!; Object.assign(record, { updatedAt: "2026-10-27T04:00:01.000Z" }); await writeFile(path.join(f.manager, "transactions", `${f.serverId}.${record.transactionId}.json`), JSON.stringify(record)); }
    if (problem === "running") { f.status.state = "running"; f.status.ownership = "managed"; }
    if (problem === "cancel") cancelled = true;
    await expect(f.uploads.withLease(() => proof.recheck())).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(f.operations.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("preserves old data and pinned guard, installs a fresh identity, and retains live inspection gate", async () => {
    const f = await fixture(), active = await readFile(f.activeFile);
    const operation = await f.service.replace(f.serverId, f.body, randomUUID()), outcome = await complete(f, operation.id);
    expect(outcome.state).toBe("succeeded");
    expect(outcome.result?.resourceId).not.toBe(f.body.currentWorldId);
    const scan = await f.journal.scan(); expect(scan.issues).toEqual([]); expect(scan.records).toHaveLength(1);
    const record = scan.records[0]!, value = record.intent.worldReplacement!;
    expect(record.schemaVersion).toBe(13); expect(record.state).toBe("committed");
    expect(record.checkpoints.map(point => point.name)).toEqual([...replacementExecutionCheckpoints]);
    expect(await readFile(path.join(f.root, "world", "level.dat"))).toEqual(f.imported);
    expect(await readFile(path.join(f.root, value.workspaceName, "previous-world", "level.dat"))).toEqual(f.original);
    const guard = await f.backups.exportSource(f.serverId, value.guardBackupId);
    expect(guard.manifest.pinned).toBe(true); expect(await readFile(path.join(guard.directory, "payload", "world", "level.dat"))).toEqual(f.original);
    const catalog = JSON.parse(await readFile(f.catalogFile, "utf8"));
    expect(catalog.entries.find((e: { worldId: string }) => e.worldId === f.body.currentWorldId).state).toBe("retired");
    expect(catalog.entries.find((e: { worldId: string }) => e.worldId === value.worldId).state).toBe("present");
    expect(catalog.transitionHead.state).toBe("committed");
    expect(await readFile(f.activeFile)).toEqual(active); expect(await readFile(path.join(f.root, "server.properties"), "utf8")).toBe(f.properties);
    expect(f.operations.getServerState(f.serverId).recoveryRequired).toBe(true);
    await expect(f.operations.runReadAdmission(f.serverId, async () => {})).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(() => f.operations.confirmPhysicalTransaction(operation.id)).toThrow();
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it("retains permanent same-key binding across reinitialization and rejects body conflicts", async () => {
    const f = await fixture(), key = randomUUID(), first = await f.service.replace(f.serverId, f.body, key);
    expect((await complete(f, first.id)).state).toBe("succeeded");
    expect((await f.service.replace(f.serverId, f.body, key)).id).toBe(first.id);
    await expect(f.service.replace(f.serverId, { ...f.body, confirmWorldName: "different" }, key)).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    const restarted = new OperationService(f.store, { now: () => new Date("2026-11-27T04:00:00Z") }, f.journal); await restarted.initialize();
    const service = new WorldReplacementService(restarted, f.journal, f.library, f.imports, f.uploads, f.backups, f.manager, clock);
    expect((await service.replace(f.serverId, f.body, key)).id).toBe(first.id); expect((await f.journal.scan()).records).toHaveLength(1);
    expect(restarted.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it.each(["uploadRevision", "libraryRevision", "currentWorldId", "currentWorldRevision", "currentContentRevision", "propertiesRevision", "confirmWorldName"] as const)("rejects stale %s before intent or world changes", async field => {
    const f = await fixture();
    await expect(f.service.replace(f.serverId, { ...f.body, [field]: "changed" }, randomUUID())).rejects.toMatchObject({ code: "WORLD_REVISION_CONFLICT" });
    expect((await f.journal.scan()).records).toHaveLength(0); expect(await f.store.list()).toHaveLength(0);
    expect(await readFile(path.join(f.root, "world", "level.dat"))).toEqual(f.original);
  });
  it("rejects a running server without stopping it", async () => {
    const f = await fixture(); f.status.state = "running"; f.status.ownership = "managed";
    await expect(f.service.replace(f.serverId, f.body, randomUUID())).rejects.toMatchObject({ code: "SERVER_MUST_BE_STOPPED" });
    expect((await f.journal.scan()).records).toHaveLength(0); expect(f.stop).not.toHaveBeenCalled();
  });
  it.each([...replacementExecutionCheckpoints, "replacement-old-world-renamed", "replacement-new-world-renamed",
    "replacement-commit-persisted", "replacement-head-completed", "replacement-after-commit"])("retains protection and blocks the same live instance after interruption at %s", async point => {
    let reached = 0;
    const f = await fixture(async name => { if (name === point) { reached++; throw new Error("controlled-interruption"); } });
    const operation = await f.service.replace(f.serverId, f.body, randomUUID()), outcome = await complete(f, operation.id);
    expect(outcome.state).toBe("interrupted"); expect(outcome.error?.code).toBe("RECOVERY_REQUIRED");
    expect(reached).toBe(1);
    expect(f.operations.getServerState(f.serverId).recoveryRequired).toBe(true);
    const records = (await f.journal.scan()).records; expect(records).toHaveLength(1);
    const record = records[0]!, value = record.intent.worldReplacement!, committed = ["replacement-commit-persisted", "replacement-head-completed", "replacement-after-commit"].includes(point);
    expect(record.state).toBe(committed ? "committed" : "recovery-required");
    const markerIndex = (replacementExecutionCheckpoints as readonly string[]).indexOf(point);
    const count = markerIndex >= 0 ? markerIndex + 1 : point === "replacement-old-world-renamed" ? 11 : point === "replacement-new-world-renamed" ? 13 : 15;
    expect(record.checkpoints.map(marker => marker.name)).toEqual(replacementExecutionCheckpoints.slice(0, count));
    const names = await readdir(f.root), moved = record.checkpoints.some(p => p.name === "replacement-old-world-preserved") || point === "replacement-old-world-renamed";
    if (moved) expect(await readFile(path.join(f.root, value.workspaceName, "previous-world", "level.dat"))).toEqual(f.original);
    else expect(await readFile(path.join(f.root, "world", "level.dat"))).toEqual(f.original);
    if (["replacement-old-world-renamed", "replacement-old-world-preserved", "replacement-install-intent"].includes(point)) {
      await expect(readFile(path.join(f.root, "world", "level.dat"))).rejects.toMatchObject({ code: "ENOENT" });
    } else if (point === "replacement-new-world-renamed" || count >= 14) {
      expect(await readFile(path.join(f.root, "world", "level.dat"))).toEqual(f.imported);
    }
    if (record.checkpoints.some(p => p.name === "replacement-guard-verified")) expect((await f.backups.exportSource(f.serverId, value.guardBackupId)).manifest.pinned).toBe(true);
    if (committed) expect(JSON.parse(await readFile(f.catalogFile, "utf8")).transitionHead.state).toBe("pending");
    expect(names).toContain("server.properties"); expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
});
