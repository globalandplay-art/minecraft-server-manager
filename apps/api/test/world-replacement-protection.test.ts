import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { BackupService, type BackupManifest } from "../src/services/backup-service.js";
import { backupDirectoryIdentity, directoryObjectIdentity } from "../src/services/backup-identity.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";
import { readPrivatePropertiesFile } from "../src/services/properties-private-file.js";
import { inventoryRestoreTree, restoreFilesChecksum } from "../src/services/restore-files.js";
import { TransactionJournalStore, type TransactionJournalRecord } from "../src/services/transaction-journal.js";
import { replacementCheckpoints } from "../src/services/world-transition-records.js";
import { replacementExecutionCheckpoints } from "../src/services/world-transition-records.js";
import { verifyReplacementProtection } from "../src/services/world-replacement-protection.js";
import { verifyReplacementInstalledFiles } from "../src/services/world-replacement-installed.js";
import { worldIdentity } from "../src/services/active-world-state-store.js";
import { testWorldLevel } from "./fixtures/world-library-content.js";
import { WorldLibraryStore } from "../src/services/world-library-store.js";
import { verifyReplacementJournalAndInstalledFiles } from "../src/services/world-replacement-journal-proof.js";
import { activationProtectionSteps } from "../src/services/world-activation-protection.js";

const roots: string[] = [], now = "2026-10-27T00:00:00.000Z";
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const parent = await mkdtemp(path.join(tmpdir(), "lt-replacement-protection-")); roots.push(parent);
  const root = path.join(parent, "server"), manager = path.join(parent, "manager"), operationId = randomUUID(), guardId = randomUUID();
  const workspaceName = `.manager-world-replace-${operationId}`, workspace = path.join(root, workspaceName), preserved = path.join(workspace, "previous-world");
  const guardPath = path.join(manager, "backups", "test", guardId), payload = path.join(guardPath, "payload", "world");
  await mkdir(path.join(root, "world"), { recursive: true }); await mkdir(workspace); await mkdir(path.dirname(payload), { recursive: true });
  await writeFile(path.join(root, "world", "level.dat"), "isolated-world-content");
  const properties = "# unchanged unrelated setting\nlevel-name=world\nmotd=Test\n";
  await writeFile(path.join(workspace, "properties.before"), properties);
  const directoryBefore = await backupDirectoryIdentity(path.join(root, "world")), objectBefore = await directoryObjectIdentity(path.join(root, "world"));
  const files = await inventoryRestoreTree(path.join(root, "world"));
  await cp(path.join(root, "world"), payload, { recursive: true }); await rename(path.join(root, "world"), preserved);
  const prefixed = files.map(file => ({ ...file, path: `world/${file.path}` }));
  const manifest: BackupManifest = { schemaVersion: 1, id: guardId, serverId: "test", scope: "world-set", kind: "manual", label: null,
    state: "complete", pinned: true, createdAt: now, minecraftVersion: "26.3", serverType: "vanilla", includedRoots: ["world"],
    fileCount: files.length, sizeBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0), checksumSha256: restoreFilesChecksum(prefixed),
    wasRunning: false, restarted: false, downtimeMs: null, files: prefixed };
  const manifestPath = path.join(guardPath, "manifest.json"); await writeFile(manifestPath, JSON.stringify(manifest));
  const manifestFile = await readPrivatePropertiesFile(manifestPath, 64 * 1024 ** 2); manifestFile.bytes.fill(0);
  const worldId = `worldv2-${randomUUID()}`;
  const value = { rootIdentity: await backupDirectoryIdentity(root), catalogId: randomUUID(), worldId, previousWorldId: `worldv2-${randomUUID()}`,
    levelName: "world", confirmationName: "world", libraryRevision: "1".repeat(64), currentWorldRevision: "2".repeat(64),
    currentContentChecksum: restoreFilesChecksum(files), currentDirectoryIdentity: directoryBefore, currentObjectIdentity: objectBefore,
    propertiesRevision: "3".repeat(64), propertiesChecksum: createHash("sha256").update(properties).digest("hex"), uploadId: randomUUID(), uploadRevision: "5".repeat(64),
    importedChecksum: "6".repeat(64), minecraftVersion: "26.3" as const, guardBackupId: guardId, sequence: 1, predecessorTransactionId: null, workspaceName };
  const record: TransactionJournalRecord = { schemaVersion: 12, transactionId: randomUUID(), state: "committed", updatedAt: now,
    intent: { operationId, serverId: "test", kind: "world-replace", scope: "world-set", resourceId: worldId, allowStop: false,
      originalState: "stopped", createdAt: now, paths: [], worldReplacement: value },
    checkpoints: replacementCheckpoints.map((name, index) => ({ name, sequence: index + 1, recordedAt: now, details: { resourceId: worldId,
      ...([1, 5, 9, 10].includes(index) ? { checksumSha256: value.importedChecksum } : index === 7 ? { checksumSha256: value.currentContentChecksum } :
        index === 2 ? { checksumSha256: manifest.checksumSha256 } : index === 3 ? { checksumSha256: manifestFile.checksum } : {}),
      ...([5, 9].includes(index) ? { filesystemIdentity: "7".repeat(64) } : index === 7 ? { filesystemIdentity: objectBefore } :
        index === 10 ? { filesystemIdentity: "8".repeat(64) } : {}) } })) };
  Object.assign(record.checkpoints[2]!.details!, { filesystemIdentity: await backupDirectoryIdentity(guardPath) });
  Object.assign(record.checkpoints[3]!.details!, { filesystemIdentity: manifestFile.identity });
  Object.assign(record.checkpoints[4]!.details!, { filesystemIdentity: await directoryObjectIdentity(workspace) });
  const adapter = { mode: "local", serverId: "test", plan: { rootPath: root, serverInfo: { type: "vanilla", minecraftVersion: "26.3" } } } as unknown as LocalMinecraftServerAdapter;
  const journal = new TransactionJournalStore(manager); await journal.initialize();
  const operations = new OperationService(new MemoryOperationStore(), { now: () => new Date(now) }, journal); await operations.initialize();
  const backups = new BackupService(new AdapterRegistry([adapter]), operations, journal, manager, { now: () => new Date(now) });
  return { root, manager, workspace, preserved, payload, guardPath, manifestPath, manifest, record, adapter, backups, operations, journal };
}

