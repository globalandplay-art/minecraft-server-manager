import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TransactionJournalStore, type CreateTransactionIntent } from "../src/services/transaction-journal.js";
import { proposeWorldGenerationReservation } from "../src/services/world-generation-reservation.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";
import { WorldCreateService } from "../src/services/world-create-service.js";

const roots: string[] = [], now = "2026-10-27T08:00:00.000Z";
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "lt-generation-journal-")); roots.push(root);
  const store = new TransactionJournalStore(root); await store.initialize();
  const generation = proposeWorldGenerationReservation({ serverId: "generation-test", operationId: randomUUID(), transactionId: randomUUID(),
    previousWorldId: `worldv2-${randomUUID()}`, catalogId: randomUUID(), catalogRevision: "1".repeat(64), rootIdentity: "2".repeat(64),
    previousName: "world", nextName: "NewWorld", propertiesBefore: "3".repeat(64), propertiesAfter: "4".repeat(64),
    activeStateRevision: "5".repeat(64), guardBackupId: randomUUID() });
  const intent: CreateTransactionIntent = { operationId: generation.operationId, transactionId: generation.transactionId,
    serverId: generation.serverId, kind: "world-create", scope: "world-set", resourceId: generation.worldId,
    allowStop: false, originalState: "stopped", createdAt: now,
    paths: [{ role: "source", namespace: "server", relativePath: generation.previousName },
      { role: "target", namespace: "server", relativePath: generation.nextName },
      { role: "staging", namespace: "server", relativePath: `.manager-world-create-${generation.operationId}` }],
    worldChange: { generation, previousName: generation.previousName, nextName: generation.nextName,
      rootIdentity: generation.rootIdentity, approvedRevision: "6".repeat(64), propertiesBefore: generation.propertiesBefore,
      propertiesAfter: generation.propertiesAfter, guardBackupId: generation.guardBackupId, workspaceName: `.manager-world-create-${generation.operationId}` } };
  const file = path.join(root, "transactions", `${generation.serverId}.${generation.transactionId}.json`);
  return { root, store, generation, intent, file };
}
describe("unmounted schema14 generation intent persistence", () => {
  it.each(["succeeded", "queued", "running"] as const)("keeps committed generation with %s receipt closed against generic confirmation", async state => {
    const f = await fixture(), record = await f.store.createIntent(f.intent);
    await f.store.setState(f.generation.serverId, record.transactionId, "committed", now);
    const receipts = new MemoryOperationStore();
    await receipts.save({ idempotencyKey: randomUUID(), requestFingerprint: "6".repeat(64), expiresAt: "2026-10-28T08:00:00.000Z",
      operation: { id: f.generation.operationId, serverId: f.generation.serverId, kind: "world-create", state,
        step: "committed", progress: 100, createdAt: now, updatedAt: now, error: null,
        result: { resourceId: f.generation.worldId, rollbackAvailable: false } } });
    const ops = new OperationService(receipts, { now: () => new Date(now) }, f.store);
    ops.confirmPhysicalTransaction(f.generation.operationId); // A prior generic mark must be revoked.
    await ops.initialize();
    expect(ops.get(f.generation.operationId)?.state).toBe("interrupted");
    expect(ops.getServerState(f.generation.serverId).recoveryRequired).toBe(true);
    expect(() => ops.confirmPhysicalTransaction(f.generation.operationId)).toThrow();
    await expect(ops.resolveOwnedRecovery(f.generation.serverId, [f.generation.operationId])).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    // The legacy reconciler must reject schema14 before touching adapters/state.
    let touches = 0;
    const untouched = new Proxy({}, { get: () => { touches += 1; throw new Error("LEGACY_DEPENDENCY_MUST_NOT_BE_USED"); } });
    const legacy = new WorldCreateService(untouched as never, ops, f.store, untouched as never, f.root, untouched as never, { now: () => new Date(now) });
    await legacy.reconcileStartup();
    expect(touches).toBe(0);
    expect(ops.getServerState(f.generation.serverId).recoveryRequired).toBe(true);
    expect(ops.get(f.generation.operationId)?.state).toBe("interrupted");
    expect((await f.store.get(f.generation.serverId, record.transactionId)).intent.worldChange?.generation).toEqual(f.generation);
  });
  it("persists and reloads the exact UUID without generation or catalog publication", async () => {
    const f = await fixture(), record = await f.store.createIntent(f.intent);
    expect(record.schemaVersion).toBe(14); expect(record.state).toBe("active"); expect(record.checkpoints).toEqual([]);
    const raw = await readFile(f.file, "utf8");
    expect(JSON.parse(raw).intent.worldChange.generation).toEqual(f.generation);
    const restarted = new TransactionJournalStore(f.root), scan = await restarted.initialize();
    expect(scan.issues).toEqual([]); expect(scan.recoveryServerIds.has(f.generation.serverId)).toBe(true);
    expect(scan.records[0]?.intent.worldChange?.generation).toEqual(f.generation);
    await expect(restarted.createIntent(f.intent)).rejects.toThrow("already exists");
    expect(await readFile(f.file, "utf8")).toBe(raw);
  });
  it.each(["serverId", "operationId", "transactionId", "resourceId"])("rejects outer %s mismatch before writing", async field => {
    const f = await fixture();
    const changed = { ...f.intent, [field]: field === "serverId" ? "other" : field === "resourceId" ? `worldv2-${randomUUID()}` : randomUUID() };
    await expect(f.store.createIntent(changed)).rejects.toThrow("Invalid transaction journal intent");
    expect((await f.store.scan()).records).toEqual([]);
  });
  it.each(["rootIdentity", "previousName", "nextName", "guardBackupId", "propertiesBefore", "propertiesAfter", "workspaceName"])("rejects worldChange %s mismatch", async field => {
    const f = await fixture(), change = { ...f.intent.worldChange!, [field]: field.includes("Name") ? "Other" : "0".repeat(64) };
    await expect(f.store.createIntent({ ...f.intent, worldChange: change })).rejects.toThrow("Invalid transaction journal intent");
    expect((await f.store.scan()).records).toEqual([]);
  });
  it.each([3, 15])("refuses stored reservation under schema %s without rewriting evidence", async schemaVersion => {
    const f = await fixture(), record = await f.store.createIntent(f.intent);
    const raw = JSON.stringify({ ...record, schemaVersion }); await writeFile(f.file, raw);
    const scan = await new TransactionJournalStore(f.root).initialize();
    expect(scan.records).toEqual([]); expect(scan.recoveryServerIds.has(f.generation.serverId)).toBe(true);
    expect(scan.issues.length).toBeGreaterThan(0); expect(await readFile(f.file, "utf8")).toBe(raw);
  });
  it.each(["target", "namespace", "extra"])("rejects %s path mismatch", async scenario => {
    const f = await fixture(), paths = f.intent.paths.map(item => ({ ...item }));
    if (scenario === "target") paths[1]!.relativePath = "Other";
    else if (scenario === "namespace") paths[1]!.namespace = "manager";
    else paths.push({ ...paths[0]! });
    await expect(f.store.createIntent({ ...f.intent, paths })).rejects.toThrow("Invalid transaction journal intent");
    expect((await f.store.scan()).records).toEqual([]);
  });
  it("preserves the legacy schema3 format when no reservation was supplied", async () => {
    const f = await fixture(), change = { ...f.intent.worldChange! }; delete change.generation;
    const record = await f.store.createIntent({ ...f.intent, resourceId: "world-" + "0".repeat(24), worldChange: change });
    expect(record.schemaVersion).toBe(3); expect(record.intent.worldChange).not.toHaveProperty("generation");
    expect((await new TransactionJournalStore(f.root).initialize()).records).toEqual([record]);
  });
});
