import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonOperationStore, worldStopConfirmation, type StoredOperation } from "../src/services/operation-store.js";
import { matchesWorldGenerationSettlement, validWorldGenerationSettlement, type WorldGenerationSettlement } from "../src/services/world-generation-settlement.js";
import { worldLifecycleFingerprint, type WorldLifecycleReceipt } from "../src/services/world-lifecycle-receipt.js";

const sha = "a".repeat(64), roots: string[] = [];
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
function fixture() {
  const startId = randomUUID(), stopId = randomUUID(), key = randomUUID(), launchId = randomUUID();
  const startReceipt: WorldLifecycleReceipt = { schemaVersion: 1, action: "start", serverId: "test", worldId: `worldv2-${randomUUID()}`,
    catalogRevision: sha, worldRevision: sha, rootIdentity: sha, worldDirectoryIdentity: sha, registeredExecutionDigest: sha,
    runNonce: randomUUID(), startOperationId: startId, launchId: null, keyDigest: createHash("sha256").update(key).digest("hex"), requestDigest: "" };
  startReceipt.requestDigest = worldLifecycleFingerprint(startReceipt);
  const record = (id: string, receipt: WorldLifecycleReceipt): StoredOperation => ({
    operation: { id, serverId: "test", kind: receipt.action, state: "running", step: "running", progress: null,
      createdAt: "2026-11-13T00:00:00.000Z", updatedAt: "2026-11-13T00:00:00.000Z", result: null, error: null },
    idempotencyKey: key, requestFingerprint: receipt.requestDigest, expiresAt: "2026-11-14T00:00:00.000Z", worldLifecycle: receipt });
  const start = record(startId, startReceipt);
  const stopReceipt: WorldLifecycleReceipt = { ...startReceipt, action: "stop", launchId, startReceiptDigest: digest(start) };
  stopReceipt.requestDigest = worldLifecycleFingerprint(stopReceipt);
  const stop = record(stopId, stopReceipt);
  const evidence = { start, stop, launch: { schemaVersion: 1 as const, startOperationId: startId, launchId, intentDigest: digest(start) },
    revision: { schemaVersion: 1 as const, stopOperationId: stopId, stopIntentDigest: digest(stop), treeChecksum: sha,
      propertiesChecksum: sha, propertiesIdentity: sha, levelIdentity: sha } };
  const confirmation = worldStopConfirmation(evidence, sha);
  const value: WorldGenerationSettlement = { schemaVersion: 1, phase: "first-managed-generation-settled", serverId: "test",
    worldId: startReceipt.worldId, rootIdentity: sha, worldDirectoryIdentity: sha, registeredExecutionDigest: sha,
    preparationOperationId: randomUUID(), executionOperationId: randomUUID(), startOperationId: startId, stopOperationId: stopId,
    lifecycleDigest: digest(evidence), confirmationDigest: digest(confirmation), journalDigest: sha, catalogId: randomUUID(),
    catalog: { checksum: sha, objectIdentity: sha }, genesis: { checksum: sha, objectIdentity: sha },
    revision: { treeChecksum: sha, propertiesChecksum: sha, propertiesIdentity: sha, levelIdentity: sha } };
  return { evidence, confirmation, value };
}
describe("generation settlement evidence storage", () => {
  it("preserves a write-once record across store reconstruction without modifying raw operations", async () => {
    const f = fixture(), root = await mkdtemp(path.join(tmpdir(), "lt-settlement-")); roots.push(root);
    const store = new JsonOperationStore(root); await store.initialize(); await store.create(f.evidence.start); await store.create(f.evidence.stop);
    await store.createWorldGenerationSettlement(f.value);
    await expect(store.createWorldGenerationSettlement({ ...f.value, worldId: `worldv2-${randomUUID()}` })).rejects.toMatchObject({ code: "EEXIST" });
    const reopened = new JsonOperationStore(root); await reopened.initialize();
    expect(await reopened.readWorldGenerationSettlement(f.value.stopOperationId)).toEqual(f.value);
    expect(await reopened.list()).toEqual(expect.arrayContaining([f.evidence.start, f.evidence.stop]));
    expect(matchesWorldGenerationSettlement(f.value, f.evidence, f.confirmation)).toBe(true);
  });
  it.each(["serverId", "worldId", "lifecycleDigest", "confirmationDigest", "journalDigest"] as const)("rejects changed %s binding", field => {
    const f = fixture();
    const value = { ...f.value, [field]: field === "serverId" ? "other" : field === "worldId" ? `worldv2-${randomUUID()}` : "b".repeat(64) };
    expect(matchesWorldGenerationSettlement(value, f.evidence, f.confirmation)).toBe(false);
  });
  it("rejects legacy confirmation and reused operation identities", () => {
    const f = fixture();
    expect(matchesWorldGenerationSettlement(f.value, f.evidence, worldStopConfirmation(f.evidence))).toBe(false);
    expect(validWorldGenerationSettlement({ ...f.value, executionOperationId: f.value.startOperationId })).toBe(false);
    expect(validWorldGenerationSettlement({ ...f.value, arbitraryPath: "world" })).toBe(false);
  });
  it("rejects truncated or incorrectly named persisted evidence and preserves it", async () => {
    const f = fixture(), root = await mkdtemp(path.join(tmpdir(), "lt-settlement-")); roots.push(root);
    const store = new JsonOperationStore(root); await store.initialize();
    const file = path.join(root, "operations", `${f.value.stopOperationId}.generation-settlement.json`);
    await writeFile(file, "{\"schemaVersion\":");
    await expect(store.readWorldGenerationSettlement(f.value.stopOperationId)).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("{\"schemaVersion\":");
    await writeFile(file, JSON.stringify({ ...f.value, stopOperationId: randomUUID() }));
    await expect(store.readWorldGenerationSettlement(f.value.stopOperationId)).rejects.toThrow();
  });
});