async function installedFixture() {
  const f = await fixture(), value = f.record.intent.worldReplacement!, old = f.record;
  const target = path.join(f.root, "world"), source = path.join(f.manager, "world-imports", value.uploadId);
  await mkdir(target); await writeFile(path.join(target, "level.dat"), testWorldLevel("new-world", true, 5023));
  await mkdir(source, { recursive: true }); await cp(target, path.join(source, "world"), { recursive: true });
  const files = await inventoryRestoreTree(target), checksum = restoreFilesChecksum(files), createdAt = "2026-10-27T00:00:00.000Z";
  const properties = await readFile(path.join(f.workspace, "properties.before")); await writeFile(path.join(f.root, "server.properties"), properties);
  const state = { schemaVersion: 1, serverId: "test", state: "active", worldId: worldIdentity("test", "world"), levelName: "world" };
  await mkdir(path.join(f.manager, "active-worlds"));
  const activePath = path.join(f.manager, "active-worlds", "test.json"); await writeFile(activePath, JSON.stringify(state));
  const catalog = { schemaVersion: 1, serverId: "test", catalogId: value.catalogId, rootIdentity: value.rootIdentity, entries: [
    { worldId: value.previousWorldId, levelName: "world", state: "present", origin: "legacy-observation", createdAt,
      legacySlotId: state.worldId, legacyBackupAssociation: "unverified", directoryIdentity: value.currentDirectoryIdentity,
      operationId: null, replacesWorldId: null, admissionRevision: null } ] };
  const catalogPath = path.join(f.manager, "world-library", "test", "state.json"); await mkdir(path.dirname(catalogPath), { recursive: true });
  await writeFile(catalogPath, JSON.stringify(catalog) + "\n");
  const p = await readPrivatePropertiesFile(path.join(f.root, "server.properties")), a = await readPrivatePropertiesFile(activePath), c = await readPrivatePropertiesFile(catalogPath);
  p.bytes.fill(0); a.bytes.fill(0); c.bytes.fill(0);
  Object.assign(value, { importedChecksum: checksum, libraryRevision: c.checksum,
    propertiesRevision: createHash("sha256").update(`${p.identity}\0${p.checksum}`).digest("hex"), approval: { schemaVersion: 1,
      propertiesIdentity: p.identity, activeStateIdentity: a.identity, activeStateChecksum: a.checksum, catalogFileIdentity: c.identity } });
  await writeFile(path.join(f.workspace, "catalog.before"), await readFile(catalogPath));
  await writeFile(path.join(f.workspace, "active.before"), await readFile(activePath));
  const record: TransactionJournalRecord = { ...old, schemaVersion: 13, checkpoints: [] };
  const targetObject = await directoryObjectIdentity(target), targetDirectory = await backupDirectoryIdentity(target);
  for (const [index, name] of replacementExecutionCheckpoints.entries()) {
    const oldDetails = old.checkpoints.find(point => point.name === name)?.details;
    const details = { ...(oldDetails ?? {}), resourceId: value.worldId };
    if (["replacement-upload-claimed", "replacement-world-staged", "replacement-world-installed", "replacement-identity-installed"].includes(name)) details.checksumSha256 = checksum;
    if (["replacement-world-staged", "replacement-world-installed"].includes(name)) details.filesystemIdentity = targetObject;
    if (name === "replacement-identity-installed") details.filesystemIdentity = targetDirectory;
    for (const [file, step] of [["properties.before", "replacement-properties-before-verified"], ["catalog.before", "replacement-catalog-before-verified"], ["active.before", "replacement-active-before-verified"]]) {
      if (name !== step) continue;
      const copy = await readPrivatePropertiesFile(path.join(f.workspace, file!)); copy.bytes.fill(0);
      details.checksumSha256 = copy.checksum; details.filesystemIdentity = copy.identity;
    }
    record.checkpoints.push({ name, sequence: index + 1, recordedAt: createdAt, details });
  }
  const claimPath = path.join(source, "consumed.json"); await writeFile(claimPath, JSON.stringify({ schemaVersion: 1, serverId: "test", uploadId: value.uploadId, operationId: record.intent.operationId }));
  const durable = await f.journal.createIntent({ ...record.intent, paths: [
    { role: "source", namespace: "server", relativePath: value.levelName }, { role: "target", namespace: "server", relativePath: value.levelName },
    { role: "staging", namespace: "server", relativePath: value.workspaceName }, { role: "archive", namespace: "server", relativePath: `${value.workspaceName}/previous-world` },
    { role: "rollback", namespace: "manager", relativePath: `backups/test/${value.guardBackupId}` } ] });
  for (const point of record.checkpoints) await f.journal.appendCheckpoint("test", durable.transactionId, { name: point.name, recordedAt: point.recordedAt, details: point.details });
  const committed = await f.journal.setState("test", durable.transactionId, "committed", createdAt);
  Object.assign(f.adapter, { getStatus: async () => ({ state: "stopped", ownership: "none", recoveryRequired: false }) });
  const uploads = { validatedSource: async (serverId: string, uploadId: string, revision?: string, operationId?: string) => {
    expect([serverId, uploadId, revision, operationId]).toEqual(["test", value.uploadId, value.uploadRevision, record.intent.operationId]);
    return { directory: source, files, revision: value.uploadRevision, checksumSha256: checksum, minecraftVersion: "26.3", sizeBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0) };
  } };
  return { ...f, record: committed, uploads, target, source, activePath, claimPath, catalogPath };
}

