import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TransactionJournalStore, type CreateTransactionIntent } from "../src/services/transaction-journal.js";
import { allocateWorldIdentity } from "../src/services/world-library-store.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";

const roots: string[] = [];
const now = "2026-10-25T09:00:00.000Z";
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "lt-world-library-journal-")); roots.push(root);
  const operationId = randomUUID(), uploadId = randomUUID(), worldId = allocateWorldIdentity();
  const workspaceName = `.manager-world-library-${operationId}`;
  const intent: CreateTransactionIntent = { operationId, serverId: "test-world-library", kind: "world-library-import",
    scope: "world-set", resourceId: worldId, originalState: "stopped", allowStop: false, createdAt: now,
    paths: [{ role: "source", namespace: "manager", relativePath: `world-imports/${uploadId}/world` },
      { role: "target", namespace: "server", relativePath: "Imported" },
      { role: "staging", namespace: "server", relativePath: workspaceName }],
    worldLibraryImport: { rootIdentity: "a".repeat(64), worldId, targetName: "Imported",
      currentWorldId: allocateWorldIdentity(), currentWorldRevision: "b".repeat(64), libraryRevision: "c".repeat(64),
      propertiesChecksum: "d".repeat(64), uploadId, uploadRevision: "e".repeat(64), importedChecksum: "f".repeat(64),
      minecraftVersion: "26.3", workspaceName } };
  const journal = new TransactionJournalStore(root); await journal.initialize();
  return { root, journal, intent };
}
describe("V2 inactive import durable identity intent", () => {
  it("keeps the preallocated lineage through restart and blocks unfinished instance operations", async () => {
    const f = await fixture(); const saved = await f.journal.createIntent(f.intent);
    expect(saved.schemaVersion).toBe(9);
    const restarted = new TransactionJournalStore(f.root); const scan = await restarted.initialize();
    expect(scan.records[0]?.intent.worldLibraryImport?.worldId).toBe(f.intent.resourceId);
    const operations = new OperationService(new MemoryOperationStore(), { now: () => new Date(now) }, restarted);
    await operations.initialize(); expect(operations.getServerState(f.intent.serverId).recoveryRequired).toBe(true);
  });
  it.each(["worldId", "uploadRevision", "targetName", "workspaceName"] as const)("rejects an invalid %s binding before creating an intent", async key => {
    const f = await fixture(); const payload = { ...f.intent.worldLibraryImport!, [key]: "../invalid" };
    await expect(f.journal.createIntent({ ...f.intent, worldLibraryImport: payload })).rejects.toThrow();
    expect((await f.journal.scan()).records).toHaveLength(0);
  });
  it("rejects wrong path scope and mixed legacy/V2 payloads", async () => {
    const f = await fixture();
    await expect(f.journal.createIntent({ ...f.intent, paths: f.intent.paths.map(p => p.role === "target" ? { ...p, relativePath: "world" } : p) })).rejects.toThrow();
    await expect(f.journal.createIntent({ ...f.intent, kind: "world-import" })).rejects.toThrow();
    expect((await f.journal.scan()).records).toHaveLength(0);
  });
  it.each(["worldId", "currentWorldId", "uploadId", "rootIdentity", "currentWorldRevision", "libraryRevision",
    "propertiesChecksum", "uploadRevision", "importedChecksum"] as const)("rejects string-coercible arrays for %s", async key => {
    const f = await fixture();
    const malformed = { ...f.intent, worldLibraryImport: { ...f.intent.worldLibraryImport!, [key]: [f.intent.worldLibraryImport![key]] } };
    await expect(f.journal.createIntent(malformed as unknown as CreateTransactionIntent)).rejects.toThrow();
    expect((await f.journal.scan()).records).toHaveLength(0);
  });
  it.each(["operationId", "serverId", "transactionId"] as const)("rejects non-string V2 %s ownership", async key => {
    const f = await fixture();
    const malformed = { ...f.intent, [key]: [f.intent[key] ?? randomUUID()] };
    await expect(f.journal.createIntent(malformed as unknown as CreateTransactionIntent)).rejects.toThrow();
    expect((await f.journal.scan()).records).toHaveLength(0);
  });
  it("does not treat a committed V2 record alone as verified installation after restart", async () => {
    const f = await fixture(); const saved = await f.journal.createIntent(f.intent);
    await f.journal.setState(f.intent.serverId, saved.transactionId, "committed", now);
    const restarted = new TransactionJournalStore(f.root);
    const operations = new OperationService(new MemoryOperationStore(), { now: () => new Date(now) }, restarted);
    await operations.initialize(); expect(operations.getServerState(f.intent.serverId).recoveryRequired).toBe(true);
  });
  it("keeps a saved success interrupted until physical V2 installation is independently confirmed", async () => {
    const f = await fixture(); const saved = await f.journal.createIntent(f.intent);
    await f.journal.setState(f.intent.serverId, saved.transactionId, "committed", now);
    const store = new MemoryOperationStore();
    await store.save({ operation: { id: f.intent.operationId, serverId: f.intent.serverId, kind: "world-import",
      state: "succeeded", step: "completed", progress: 100, createdAt: now, updatedAt: now, result: null, error: null },
      idempotencyKey: randomUUID(), requestFingerprint: "isolated-fixture", expiresAt: "2026-10-26T09:00:00.000Z" });
    const operations = new OperationService(store, { now: () => new Date(now) }, new TransactionJournalStore(f.root));
    await operations.initialize();
    expect(operations.getServerState(f.intent.serverId).recoveryRequired).toBe(true);
    expect(operations.get(f.intent.operationId)).toMatchObject({ state: "interrupted", step: "physical-recovery-required" });
  });
  it.each(["state", "checkpoint-name"])("treats persisted array-valued %s as corruption with a recovery gate", async field => {
    const f = await fixture(); const saved = await f.journal.createIntent(f.intent);
    await f.journal.appendCheckpoint(f.intent.serverId, saved.transactionId, { name: "intent-persisted", recordedAt: now });
    await f.journal.setState(f.intent.serverId, saved.transactionId, "committed", now);
    const file = path.join(f.root, "transactions", `${f.intent.serverId}.${saved.transactionId}.json`);
    const raw = JSON.parse(await readFile(file, "utf8"));
    if (field === "state") raw.state = ["committed"]; else raw.checkpoints[0].name = ["intent-persisted"];
    await writeFile(file, JSON.stringify(raw));
    const store = new MemoryOperationStore();
    await store.save({ operation: { id: f.intent.operationId, serverId: f.intent.serverId, kind: "world-import",
      state: "succeeded", step: "completed", progress: 100, createdAt: now, updatedAt: now, result: null, error: null },
      idempotencyKey: randomUUID(), requestFingerprint: "isolated-fixture", expiresAt: "2026-10-26T09:00:00.000Z" });
    const restarted = new TransactionJournalStore(f.root);
    expect((await restarted.initialize()).issues).toContainEqual(expect.objectContaining({ kind: "corrupt-record", serverId: f.intent.serverId }));
    const operations = new OperationService(store, { now: () => new Date(now) }, restarted);
    await operations.initialize(); expect(operations.getServerState(f.intent.serverId).recoveryRequired).toBe(true);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(raw);
  });
});
