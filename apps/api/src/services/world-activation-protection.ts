import { readdir } from "node:fs/promises";
import path from "node:path";
import { updatePropertiesText } from "../config/properties.js";
import { backupDirectoryIdentity, directoryObjectIdentity } from "./backup-identity.js";
import type { BackupService } from "./backup-service.js";
import { DomainError } from "./domain-errors.js";
import { editablePropertyEntries } from "./properties-grammar.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { plainRestoreDirectory, restoreFilesChecksum, verifyRestoreTree } from "./restore-files.js";
import type { TransactionJournalRecord } from "./transaction-journal.js";

export const activationProtectionSteps = ["activation-intent-persisted", "activation-guard-verified", "activation-guard-manifest-verified",
  "activation-before-copy-verified", "activation-approved-copy-verified", "activation-config-staged", "activation-switch-intent",
  "activation-config-installed", "activation-state-installed", "activation-final-verified"] as const;
const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Activation protection requires inspection", "world-activation-protection-unverified", true);

/** Verifies immutable protection evidence only. Historical source/target worlds
 * may since have become active and changed; their live contents are deliberately
 * not compared here. Callers still verify chain head, journal and live state. */
export async function verifyActivationProtection(record: TransactionJournalRecord, root: string, managerRoot: string,
  backups: Pick<BackupService, "exportSource">) {
  const w = record.intent.worldActivation;
  if (!w || record.state !== "committed" || record.checkpoints.length !== activationProtectionSteps.length ||
      record.checkpoints.some((point, index) => point.name !== activationProtectionSteps[index]) ||
      await backupDirectoryIdentity(root) !== w.rootIdentity) throw fail();
  const details = (name: string) => {
    const value = record.checkpoints.find(point => point.name === name)?.details;
    if (!value || value.resourceId !== w.worldId) throw fail();
    return value;
  };
  if (details("activation-final-verified").checksumSha256 !== w.targetContentChecksum ||
      details("activation-config-installed").checksumSha256 !== w.propertiesAfter ||
      details("activation-config-staged").checksumSha256 !== w.propertiesAfter) throw fail();
  const workspace = path.join(root, w.workspaceName), workspaceId = details("activation-config-staged").filesystemIdentity;
  if (!workspaceId || await directoryObjectIdentity(workspace) !== workspaceId) throw fail();
  const readCopy = async (name: string, step: string, checksum: string) => {
    const proof = details(step), file = await readPrivatePropertiesFile(path.join(workspace, name));
    if (!proof.filesystemIdentity || file.identity !== proof.filesystemIdentity || file.checksum !== checksum || proof.checksumSha256 !== checksum) {
      file.bytes.fill(0); throw fail();
    }
    return file;
  };
  const before = await readCopy("properties.before", "activation-before-copy-verified", w.propertiesBefore);
  let approved: Awaited<ReturnType<typeof readPrivatePropertiesFile>> | undefined;
  try {
    approved = await readCopy("properties.approved", "activation-approved-copy-verified", w.propertiesAfter);
    const text = before.bytes.toString("utf8"), after = approved.bytes.toString("utf8");
    const entries = editablePropertyEntries(text).filter(([key]) => key === "level-name");
    if (!before.bytes.equals(Buffer.from(text, "utf8")) || !approved.bytes.equals(Buffer.from(after, "utf8")) ||
        text.startsWith("\ufeff") || text.includes("\0") || entries.length !== 1 || entries[0]![1] !== w.previousName ||
        updatePropertiesText(text, { "level-name": w.nextName }) !== after) throw fail();
  } finally { before.bytes.fill(0); approved?.bytes.fill(0); }
  const guard = await backups.exportSource(record.intent.serverId, w.guardBackupId), manifest = guard.manifest;
  const guardPath = path.join(managerRoot, "backups", record.intent.serverId, w.guardBackupId);
  if (guard.directory !== guardPath || !manifest.pinned || manifest.scope !== "world-set" || manifest.serverType !== "vanilla" ||
      manifest.minecraftVersion !== "26.3" || manifest.includedRoots.length !== 1 || manifest.includedRoots[0] !== w.previousName ||
      manifest.checksumSha256 !== details("activation-guard-verified").checksumSha256 ||
      await backupDirectoryIdentity(guardPath) !== details("activation-guard-verified").filesystemIdentity) throw fail();
  const guardManifest = await readPrivatePropertiesFile(path.join(guardPath, "manifest.json"), 64 * 1024 ** 2);
  try { if (guardManifest.identity !== details("activation-guard-manifest-verified").filesystemIdentity ||
    guardManifest.checksum !== details("activation-guard-manifest-verified").checksumSha256) throw fail(); } finally { guardManifest.bytes.fill(0); }
  const guardFiles = manifest.files.map(file => {
    if (!file.path.startsWith(`${w.previousName}/`)) throw fail();
    return { ...file, path: file.path.slice(w.previousName.length + 1) };
  });
  if (restoreFilesChecksum(guardFiles) !== w.currentContentChecksum) throw fail();
  const payload = path.join(guardPath, "payload");
  const recheck = async () => {
    if (await backupDirectoryIdentity(root) !== w.rootIdentity || await directoryObjectIdentity(workspace) !== workspaceId ||
        await backupDirectoryIdentity(guardPath) !== details("activation-guard-verified").filesystemIdentity) throw fail();
    for (const [name, step, checksum] of [["properties.before", "activation-before-copy-verified", w.propertiesBefore],
      ["properties.approved", "activation-approved-copy-verified", w.propertiesAfter]]) {
      const copy = await readCopy(name!, step!, checksum!); copy.bytes.fill(0);
    }
    const fresh = await readPrivatePropertiesFile(path.join(guardPath, "manifest.json"), 64 * 1024 ** 2);
    try { if (fresh.identity !== guardManifest.identity || fresh.checksum !== guardManifest.checksum) throw fail(); }
    finally { fresh.bytes.fill(0); }
    await plainRestoreDirectory(payload);
    const children = await readdir(payload); if (children.length !== 1 || children[0] !== w.previousName) throw fail();
    await verifyRestoreTree(path.join(payload, w.previousName), guardFiles);
  };
  await recheck();
  return { workspace, workspaceId, guardFiles, recheck };
}