async function publicationFixture() {
  const f = await installedFixture(), value = f.record.intent.worldReplacement!, catalog = JSON.parse(await readFile(f.catalogPath, "utf8"));
  const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  await writeFile(path.join(path.dirname(path.dirname(f.catalogPath)), "test.identity.json"), JSON.stringify({ schemaVersion: 1,
    serverId: "test", catalogId: value.catalogId, rootIdentity: value.rootIdentity }));
  const pending = { ...catalog, schemaVersion: 3, transitionHead: { sequence: 1, transactionId: f.record.transactionId,
    intentDigest: digest(f.record.intent), previousDigest: digest([]), state: "pending", recordDigest: null } };
  await writeFile(f.catalogPath, JSON.stringify(pending) + "\n");
  const revision = createHash("sha256").update(await readFile(f.catalogPath)).digest("hex");
  const library = new WorldLibraryStore(f.manager, { now: () => new Date("2026-10-27T00:00:00Z") });
  await f.operations.initialize();
  const proof = await verifyReplacementInstalledFiles(f.record, [], f.adapter, f.manager, f.backups, f.uploads);
  return { ...f, library, revision, proof, binding: { serverId: "test", rootPath: f.root } };
}

async function replacementAfterReplacement() {
  const f = await publicationFixture();
  await f.library.completeReplacement(f.binding, f.revision, [f.record], f.proof);
  const prefix = [structuredClone(f.record)], value = structuredClone(f.record.intent.worldReplacement!);
  const operationId = randomUUID(), worldId = `worldv2-${randomUUID()}`, guardId = randomUUID(), uploadId = randomUUID();
  const workspaceName = `.manager-world-replace-${operationId}`, workspace = path.join(f.root, workspaceName);
  const guardPath = path.join(f.manager, "backups", "test", guardId), payload = path.join(guardPath, "payload", "world");
  const currentDirectoryIdentity = await backupDirectoryIdentity(f.target), currentObjectIdentity = await directoryObjectIdentity(f.target);
  const oldFiles = await inventoryRestoreTree(f.target);
  await mkdir(workspace); await mkdir(path.dirname(payload), { recursive: true }); await cp(f.target, payload, { recursive: true });
  const manifest = { ...f.manifest, id: guardId, files: oldFiles.map(file => ({ ...file, path: `world/${file.path}` })),
    fileCount: oldFiles.length, sizeBytes: oldFiles.reduce((n, file) => n + file.sizeBytes, 0) };
  manifest.checksumSha256 = restoreFilesChecksum(manifest.files);
  const manifestPath = path.join(guardPath, "manifest.json"); await writeFile(manifestPath, JSON.stringify(manifest));
  for (const [from, to] of [[path.join(f.root, "server.properties"), "properties.before"], [f.activePath, "active.before"], [f.catalogPath, "catalog.before"]]) {
    await cp(from!, path.join(workspace, to!));
  }
  const catalog = await readPrivatePropertiesFile(f.catalogPath); catalog.bytes.fill(0);
  Object.assign(value, { worldId, previousWorldId: prefix[0]!.intent.worldReplacement!.worldId, guardBackupId: guardId, uploadId,
    workspaceName, currentDirectoryIdentity, currentObjectIdentity, currentContentChecksum: restoreFilesChecksum(oldFiles),
    libraryRevision: catalog.checksum, sequence: 2, predecessorTransactionId: prefix[0]!.transactionId,
    approval: { ...value.approval!, catalogFileIdentity: catalog.identity } });
  const preserved = path.join(workspace, "previous-world"); await rename(f.target, preserved); await mkdir(f.target);
  await writeFile(path.join(f.target, "level.dat"), testWorldLevel("second-replacement", true, 5023));
  const files = await inventoryRestoreTree(f.target), checksum = restoreFilesChecksum(files);
  Object.assign(value, { importedChecksum: checksum });
  const source = path.join(f.manager, "world-imports", uploadId); await mkdir(source); await cp(f.target, path.join(source, "world"), { recursive: true });
  const claimPath = path.join(source, "consumed.json"); await writeFile(claimPath, JSON.stringify({ schemaVersion: 1, serverId: "test", uploadId, operationId }));
  const record = await f.journal.createIntent({ ...f.record.intent, operationId, resourceId: worldId, worldReplacement: value, paths: [
    { role: "source", namespace: "server", relativePath: "world" }, { role: "target", namespace: "server", relativePath: "world" },
    { role: "staging", namespace: "server", relativePath: workspaceName }, { role: "archive", namespace: "server", relativePath: `${workspaceName}/previous-world` },
    { role: "rollback", namespace: "manager", relativePath: `backups/test/${guardId}` } ] });
  const mf = await readPrivatePropertiesFile(manifestPath); mf.bytes.fill(0);
  const installedObject = await directoryObjectIdentity(f.target), installedDirectory = await backupDirectoryIdentity(f.target);
  for (const name of replacementExecutionCheckpoints) {
    const details: { resourceId: string; checksumSha256?: string; filesystemIdentity?: string } = { resourceId: worldId };
    const copy = ({ "replacement-properties-before-verified": "properties.before", "replacement-catalog-before-verified": "catalog.before",
      "replacement-active-before-verified": "active.before" } as Record<string, string>)[name];
    if (copy) { const file = await readPrivatePropertiesFile(path.join(workspace, copy)); file.bytes.fill(0); details.checksumSha256 = file.checksum; details.filesystemIdentity = file.identity; }
    if (name === "replacement-workspace-created") details.filesystemIdentity = await directoryObjectIdentity(workspace);
    if (name === "replacement-guard-verified") { details.checksumSha256 = manifest.checksumSha256; details.filesystemIdentity = await backupDirectoryIdentity(guardPath); }
    if (name === "replacement-guard-manifest-verified") { details.checksumSha256 = mf.checksum; details.filesystemIdentity = mf.identity; }
    if (name === "replacement-old-world-preserved") { details.checksumSha256 = value.currentContentChecksum; details.filesystemIdentity = currentObjectIdentity; }
    if (["replacement-upload-claimed", "replacement-world-staged", "replacement-world-installed", "replacement-identity-installed"].includes(name)) details.checksumSha256 = checksum;
    if (["replacement-world-staged", "replacement-world-installed"].includes(name)) details.filesystemIdentity = installedObject;
    if (name === "replacement-identity-installed") details.filesystemIdentity = installedDirectory;
    await f.journal.appendCheckpoint("test", record.transactionId, { name, recordedAt: now, details });
  }
  const committed = await f.journal.setState("test", record.transactionId, "committed", now);
  const uploads = { validatedSource: async () => ({ directory: source, files, revision: value.uploadRevision, checksumSha256: checksum, minecraftVersion: "26.3", sizeBytes: 0 }) };
  return { ...f, prefix, record: committed, uploads, workspace, preserved, payload, guardPath, manifestPath, source, claimPath,
    priorWorkspace: f.workspace, priorPreserved: f.preserved, priorPayload: f.payload, priorManifest: f.manifestPath };
}

