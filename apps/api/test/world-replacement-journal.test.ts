import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransactionJournalStore, type CreateTransactionIntent } from "../src/services/transaction-journal.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore, type StoredOperation } from "../src/services/operation-store.js";
import { buildApp } from "../src/app.js";
import { ActiveWorldStateStore, worldIdentity } from "../src/services/active-world-state-store.js";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";

const roots: string[] = [], now = "2026-10-27T00:00:00.000Z", clock = { now: () => new Date(now) };
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "lt-replacement-intent-")); roots.push(root);
  const operationId = randomUUID(), guardBackupId = randomUUID(), worldId = `worldv2-${randomUUID()}`;
  const workspaceName = `.manager-world-replace-${operationId}`;
  const intent: CreateTransactionIntent = { operationId, serverId: "replacement-test", kind: "world-replace", scope: "world-set",
    resourceId: worldId, allowStop: false, originalState: "stopped", createdAt: now,
    paths: [{ role: "source", namespace: "server", relativePath: "world" }, { role: "target", namespace: "server", relativePath: "world" },
      { role: "staging", namespace: "server", relativePath: workspaceName },
      { role: "archive", namespace: "server", relativePath: `${workspaceName}/previous-world` },
      { role: "rollback", namespace: "manager", relativePath: `backups/replacement-test/${guardBackupId}` }],
    worldReplacement: { rootIdentity: "1".repeat(64), catalogId: randomUUID(), worldId, previousWorldId: `worldv2-${randomUUID()}`,
      levelName: "world", confirmationName: "world", libraryRevision: "2".repeat(64), currentWorldRevision: "3".repeat(64),
      currentContentChecksum: "4".repeat(64), currentDirectoryIdentity: "5".repeat(64), currentObjectIdentity: "6".repeat(64),
      propertiesRevision: "7".repeat(64), propertiesChecksum: "8".repeat(64), uploadId: randomUUID(), uploadRevision: "9".repeat(64),
      importedChecksum: "a".repeat(64), minecraftVersion: "26.3", guardBackupId, sequence: 1, predecessorTransactionId: null, workspaceName } };
  const journal = new TransactionJournalStore(root); await journal.initialize(); return { root, journal, intent };
}
function receipt(intent: CreateTransactionIntent): StoredOperation {
  return { operation: { id: intent.operationId, serverId: intent.serverId, kind: "world-replace", state: "succeeded",
    step: "committed", progress: null, createdAt: now, updatedAt: now, result: { resourceId: intent.resourceId, rollbackAvailable: false }, error: null },
    idempotencyKey: randomUUID(), requestFingerprint: "a".repeat(64), expiresAt: "2026-11-01T00:00:00Z" };
}
describe("replacement intent inspection only; no executor/physical verifier", () => {
  it("persists explicitly versioned approval admission without granting recovery authority", async () => {
    const f = await fixture(), approval = { schemaVersion: 1 as const, propertiesIdentity: "a".repeat(64),
      activeStateIdentity: "b".repeat(64), activeStateChecksum: "c".repeat(64), catalogFileIdentity: "d".repeat(64) };
    Object.assign(f.intent.worldReplacement!, { approval, propertiesRevision: createHash("sha256").update(`${approval.propertiesIdentity}\0${f.intent.worldReplacement!.propertiesChecksum}`).digest("hex") });
    const created = await f.journal.createIntent(f.intent); expect(created.schemaVersion).toBe(13);
    approval.activeStateChecksum = "e".repeat(64);
    expect(created.intent.worldReplacement!.approval!.activeStateChecksum).toBe("c".repeat(64));
    const restarted = new TransactionJournalStore(f.root), scan = await restarted.initialize();
    expect(scan.issues).toHaveLength(0); expect(scan.records[0]!.schemaVersion).toBe(13);
    const operations = new OperationService(new MemoryOperationStore(), clock, restarted); await operations.initialize();
    expect(() => operations.confirmPhysicalTransaction(f.intent.operationId)).toThrow(expect.objectContaining({ code: "RECOVERY_REQUIRED" }));
    expect(operations.isPhysicalTransactionConfirmed(f.intent.operationId)).toBe(false);
    expect(operations.getServerState(f.intent.serverId).recoveryRequired).toBe(true);
  });
  it.each(["unknown-version", "missing-identity", "invalid-hash", "extra-key", "properties-revision"])("rejects malformed approval admission: %s", async problem => {
    const f = await fixture(), approval: Record<string, unknown> = { schemaVersion: 1, propertiesIdentity: "a".repeat(64),
      activeStateIdentity: "b".repeat(64), activeStateChecksum: "c".repeat(64), catalogFileIdentity: "d".repeat(64) };
    Object.assign(f.intent.worldReplacement!, { approval, propertiesRevision: createHash("sha256").update(`${approval.propertiesIdentity}\0${f.intent.worldReplacement!.propertiesChecksum}`).digest("hex") });
    if (problem === "unknown-version") approval.schemaVersion = 2;
    if (problem === "missing-identity") Reflect.deleteProperty(approval, "catalogFileIdentity");
    if (problem === "invalid-hash") approval.activeStateChecksum = "invalid";
    if (problem === "extra-key") approval.path = "untrusted";
    if (problem === "properties-revision") Object.assign(f.intent.worldReplacement!, { propertiesRevision: "f".repeat(64) });
    await expect(f.journal.createIntent(f.intent)).rejects.toThrow();
    expect((await f.journal.scan()).records).toHaveLength(0);
  });
  it.each(["downgraded", "missing-approval", "changed-original-identity"])("retains invalid persisted approval bytes and gates recovery: %s", async problem => {
    const f = await fixture(), approval = { schemaVersion: 1 as const, propertiesIdentity: "a".repeat(64),
      activeStateIdentity: "b".repeat(64), activeStateChecksum: "c".repeat(64), catalogFileIdentity: "d".repeat(64) };
    Object.assign(f.intent.worldReplacement!, { approval, propertiesRevision: createHash("sha256").update(`${approval.propertiesIdentity}\0${f.intent.worldReplacement!.propertiesChecksum}`).digest("hex") });
    const record = await f.journal.createIntent(f.intent), payload = structuredClone(record);
    if (problem === "downgraded") Object.assign(payload, { schemaVersion: 12 });
    if (problem === "missing-approval") Reflect.deleteProperty(payload.intent.worldReplacement!, "approval");
    if (problem === "changed-original-identity") Object.assign(payload.intent.worldReplacement!.approval!, { propertiesIdentity: "f".repeat(64) });
    const file = path.join(f.root, "transactions", `${f.intent.serverId}.${record.transactionId}.json`), bytes = JSON.stringify(payload);
    await writeFile(file, bytes);
    const restarted = new TransactionJournalStore(f.root), scan = await restarted.initialize();
    expect(scan.records).toHaveLength(0); expect(scan.recoveryServerIds.has(f.intent.serverId)).toBe(true);
    expect(await readFile(file, "utf8")).toBe(bytes);
  });
  it.each(["committed", "rolled-back"] as const)("generic recovery preserves exact interrupted receipt with a %s journal", async state => {
    const f = await fixture(), record = await f.journal.createIntent(f.intent);
    await f.journal.setState(f.intent.serverId, record.transactionId, state, now);
    const store = new MemoryOperationStore(); await store.save(receipt(f.intent));
    const operations = new OperationService(store, clock, f.journal);
    // A premature trusted marker cannot make this unsupported kind verified.
    operations.confirmPhysicalTransaction(f.intent.operationId); await operations.initialize();
    expect(operations.isPhysicalTransactionConfirmed(f.intent.operationId)).toBe(false);
    expect(operations.get(f.intent.operationId)).toMatchObject({ state: "interrupted", error: { code: "RECOVERY_REQUIRED" } });
    const bytes = JSON.stringify(await store.list());
    await expect(operations.resolveOwnedRecovery(f.intent.serverId, [f.intent.operationId]))
      .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(JSON.stringify(await store.list())).toBe(bytes);
    expect(operations.getServerState(f.intent.serverId).recoveryRequired).toBe(true);
  });
  it.each([12, 13].flatMap(version => ["journal-missing", "journal-pending", "receipt-missing", "receipt-pending"].map(scenario => ({ version, scenario }))))("real app startup protects schema$version active slot: $scenario", async ({ version, scenario }) => {
    const f = await fixture(), server = path.join(f.root, "server"), store = new MemoryOperationStore();
    if (version === 13) {
      const approval = { schemaVersion: 1, propertiesIdentity: "a".repeat(64), activeStateIdentity: "b".repeat(64), activeStateChecksum: "c".repeat(64), catalogFileIdentity: "d".repeat(64) };
      Object.assign(f.intent.worldReplacement!, { approval, propertiesRevision: createHash("sha256").update(`${approval.propertiesIdentity}\0${f.intent.worldReplacement!.propertiesChecksum}`).digest("hex") });
    }
    await mkdir(path.join(server, "world"), { recursive: true });
    await writeFile(path.join(server, "world", "level.dat"), "isolated-not-real-Minecraft");
    await writeFile(path.join(server, "server.properties"), "level-name=world\n");
    if (scenario.startsWith("journal")) {
      const record = await f.journal.createIntent(f.intent); await f.journal.setState(f.intent.serverId, record.transactionId, "committed", now);
    } else await store.save(receipt(f.intent));
    const active = path.join(f.root, "active-worlds", `${f.intent.serverId}.json`);
    const pending = JSON.stringify({ schemaVersion: 1, serverId: f.intent.serverId, state: "pending-generation", levelName: "world",
      worldId: worldIdentity(f.intent.serverId, "world") });
    if (scenario.endsWith("pending")) { await mkdir(path.dirname(active), { recursive: true }); await writeFile(active, pending); }
    const start = vi.fn(), adapter = { mode: "local", serverId: f.intent.serverId,
      plan: { rootPath: server, serverInfo: { type: "vanilla", minecraftVersion: "26.3" } },
      getStatus: async () => ({ state: "stopped", ownership: "none", recoveryRequired: false }),
      getServerInfo: async () => ({ type: "vanilla", minecraftVersion: "26.3" }), getCapabilities: async () => ({ worlds: true, backup: true }),
      subscribe: () => () => {}, closeObserver: async () => {}, start } as unknown as LocalMinecraftServerAdapter;
    const states = new ActiveWorldStateStore(f.root, [adapter]);
    const app = buildApp({ mode: "local", adapters: [adapter], managerRoot: f.root, transactionJournal: f.journal,
      operationStore: store, activeWorldState: states, backupSchedulerTimers: false, worldActivationExecution: true });
    try {
      await app.ready(); await vi.waitFor(() => expect(app.managerRecovery.available).toBe(true));
      const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui", "idempotency-key": randomUUID() };
      const response = await app.inject({ method: "POST", url: `/api/v1/servers/${f.intent.serverId}/actions/start`, headers, payload: {} });
      expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe("RECOVERY_REQUIRED"); expect(start).not.toHaveBeenCalled();
      if (scenario.endsWith("pending")) expect(await readFile(active, "utf8")).toBe(pending);
      else await expect(readFile(active)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(path.join(server, "world", "level.dat"), "utf8")).toBe("isolated-not-real-Minecraft");
    } finally { await app.close(); }
  });
  it.each(["active", "committed", "rolled-back", "recovery-required"] as const)("preserves %s evidence and keeps generic recovery unable to unlock it", async state => {
    const f = await fixture(), created = await f.journal.createIntent(f.intent);
    expect(created.schemaVersion).toBe(12);
    if (state !== "active") await f.journal.setState(f.intent.serverId, created.transactionId, state, now);
    const restarted = new TransactionJournalStore(f.root), scan = await restarted.initialize();
    expect(scan.issues).toHaveLength(0); expect(scan.records[0]!.intent.worldReplacement).toEqual(f.intent.worldReplacement);
    const operations = new OperationService(new MemoryOperationStore(), clock, restarted); await operations.initialize();
    expect(operations.getServerState(f.intent.serverId).recoveryRequired).toBe(true);
    expect(() => operations.confirmPhysicalTransaction(f.intent.operationId)).toThrow(expect.objectContaining({ code: "RECOVERY_REQUIRED" }));
    expect(operations.isPhysicalTransactionConfirmed(f.intent.operationId)).toBe(false);
    try { await operations.resolveOwnedRecovery(f.intent.serverId, [f.intent.operationId]); } catch (error) {
      expect(error).toMatchObject({ code: "RECOVERY_REQUIRED" });
    }
    expect(operations.getServerState(f.intent.serverId).recoveryRequired).toBe(true);
    expect((await restarted.scan()).records[0]!.state).toBe(state);
  });
  it.each(["same-id", "wrong-resource", "confirmation", "allow-stop", "running", "version", "extra-target-identity", "workspace",
    "archive-path", "path-escape", "windows-name", "missing-source-revision", "predecessor", "self-predecessor", "missing-payload"])("rejects invalid intent: %s", async problem => {
    const f = await fixture(), input = structuredClone(f.intent), value = input.worldReplacement!;
    switch (problem) {
      case "same-id": Object.assign(value, { worldId: value.previousWorldId }); break;
      case "wrong-resource": Object.assign(input, { resourceId: value.previousWorldId }); break;
      case "confirmation": Object.assign(value, { confirmationName: "other" }); break;
      case "allow-stop": Object.assign(input, { allowStop: true }); break;
      case "running": Object.assign(input, { originalState: "running" }); break;
      case "version": Object.assign(value, { minecraftVersion: "future" }); break;
      case "extra-target-identity": Object.assign(value, { targetDirectoryIdentity: "f".repeat(64) }); break;
      case "workspace": Object.assign(value, { workspaceName: ".manager-foreign" }); break;
      case "archive-path": Object.assign(input.paths[3]!, { relativePath: "other-world" }); break;
      case "path-escape": Object.assign(value, { levelName: "../world", confirmationName: "../world" }); break;
      case "windows-name": Object.assign(value, { levelName: "world?", confirmationName: "world?" }); break;
      case "missing-source-revision": Reflect.deleteProperty(value, "uploadRevision"); break;
      case "predecessor": Object.assign(value, { sequence: 2, predecessorTransactionId: null }); break;
      case "self-predecessor": { const transactionId = randomUUID(); Object.assign(input, { transactionId }); Object.assign(value, { sequence: 2, predecessorTransactionId: transactionId }); break; }
      case "missing-payload": Reflect.deleteProperty(input, "worldReplacement"); break;
    }
    await expect(f.journal.createIntent(input)).rejects.toThrow(); expect((await f.journal.scan()).records).toHaveLength(0);
  });
  it.each(["old-schema", "coerced-state", "coerced-checkpoint"])("retains malformed persisted evidence and gates its instance: %s", async problem => {
    const f = await fixture(), record = await f.journal.createIntent(f.intent);
    const file = path.join(f.root, "transactions", `${f.intent.serverId}.${record.transactionId}.json`);
    const payload = JSON.parse(await readFile(file, "utf8"));
    if (problem === "old-schema") payload.schemaVersion = 11;
    if (problem === "coerced-state") payload.state = ["committed"];
    if (problem === "coerced-checkpoint") payload.checkpoints = [{ sequence: 1, name: ["world-staged"], recordedAt: now }];
    const bytes = JSON.stringify(payload); await writeFile(file, bytes);
    const journal = new TransactionJournalStore(f.root), scan = await journal.initialize();
    expect(scan.records).toHaveLength(0); expect(scan.issues.length).toBeGreaterThan(0);
    const operations = new OperationService(new MemoryOperationStore(), clock, journal); await operations.initialize();
    expect(operations.getServerState(f.intent.serverId).recoveryRequired).toBe(true);
    expect(await readFile(file, "utf8")).toBe(bytes);
  });
  it.each(["queued", "failed", "interrupted", "succeeded"] as const)("retains expired %s request keys across restarts without sending or preflight", async state => {
    const store = new MemoryOperationStore(), key = randomUUID(), body = '{"approved":"original"}', serverId = "replacement-test";
    const saved: StoredOperation = { operation: { id: randomUUID(), serverId, kind: "world-replace", state, step: "test", progress: null,
      createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", result: null, error: null },
      idempotencyKey: key, requestFingerprint: createHash("sha256").update(`${serverId}\nworld-replace\n${body}`).digest("hex"), expiresAt: "2026-10-02T00:00:00Z" };
    await store.save(saved);
    for (let restart = 0; restart < 2; restart++) {
      const service = new OperationService(store, clock); await service.initialize();
      const execute = vi.fn(async () => {}), preflight = vi.fn(async () => {});
      const before = await store.list(), replay = await service.requestBackup(serverId, key, body, execute, preflight, "world-replace");
      expect(replay.id).toBe(saved.operation.id); expect(replay.state).toBe("interrupted");
      expect(service.getServerState(serverId).recoveryRequired).toBe(true);
      expect(execute).not.toHaveBeenCalled(); expect(preflight).not.toHaveBeenCalled();
      await expect(service.requestBackup(serverId, key, "different", execute, preflight, "world-replace"))
        .rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
      expect(await store.list()).toEqual(before);
    }
  });
});
