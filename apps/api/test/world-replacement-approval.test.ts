import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { worldIdentity } from "../src/services/active-world-state-store.js";
import { backupDirectoryIdentity, directoryObjectIdentity } from "../src/services/backup-identity.js";
import { readPrivatePropertiesFile } from "../src/services/properties-private-file.js";
import { verifyReplacementApprovalFiles } from "../src/services/world-replacement-approval.js";
import type { TransactionJournalRecord } from "../src/services/transaction-journal.js";

const roots: string[] = [], hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "lt-approval-files-")); roots.push(root);
  const operationId = randomUUID(), workspaceName = `.manager-world-replace-${operationId}`, workspace = path.join(root, workspaceName);
  await mkdir(workspace);
  const state = { schemaVersion: 1, serverId: "test", state: "active", worldId: worldIdentity("test", "world"), levelName: "world" };
  const properties = "# unchanged\nlevel-name=world\nmotd=Keep\n", active = JSON.stringify(state);
  // Catalog semantic acceptance is deliberately NOT part of this byte-only proof.
  const catalog = JSON.stringify({ fixture: "digest only; not a valid catalog" });
  await writeFile(path.join(root, "server.properties"), properties);
  const original = await readPrivatePropertiesFile(path.join(root, "server.properties")); original.bytes.fill(0);
  const value = { rootIdentity: await backupDirectoryIdentity(root), workspaceName, worldId: `worldv2-${randomUUID()}`, levelName: "world",
    propertiesChecksum: hash(properties), propertiesRevision: hash(`${original.identity}\0${hash(properties)}`), libraryRevision: hash(catalog),
    approval: { schemaVersion: 1, propertiesIdentity: original.identity, activeStateIdentity: "a".repeat(64), activeStateChecksum: hash(active), catalogFileIdentity: "b".repeat(64) } };
  const record = { schemaVersion: 13, state: "active", intent: { operationId, serverId: "test", kind: "world-replace", worldReplacement: value },
    checkpoints: [{ name: "replacement-workspace-created", details: { resourceId: value.worldId, filesystemIdentity: await directoryObjectIdentity(workspace) } }] } as unknown as TransactionJournalRecord;
  for (const [file, step, text] of [["properties.before", "replacement-properties-before-verified", properties],
    ["catalog.before", "replacement-catalog-before-verified", catalog], ["active.before", "replacement-active-before-verified", active]]) {
    await writeFile(path.join(workspace, file!), text!);
    const copy = await readPrivatePropertiesFile(path.join(workspace, file!)); copy.bytes.fill(0);
    record.checkpoints.push({ sequence: record.checkpoints.length + 1, name: step!, recordedAt: "2026-10-27T00:00:00Z",
      details: { resourceId: value.worldId, checksumSha256: copy.checksum, filesystemIdentity: copy.identity } });
  }
  return { root, workspace, record, state };
}
describe("replacement snapshot-file proof only, not catalog/physical/recovery authority", () => {
  it("binds snapshots independently from original properties identity and returns no private bytes", async () => {
    const f = await fixture(), original = await readFile(path.join(f.root, "server.properties"));
    const proof = await verifyReplacementApprovalFiles(f.record, f.root);
    expect(Object.keys(proof).sort()).toEqual(["recheck", "recordDigest"]);
    expect(proof.recordDigest).toBe(hash(JSON.stringify(f.record))); await proof.recheck();
    expect(await readFile(path.join(f.root, "server.properties"))).toEqual(original);
  });
  it.each(["old-schema", "original-identity", "missing-marker", "duplicate-marker", "copy-bytes", "same-bytes-new-object", "wrong-slot", "unknown-state-key", "duplicate-state-key", "active-archive-id"])("rejects %s", async problem => {
    const f = await fixture(), value = f.record.intent.worldReplacement!;
    if (problem === "old-schema") Object.assign(f.record, { schemaVersion: 12 });
    if (problem === "original-identity") Object.assign(value.approval!, { propertiesIdentity: "0".repeat(64) });
    if (problem === "missing-marker") f.record.checkpoints.pop();
    if (problem === "duplicate-marker") f.record.checkpoints.push(structuredClone(f.record.checkpoints[1]!));
    const file = path.join(f.workspace, "active.before");
    if (problem === "copy-bytes") await writeFile(file, "changed");
    if (problem === "same-bytes-new-object") { const bytes = await readFile(file); await rename(file, file + ".retained"); await writeFile(file, bytes); }
    if (["wrong-slot", "unknown-state-key", "duplicate-state-key", "active-archive-id"].includes(problem)) {
      const state = problem === "wrong-slot" ? { ...f.state, serverId: "other" } : problem === "active-archive-id" ?
        { ...f.state, archiveTransactionId: randomUUID() } : { ...f.state, unexpected: true };
      const bytes = problem === "duplicate-state-key" ? '{"schemaVersion":0,' + JSON.stringify(f.state).slice(1) : JSON.stringify(state);
      await writeFile(file, bytes);
      const fresh = await readPrivatePropertiesFile(file); fresh.bytes.fill(0);
      Object.assign(value.approval!, { activeStateChecksum: hash(bytes) });
      Object.assign(f.record.checkpoints.at(-1)!.details!, { checksumSha256: fresh.checksum, filesystemIdentity: fresh.identity });
    }
    await expect(verifyReplacementApprovalFiles(f.record, f.root)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED", reason: "world-replacement-approval-unverified" });
  });
  it("rechecks retained copies and sanitizes cancellation", async () => {
    const f = await fixture(); let cancelled = false;
    const proof = await verifyReplacementApprovalFiles(f.record, f.root, () => { if (cancelled) throw new Error(f.root); });
    cancelled = true; await expect(proof.recheck()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    cancelled = false; await writeFile(path.join(f.workspace, "catalog.before"), "changed");
    await expect(proof.recheck()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
});