async function replacementAfterActivation() {
  const f = await installedFixture(), value = f.record.intent.worldReplacement!, operationId = randomUUID(), guardId = randomUUID();
  const previousWorldId = `worldv2-${randomUUID()}`, workspaceName = `.manager-world-activate-${operationId}`;
  const workspace = path.join(f.root, workspaceName), original = path.join(f.root, "Original"), guardPath = path.join(f.manager, "backups", "test", guardId);
  await mkdir(workspace); await mkdir(original); await writeFile(path.join(original, "level.dat"), "original-history-world");
  const files = await inventoryRestoreTree(original), prefixed = files.map(file => ({ ...file, path: `Original/${file.path}` }));
  await mkdir(path.join(guardPath, "payload"), { recursive: true }); await cp(original, path.join(guardPath, "payload", "Original"), { recursive: true });
  const manifest = { ...f.manifest, id: guardId, includedRoots: ["Original"], files: prefixed, fileCount: files.length,
    sizeBytes: files.reduce((n, file) => n + file.sizeBytes, 0), checksumSha256: restoreFilesChecksum(prefixed) };
  const manifestPath = path.join(guardPath, "manifest.json"); await writeFile(manifestPath, JSON.stringify(manifest));
  const after = await readFile(path.join(f.root, "server.properties"), "utf8"), before = after.replace("level-name=world", "level-name=Original");
  await writeFile(path.join(workspace, "properties.before"), before); await writeFile(path.join(workspace, "properties.approved"), after);
  const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
  const activation = { rootIdentity: value.rootIdentity, catalogId: value.catalogId, worldId: value.previousWorldId, previousWorldId,
    previousName: "Original", nextName: "world", libraryRevision: "1".repeat(64), currentWorldRevision: "2".repeat(64), targetWorldRevision: "3".repeat(64),
    currentContentChecksum: restoreFilesChecksum(files), targetContentChecksum: value.currentContentChecksum,
    currentDirectoryIdentity: await backupDirectoryIdentity(original), targetDirectoryIdentity: value.currentDirectoryIdentity,
    sourceImportTransactionId: randomUUID(), sourceImportChecksum: value.currentContentChecksum, predecessorTransactionId: null, sequence: 1,
    guardBackupId: guardId, propertiesBefore: hash(before), propertiesAfter: hash(after), workspaceName };
  const prior = await f.journal.createIntent({ operationId, serverId: "test", kind: "world-activate", scope: "world-set", resourceId: value.previousWorldId,
    allowStop: false, originalState: "stopped", createdAt: now, worldActivation: activation, paths: [
      { role: "source", namespace: "server", relativePath: "Original" }, { role: "target", namespace: "server", relativePath: "world" },
      { role: "staging", namespace: "server", relativePath: workspaceName }, { role: "rollback", namespace: "manager", relativePath: `backups/test/${guardId}` } ] });
  for (const name of activationProtectionSteps) {
    const details: { resourceId: string; checksumSha256?: string; filesystemIdentity?: string } = { resourceId: value.previousWorldId };
    if (name === "activation-guard-verified") { details.checksumSha256 = manifest.checksumSha256; details.filesystemIdentity = await backupDirectoryIdentity(guardPath); }
    const file = name === "activation-before-copy-verified" ? path.join(workspace, "properties.before") : name === "activation-approved-copy-verified" ? path.join(workspace, "properties.approved") : name === "activation-guard-manifest-verified" ? manifestPath : null;
    if (file) { const observed = await readPrivatePropertiesFile(file); observed.bytes.fill(0); details.checksumSha256 = observed.checksum; details.filesystemIdentity = observed.identity; }
    if (["activation-config-staged", "activation-config-installed"].includes(name)) details.checksumSha256 = activation.propertiesAfter;
    if (name === "activation-config-staged") details.filesystemIdentity = await directoryObjectIdentity(workspace);
    if (name === "activation-final-verified") details.checksumSha256 = activation.targetContentChecksum;
    await f.journal.appendCheckpoint("test", prior.transactionId, { name, recordedAt: now, details });
  }
  const committed = await f.journal.setState("test", prior.transactionId, "committed", now), prefix = [committed];
  const catalog = JSON.parse(await readFile(path.join(f.workspace, "catalog.before"), "utf8"));
  catalog.schemaVersion = 3; catalog.entries.push({ ...catalog.entries[0], worldId: previousWorldId, levelName: "Original", directoryIdentity: activation.currentDirectoryIdentity,
    legacySlotId: worldIdentity("test", "Original") });
  catalog.transitionHead = { sequence: 1, transactionId: committed.transactionId, intentDigest: hash(JSON.stringify(committed.intent)), previousDigest: hash("[]"), state: "committed", recordDigest: hash(JSON.stringify(prefix)) };
  await writeFile(path.join(f.workspace, "catalog.before"), JSON.stringify(catalog) + "\n");
  const copy = await readPrivatePropertiesFile(path.join(f.workspace, "catalog.before")); copy.bytes.fill(0);
  Object.assign(value, { sequence: 2, predecessorTransactionId: committed.transactionId, libraryRevision: copy.checksum });
  Object.assign(f.record.checkpoints.find(p => p.name === "replacement-catalog-before-verified")!.details!, { checksumSha256: copy.checksum, filesystemIdentity: copy.identity });
  await writeFile(path.join(f.manager, "transactions", `test.${f.record.transactionId}.json`), JSON.stringify(f.record));
  return { ...f, prefix, original, priorWorkspace: workspace, priorPayload: path.join(guardPath, "payload", "Original"), priorManifest: manifestPath };
}

