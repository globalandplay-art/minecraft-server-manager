import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TransactionJournalStore, type CreateTransactionIntent } from "../src/services/transaction-journal.js";
import { allocateWorldIdentity } from "../src/services/world-library-store.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";

const roots: string[] = [], now = "2026-10-26T00:00:00.000Z";
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "lt-world-activate-")); roots.push(root);
  const operationId = randomUUID(), worldId = allocateWorldIdentity(), guardBackupId = randomUUID();
  const workspaceName = `.manager-world-activate-${operationId}`;
  const intent: CreateTransactionIntent = { operationId, serverId: "test-activation", kind: "world-activate", scope: "world-set",
    resourceId: worldId, allowStop: false, originalState: "stopped", createdAt: now,
    paths: [{ role: "source", namespace: "server", relativePath: "world" }, { role: "target", namespace: "server", relativePath: "Imported" },
      { role: "staging", namespace: "server", relativePath: workspaceName }, { role: "rollback", namespace: "manager", relativePath: `backups/test-activation/${guardBackupId}` }],
    worldActivation: { rootIdentity: "a".repeat(64), catalogId: randomUUID(), worldId, previousWorldId: allocateWorldIdentity(),
      previousName: "world", nextName: "Imported", libraryRevision: "b".repeat(64), currentWorldRevision: "c".repeat(64), targetWorldRevision: "d".repeat(64),
      currentContentChecksum: "e".repeat(64), targetContentChecksum: "f".repeat(64), currentDirectoryIdentity: "1".repeat(64), targetDirectoryIdentity: "2".repeat(64),
      sourceImportTransactionId: randomUUID(), sourceImportChecksum: "3".repeat(64), predecessorTransactionId: null, sequence: 1, guardBackupId,
      propertiesBefore: "4".repeat(64), propertiesAfter: "5".repeat(64), workspaceName } };
  const journal = new TransactionJournalStore(root); await journal.initialize();
  return { root, journal, intent };
}
describe("activation schema10 evidence (no executor exposed)", () => {
  it("persists schema11 guard provenance without forging an import and remains recovery gated", async () => {
    const f = await fixture();
    const intent = { ...f.intent, worldActivation: { ...f.intent.worldActivation!, sequence: 2, predecessorTransactionId: randomUUID(),
      sourceImportTransactionId: null, sourceImportChecksum: null,
      sourceGuard: { transactionId: randomUUID(), guardBackupId: randomUUID(), checksum: f.intent.worldActivation!.targetContentChecksum } } };
    const record = await f.journal.createIntent(intent);
    expect(record.schemaVersion).toBe(11);
    await f.journal.setState(intent.serverId, record.transactionId, "committed", now);
    const restarted = new TransactionJournalStore(f.root);
    expect((await restarted.initialize()).records[0]?.intent.worldActivation).toEqual(intent.worldActivation);
    const operations = new OperationService(new MemoryOperationStore(), { now: () => new Date(now) }, restarted);
    await operations.initialize();
    expect(operations.getServerState(intent.serverId).recoveryRequired).toBe(true);
  });
  it.each(["dual-source", "wrong-checksum", "first-transition", "same-guard", "self-source", "extra-field", "array-id"])("rejects invalid guard provenance: %s", async problem => {
    const f = await fixture(), transactionId = randomUUID();
    const activation = { ...f.intent.worldActivation!, sequence: 2, predecessorTransactionId: randomUUID() as string | null,
      sourceImportTransactionId: null as string | null, sourceImportChecksum: null as string | null,
      sourceGuard: { transactionId: randomUUID(), guardBackupId: randomUUID(), checksum: f.intent.worldActivation!.targetContentChecksum } };
    switch (problem) {
      case "dual-source": activation.sourceImportTransactionId = randomUUID(); activation.sourceImportChecksum = "a".repeat(64); break;
      case "wrong-checksum": activation.sourceGuard.checksum = "0".repeat(64); break;
      case "first-transition": activation.sequence = 1; activation.predecessorTransactionId = null; break;
      case "same-guard": activation.sourceGuard.guardBackupId = activation.guardBackupId; break;
      case "self-source": activation.sourceGuard.transactionId = transactionId; break;
      case "extra-field": Object.assign(activation.sourceGuard, { path: "untrusted" }); break;
      case "array-id": Object.assign(activation.sourceGuard, { transactionId: [randomUUID()] }); break;
    }
    await expect(f.journal.createIntent({ ...f.intent, transactionId, worldActivation: activation })).rejects.toThrow();
    expect((await f.journal.scan()).records).toHaveLength(0);
  });
  it("persists exact first activation bindings and keeps unverified committed evidence gated", async () => {
    const f = await fixture(), record = await f.journal.createIntent(f.intent);
    expect(record.schemaVersion).toBe(10);
    await f.journal.setState(f.intent.serverId, record.transactionId, "committed", now);
    const restarted = new TransactionJournalStore(f.root); expect((await restarted.initialize()).records[0]?.intent.worldActivation).toEqual(f.intent.worldActivation);
    const operations = new OperationService(new MemoryOperationStore(), { now: () => new Date(now) }, restarted);
    await operations.initialize(); expect(operations.getServerState(f.intent.serverId).recoveryRequired).toBe(true);
  });
  it.each(["worldId", "catalogId", "rootIdentity", "previousWorldId", "targetContentChecksum", "sourceImportTransactionId", "propertiesBefore", "guardBackupId"] as const)("rejects array-coercible %s without writing intent", async key => {
    const f = await fixture();
    const malformed = { ...f.intent, worldActivation: { ...f.intent.worldActivation!, [key]: [f.intent.worldActivation![key]] } };
    await expect(f.journal.createIntent(malformed as unknown as CreateTransactionIntent)).rejects.toThrow();
    expect((await f.journal.scan()).records).toHaveLength(0);
  });
  it("rejects path mismatch, equal identities, implicit stop and chain discontinuity fields", async () => {
    const f = await fixture();
    const invalid = [
      { ...f.intent, allowStop: true },
      { ...f.intent, paths: f.intent.paths.slice(0, 3) },
      { ...f.intent, worldActivation: { ...f.intent.worldActivation!, previousWorldId: f.intent.resourceId! } },
      { ...f.intent, worldActivation: { ...f.intent.worldActivation!, sequence: 2 } },
      { ...f.intent, worldActivation: { ...f.intent.worldActivation!, sequence: 1, predecessorTransactionId: randomUUID() } },
      { ...f.intent, worldActivation: { ...f.intent.worldActivation!, previousName: "../world" } }
    ];
    for (const intent of invalid) await expect(f.journal.createIntent(intent)).rejects.toThrow();
    expect((await f.journal.scan()).records).toHaveLength(0);
  });
  it("preserves corrupt persisted checkpoint/state evidence instead of coercing it", async () => {
    const f = await fixture(), record = await f.journal.createIntent(f.intent);
    const file = path.join(f.root, "transactions", `${f.intent.serverId}.${record.transactionId}.json`);
    const payload = JSON.parse(await readFile(file, "utf8")); payload.state = ["committed"];
    const bytes = JSON.stringify(payload); await writeFile(file, bytes);
    const scan = await new TransactionJournalStore(f.root).initialize();
    expect(scan.records).toHaveLength(0); expect(scan.issues.length).toBeGreaterThan(0);
    expect(await readFile(file, "utf8")).toBe(bytes);
  });
  it.each([false, true])("rejects a self-referencing transaction predecessor, uppercase=%s", async uppercase => {
    const f = await fixture(), transactionId = randomUUID();
    const malformed = { ...f.intent, transactionId, worldActivation: { ...f.intent.worldActivation!, sequence: 2,
      predecessorTransactionId: uppercase ? transactionId.toUpperCase() : transactionId } };
    await expect(f.journal.createIntent(malformed)).rejects.toThrow();
    expect((await f.journal.scan()).records).toHaveLength(0);
  });
  it("keeps a saved success unknown even when its activation journal is missing", async () => {
    const f = await fixture(), record = await f.journal.createIntent(f.intent);
    await f.journal.setState(f.intent.serverId, record.transactionId, "committed", now);
    const store = new MemoryOperationStore();
    await store.save({ operation: { id: f.intent.operationId, serverId: f.intent.serverId, kind: "world-activate", state: "succeeded", step: "completed",
      progress: 100, createdAt: now, updatedAt: now, result: null, error: null }, idempotencyKey: randomUUID(), requestFingerprint: "a".repeat(64),
      expiresAt: "2027-01-01T00:00:00.000Z" });
    await rename(path.join(f.root, "transactions", `${f.intent.serverId}.${record.transactionId}.json`), path.join(f.root, "preserved-journal.json"));
    const operations = new OperationService(store, { now: () => new Date(now) }, new TransactionJournalStore(f.root));
    await operations.initialize();
    expect(operations.get(f.intent.operationId)?.state).toBe("interrupted");
    expect(operations.getServerState(f.intent.serverId).recoveryRequired).toBe(true);
  });
});