describe("replacement catalog completion, no runtime exposure or recovery clearing", () => {
  it.each(["activation", "replacement"])("verifies actual retained %s prefix files before latest replacement acceptance", async kind => {
    const f = kind === "activation" ? await replacementAfterActivation() : await replacementAfterReplacement();
    if ("original" in f) await writeFile(path.join(f.original, "level.dat"), "legitimate-live-world-change");
    const bytes = await readFile(path.join(f.manager, "transactions", `test.${f.record.transactionId}.json`));
    const proof = await verifyReplacementJournalAndInstalledFiles(f.record, f.prefix, f.adapter, f.manager, f.backups, f.uploads, f.journal);
    await proof.recheck(); expect(proof.phase).toBe("installed-files");
    expect(await readFile(path.join(f.manager, "transactions", `test.${f.record.transactionId}.json`))).toEqual(bytes);
  });
  it.each(["guard", "preserved", "workspace", "approval"])("rejects damaged historical replacement %s evidence", async problem => {
    const f = await replacementAfterReplacement();
    if (problem === "guard") await writeFile(path.join(f.priorPayload, "level.dat"), "corrupt-protection");
    if (problem === "preserved") await writeFile(path.join(f.priorPreserved, "level.dat"), "corrupt-preserved");
    if (problem === "workspace") { await rename(f.priorWorkspace, f.priorWorkspace + "-retained"); await mkdir(f.priorWorkspace); }
    if (problem === "approval") await writeFile(path.join(f.priorWorkspace, "active.before"), "{}");
    await expect(verifyReplacementJournalAndInstalledFiles(f.record, f.prefix, f.adapter, f.manager, f.backups, f.uploads, f.journal))
      .rejects.toMatchObject({ code: "RECOVERY_REQUIRED", reason: "world-replacement-journal-unverified" });
  });
  it("rejects earlier prefix evidence changed while the latest source is verified", async () => {
    const f = await replacementAfterReplacement(), original = f.uploads.validatedSource;
    f.uploads.validatedSource = async () => { const result = await original(); await writeFile(path.join(f.priorPayload, "level.dat"), "late-prefix-change"); return result; };
    await expect(verifyReplacementJournalAndInstalledFiles(f.record, f.prefix, f.adapter, f.manager, f.backups, f.uploads, f.journal))
      .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it.each(["target", "claim", "controls"])("rechecks latest %s after the final retained-prefix pass", async problem => {
    const f = await replacementAfterReplacement(), original = f.uploads.validatedSource;
    const file = problem === "target" ? path.join(f.target, "level.dat") : problem === "claim" ? f.claimPath : path.join(f.root, "server.properties");
    const intact = await readFile(file); let armed = false, sourceReads = 0, laterChecks = 0, mutated = false;
    f.uploads.validatedSource = async () => { const result = await original(); if (armed) sourceReads++; return result; };
    const proof = await verifyReplacementJournalAndInstalledFiles(f.record, f.prefix, f.adapter, f.manager, f.backups, f.uploads, f.journal, () => {
      // Each latest installed pass reads its source twice. After its second
      // source, checks 1/2 finish installed identities, 3/4 bind the journal,
      // 5 enters retained iteration, 6 enters the old guard, 7 follows its I/O.
      if (armed && sourceReads === 2 && ++laterChecks === 7) {
        expect(readFileSync(file)).toEqual(intact);
        writeFileSync(file, "late-latest-change"); mutated = true;
      }
    });
    expect(await readFile(file)).toEqual(intact); armed = true;
    await expect(proof.recheck()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(mutated).toBe(true); expect(await readFile(file, "utf8")).toBe("late-latest-change");
  });
  it("honors cancellation after an awaited prefix proof without changing journal or worlds", async () => {
    const f = await replacementAfterReplacement(), original = f.backups.exportSource.bind(f.backups);
    const bytes = await readFile(path.join(f.manager, "transactions", `test.${f.record.transactionId}.json`));
    const world = await readFile(path.join(f.target, "level.dat")); let cancelled = false;
    f.backups.exportSource = async (...args) => { const source = await original(...args); cancelled = true; return source; };
    await expect(verifyReplacementJournalAndInstalledFiles(f.record, f.prefix, f.adapter, f.manager, f.backups, f.uploads, f.journal,
      () => { if (cancelled) throw new Error("cancelled"); })).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await readFile(path.join(f.manager, "transactions", `test.${f.record.transactionId}.json`))).toEqual(bytes);
    expect(await readFile(path.join(f.target, "level.dat"))).toEqual(world);
  });
  it.each(["schema12", "foreign", "extra", "missing", "fork"])("rejects non-authoritative prefix %s without journal mutation", async problem => {
    const f = await replacementAfterReplacement(), prefix = structuredClone(f.prefix);
    if (problem === "schema12") { Object.assign(prefix[0]!, { schemaVersion: 12 }); delete (prefix[0]!.intent.worldReplacement as { approval?: unknown }).approval; }
    if (problem === "foreign") Object.assign(prefix[0]!.intent, { serverId: "other" });
    if (problem === "extra") prefix.push({ ...structuredClone(prefix[0]!), intent: { ...prefix[0]!.intent, kind: "backup", worldReplacement: undefined } });
    if (problem === "missing") prefix.splice(0);
    if (problem === "fork") prefix.push(structuredClone(prefix[0]!));
    const before = await readFile(path.join(f.manager, "transactions", `test.${f.record.transactionId}.json`));
    await expect(verifyReplacementJournalAndInstalledFiles(f.record, prefix, f.adapter, f.manager, f.backups, f.uploads, f.journal))
      .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await readFile(path.join(f.manager, "transactions", `test.${f.record.transactionId}.json`))).toEqual(before);
  });
  it.each(["own-active-journal", "unknown-corrupt-journal", "other-corrupt-journal", "missing-journal", "forked-journal"])("checks exact scoped journal authority: %s", async problem => {
    const f = await publicationFixture(), file = path.join(f.manager, "transactions", `test.${f.record.transactionId}.json`);
    let retained: string | undefined;
    if (problem === "own-active-journal") await f.journal.createIntent({ operationId: randomUUID(), serverId: "test", kind: "backup", scope: "world-set",
      resourceId: null, allowStop: false, originalState: "stopped", createdAt: "2026-10-27T00:00:00Z", paths: [{ role: "source", relativePath: "world" }] });
    if (problem === "unknown-corrupt-journal" || problem === "other-corrupt-journal") {
      retained = path.join(f.manager, "transactions", problem === "unknown-corrupt-journal" ? "unknown.json" : `other.${randomUUID()}.json`);
      await writeFile(retained, "{broken-retained-evidence");
    }
    if (problem === "missing-journal") await rename(file, path.join(f.manager, "retained-original-journal.json"));
    if (problem === "forked-journal") {
      const fork = structuredClone(f.record); fork.transactionId = randomUUID();
      await writeFile(path.join(f.manager, "transactions", `test.${fork.transactionId}.json`), JSON.stringify(fork));
    }
    const result = verifyReplacementJournalAndInstalledFiles(f.record, [], f.adapter, f.manager, f.backups, f.uploads, f.journal);
    if (problem === "other-corrupt-journal") await expect(result).resolves.toMatchObject({ phase: "installed-files" });
    else await expect(result).rejects.toMatchObject({ code: "RECOVERY_REQUIRED", reason: "world-replacement-journal-unverified" });
    if (retained) expect(await readFile(retained, "utf8")).toBe("{broken-retained-evidence");
    if (problem === "missing-journal") await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("binds current installed proof to actual journal bytes and rejects later checkpoint drift", async () => {
    const f = await publicationFixture();
    const proof = await verifyReplacementJournalAndInstalledFiles(f.record, [], f.adapter, f.manager, f.backups, f.uploads, f.journal);
    await proof.recheck(); expect(proof.phase).toBe("installed-files");
    const changed = structuredClone(f.record); changed.checkpoints[0]!.details!.checksumSha256 = "0".repeat(64);
    const file = path.join(f.manager, "transactions", `test.${f.record.transactionId}.json`), bytes = JSON.stringify(changed);
    await writeFile(file, bytes);
    await expect(proof.recheck()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED", reason: "world-replacement-journal-unverified" });
    expect(await readFile(file, "utf8")).toBe(bytes);
  });
  it("rejects journal mutation during installed-file validation without rewriting it", async () => {
    const f = await publicationFixture(), original = f.uploads.validatedSource; let calls = 0;
    const file = path.join(f.manager, "transactions", `test.${f.record.transactionId}.json`);
    f.uploads.validatedSource = async (...args) => {
      const source = await original(...args);
      if (++calls === 2) { const changed = structuredClone(f.record); changed.updatedAt = "2026-10-27T00:00:00.001Z"; await writeFile(file, JSON.stringify(changed)); }
      return source;
    };
    await expect(verifyReplacementJournalAndInstalledFiles(f.record, [], f.adapter, f.manager, f.backups, f.uploads, f.journal))
      .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(JSON.parse(await readFile(file, "utf8")).updatedAt).toBe("2026-10-27T00:00:00.001Z");
  });
  it("publishes the fresh identity and retires the old one while keeping controls, guard and journal intact", async () => {
    const f = await publicationFixture(), value = f.record.intent.worldReplacement!, active = await readFile(f.activePath), properties = await readFile(path.join(f.root, "server.properties"));
    const journal = JSON.stringify(await f.journal.get("test", f.record.transactionId));
    await f.library.completeReplacement(f.binding, f.revision, [f.record], f.proof);
    const catalog = JSON.parse(await readFile(f.catalogPath, "utf8"));
    expect(catalog.transitionHead.state).toBe("committed");
    expect(catalog.entries.find((e: { worldId: string }) => e.worldId === value.previousWorldId).state).toBe("retired");
    expect(catalog.entries.find((e: { worldId: string }) => e.worldId === value.worldId)).toMatchObject({ state: "present", replacesWorldId: value.previousWorldId, admissionRevision: value.libraryRevision });
    expect((await f.library.projectTransitionHistory(f.binding, [f.record])).activeWorldId).toBe(value.worldId);
    expect(await readFile(f.activePath)).toEqual(active); expect(await readFile(path.join(f.root, "server.properties"))).toEqual(properties);
    expect(JSON.stringify(await f.journal.get("test", f.record.transactionId))).toBe(journal);
    expect(f.operations.getServerState("test").recoveryRequired).toBe(true);
    expect(await readFile(path.join(f.preserved, "level.dat"), "utf8")).toBe("isolated-world-content");
  });
  it.each(["post-proof-failure", "post-target-change", "post-catalog-object", "post-other-head"])("durably invalidates only its own completion after %s", async problem => {
    const f = await publicationFixture(), journal = JSON.stringify(await f.journal.get("test", f.record.transactionId)); let calls = 0, changedHeadBytes: string | undefined;
    const proof = { ...f.proof, recheck: async () => {
      if (++calls === 2) {
        if (problem === "post-proof-failure") throw new Error("controlled");
        if (problem === "post-target-change") await writeFile(path.join(f.target, "level.dat"), "changed-after-publication");
        if (problem === "post-catalog-object") {
          const bytes = await readFile(f.catalogPath);
          await rename(f.catalogPath, path.join(f.manager, `retained-completion-${randomUUID()}.json`)); await writeFile(f.catalogPath, bytes);
        }
        if (problem === "post-other-head") {
          const catalog = JSON.parse(await readFile(f.catalogPath, "utf8")); catalog.transitionHead.transactionId = randomUUID();
          changedHeadBytes = JSON.stringify(catalog) + "\n"; await writeFile(f.catalogPath, changedHeadBytes);
        }
      }
      await f.proof.recheck();
    } };
    await expect(f.library.completeReplacement(f.binding, f.revision, [f.record], proof)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    const catalog = JSON.parse(await readFile(f.catalogPath, "utf8"));
    if (problem === "post-other-head") expect(await readFile(f.catalogPath, "utf8")).toBe(changedHeadBytes);
    else expect(catalog.transitionHead).toMatchObject({ state: "pending", recordDigest: null });
    expect(JSON.stringify(await f.journal.get("test", f.record.transactionId))).toBe(journal);
    expect(f.operations.getServerState("test").recoveryRequired).toBe(true);
    if (problem === "post-target-change") expect(await readFile(path.join(f.target, "level.dat"), "utf8")).toBe("changed-after-publication");
  });
  it.each(["wrong-revision", "wrong-proof", "changed-entries"])("preserves pending catalog on %s", async problem => {
    const f = await publicationFixture(); let revision = f.revision;
    if (problem === "changed-entries") {
      const catalog = JSON.parse(await readFile(f.catalogPath, "utf8")); catalog.entries[0].createdAt = "2026-10-26T00:00:00Z";
      await writeFile(f.catalogPath, JSON.stringify(catalog) + "\n"); revision = createHash("sha256").update(await readFile(f.catalogPath)).digest("hex");
    }
    const before = await readFile(f.catalogPath);
    await expect(f.library.completeReplacement(f.binding, problem === "wrong-revision" ? "0".repeat(64) : revision, [f.record],
      problem === "wrong-proof" ? { ...f.proof, recordDigest: "0".repeat(64) } : f.proof)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await readFile(f.catalogPath)).toEqual(before);
  });
});

describe("latest installed-file proof, not publication/recovery acceptance", () => {
  it("rejects equal-content target object substitution during final source validation", async () => {
    const f = await installedFixture(), original = f.uploads.validatedSource; let calls = 0;
    f.uploads.validatedSource = async (...args) => {
      const source = await original(...args);
      if (++calls === 2) { await rename(f.target, f.target + ".retained"); await cp(f.target + ".retained", f.target, { recursive: true }); }
      return source;
    };
    await expect(verifyReplacementInstalledFiles(f.record, [], f.adapter, f.manager, f.backups, f.uploads))
      .rejects.toMatchObject({ code: "RECOVERY_REQUIRED", reason: "world-replacement-installed-unverified" });
    expect(calls).toBe(2);
  });
  it.each(["target", "claim", "controls"])("rejects late %s mutation during the final runtime observation", async problem => {
    const f = await installedFixture(); let observations = 0;
    Object.assign(f.adapter, { getStatus: async () => {
      if (++observations === 2) {
        if (problem === "target") await writeFile(path.join(f.target, "level.dat"), "changed-in-final-status");
        if (problem === "claim") await writeFile(f.claimPath, "{}");
        if (problem === "controls") await writeFile(f.activePath, "changed-in-final-status");
      }
      return { state: "stopped", ownership: "none", recoveryRequired: false };
    } });
    await expect(verifyReplacementInstalledFiles(f.record, [], f.adapter, f.manager, f.backups, f.uploads))
      .rejects.toMatchObject({ code: "RECOVERY_REQUIRED", reason: "world-replacement-installed-unverified" });
    expect(observations).toBe(2);
  });
  it("checks new target, retained old world, real legacy guard and snapshots without changing controls", async () => {
    const f = await installedFixture(), before = await readFile(f.activePath);
    const proof = await verifyReplacementInstalledFiles(f.record, [], f.adapter, f.manager, f.backups, f.uploads); await proof.recheck();
    expect(proof.phase).toBe("installed-files"); expect(await readFile(f.activePath)).toEqual(before);
    await writeFile(path.join(f.target, "level.dat"), "changed-after-proof");
    await expect(proof.recheck()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it.each(["target-data", "target-object", "claim-missing", "claim-wrong-operation", "controls-changed", "runtime-running", "source-version"])("rejects %s", async problem => {
    const f = await installedFixture();
    if (problem === "target-data") await writeFile(path.join(f.target, "level.dat"), "changed");
    if (problem === "target-object") { await rename(f.target, f.target + ".retained"); await cp(f.target + ".retained", f.target, { recursive: true }); }
    if (problem === "claim-missing") await rm(f.claimPath);
    if (problem === "claim-wrong-operation") await writeFile(f.claimPath, JSON.stringify({ schemaVersion: 1, serverId: "test", uploadId: f.record.intent.worldReplacement!.uploadId, operationId: randomUUID() }));
    if (problem === "controls-changed") await writeFile(f.activePath, "changed");
    if (problem === "runtime-running") Object.assign(f.adapter, { getStatus: async () => ({ state: "running", ownership: "managed", recoveryRequired: false }) });
    if (problem === "source-version") { const original = f.uploads.validatedSource; f.uploads.validatedSource = async (...args) => ({ ...await original(...args), minecraftVersion: "unknown" }); }
    await expect(verifyReplacementInstalledFiles(f.record, [], f.adapter, f.manager, f.backups, f.uploads))
      .rejects.toMatchObject({ code: "RECOVERY_REQUIRED", reason: "world-replacement-installed-unverified" });
  });
});

describe("read-only immutable old-world replacement protection", () => {
  it("uses the real legacy manifest reader, distinguishes checksum namespaces, and leaves recovery untouched", async () => {
    const f = await fixture(), bytes = await readFile(f.manifestPath);
    expect(f.manifest.checksumSha256).not.toBe(f.record.intent.worldReplacement!.currentContentChecksum);
    f.operations.requireRecovery(["test"]);
    const proof = await verifyReplacementProtection(f.record, f.adapter, f.manager, f.backups);
    expect(proof.recordDigest).toBe(createHash("sha256").update(JSON.stringify(f.record)).digest("hex"));
    proof.guardFiles[0]!.sha256 = "0".repeat(64); await proof.recheck();
    expect(f.operations.getServerState("test").recoveryRequired).toBe(true);
    expect(await readFile(f.manifestPath)).toEqual(bytes);
    expect(await readFile(path.join(f.preserved, "level.dat"), "utf8")).toBe("isolated-world-content");
  });
  it.each(["guard-data", "old-data", "extra-guard-root", "manifest-bytes", "manifest-unpinned", "old-object", "workspace-object", "wrong-instance", "wrong-version", "guard-digest"])("rejects changed protection: %s", async problem => {
    const f = await fixture();
    switch (problem) {
      case "guard-data": await writeFile(path.join(f.payload, "level.dat"), "changed"); break;
      case "old-data": await writeFile(path.join(f.preserved, "level.dat"), "changed"); break;
      case "extra-guard-root": await mkdir(path.join(path.dirname(f.payload), "other")); break;
      case "manifest-bytes": await writeFile(f.manifestPath, JSON.stringify(f.manifest) + "\n"); break;
      case "manifest-unpinned": await writeFile(f.manifestPath, JSON.stringify({ ...f.manifest, pinned: false })); break;
      case "old-object": await rename(f.preserved, f.preserved + "-original"); await cp(f.preserved + "-original", f.preserved, { recursive: true }); break;
      case "workspace-object": await rename(f.workspace, f.workspace + "-original"); await cp(f.workspace + "-original", f.workspace, { recursive: true }); break;
      case "wrong-instance": Object.assign(f.adapter, { serverId: "other" }); break;
      case "wrong-version": Object.assign(f.adapter.plan.serverInfo, { minecraftVersion: "unknown" }); break;
      case "guard-digest": f.record.checkpoints[2]!.details!.checksumSha256 = f.record.intent.worldReplacement!.currentContentChecksum; break;
    }
    await expect(verifyReplacementProtection(f.record, f.adapter, f.manager, f.backups)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED", reason: "world-replacement-protection-unverified" });
  });
  it("rechecks after initial verification and sanitizes cancellation without changing files", async () => {
    const f = await fixture(); let cancelled = false;
    const proof = await verifyReplacementProtection(f.record, f.adapter, f.manager, f.backups, () => { if (cancelled) throw new Error(f.root); });
    cancelled = true; await expect(proof.recheck()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    cancelled = false; await writeFile(path.join(f.preserved, "level.dat"), "changed-after-verification");
    await expect(proof.recheck()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it.each(["missing", "changed", "duplicate", "wrong-world", "encoding"])("rejects unsafe original properties evidence: %s", async problem => {
    const f = await fixture(), file = path.join(f.workspace, "properties.before");
    if (problem === "missing") await rm(file);
    else {
      const bytes = problem === "duplicate" ? Buffer.from("level-name=world\nlevel-name=other\n") :
        problem === "wrong-world" ? Buffer.from("level-name=other\n") : problem === "encoding" ? Buffer.from([0xff, 0x0a]) : Buffer.from("level-name=world\n");
      await writeFile(file, bytes);
      // Malformed semantic cases must fail even when the journal binds their bytes.
      if (problem !== "changed") f.record.intent.worldReplacement!.propertiesChecksum = createHash("sha256").update(bytes).digest("hex");
    }
    await expect(verifyReplacementProtection(f.record, f.adapter, f.manager, f.backups)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
});
