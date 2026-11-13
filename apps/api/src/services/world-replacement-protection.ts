import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { LocalMinecraftServerAdapter } from "../adapters/contract.js";
import type { BackupService } from "./backup-service.js";
import { backupDirectoryIdentity, directoryObjectIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { editablePropertyEntries } from "./properties-grammar.js";
import { plainRestoreDirectory, restoreFilesChecksum, verifyRestoreTree } from "./restore-files.js";
import type { TransactionJournalRecord } from "./transaction-journal.js";
import { replacementTransitionEvent } from "./world-transition-records.js";

const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Replacement protection requires inspection", "world-replacement-protection-unverified", true);

/** Verifies ONLY immutable old-world protection. Does not validate new/live
 * world contents, catalog/head approval copies, upload provenance or active state;
 * does not clear recovery, rename, delete, replay, stop or start anything.
 * Backend-only return paths/proof must never be serialized into REST responses.
 */
export async function verifyReplacementProtection(original: TransactionJournalRecord, adapter: LocalMinecraftServerAdapter,
  managerRoot: string, backups: Pick<BackupService, "exportSource">, check: () => void = () => {}) {
  try {
    check(); const record = structuredClone(original), event = replacementTransitionEvent(record), value = record.intent.worldReplacement!;
    if (adapter.serverId !== record.intent.serverId || adapter.plan.serverInfo.type !== "vanilla" ||
        adapter.plan.serverInfo.minecraftVersion !== "26.3") throw fail();
    const root = adapter.plan.rootPath, workspace = path.join(root, value.workspaceName), preserved = path.join(workspace, "previous-world");
    const details = (name: string) => record.checkpoints.find(point => point.name === name)!.details!;
    const guardProof = details("replacement-guard-verified"), manifestProof = details("replacement-guard-manifest-verified"),
      workspaceIdentity = details("replacement-workspace-created").filesystemIdentity!;
    const guardPath = path.join(managerRoot, "backups", record.intent.serverId, value.guardBackupId);
    const source = await backups.exportSource(record.intent.serverId, value.guardBackupId), manifest = source.manifest;
    if (source.directory !== guardPath || !manifest.pinned || manifest.state !== "complete" || manifest.scope !== "world-set" ||
        manifest.serverType !== "vanilla" || manifest.minecraftVersion !== "26.3" || manifest.includedRoots.length !== 1 ||
        manifest.includedRoots[0] !== value.levelName || manifest.checksumSha256 !== guardProof.checksumSha256) throw fail();
    const files = manifest.files.map(file => {
      if (!file.path.startsWith(`${value.levelName}/`)) throw fail();
      return { ...file, path: file.path.slice(value.levelName.length + 1) };
    });
    if (restoreFilesChecksum(files) !== value.currentContentChecksum) throw fail();
    const verifyManifest = async () => {
      const fresh = await readPrivatePropertiesFile(path.join(guardPath, "manifest.json"), 64 * 1024 ** 2);
      try { if (fresh.identity !== manifestProof.filesystemIdentity || fresh.checksum !== manifestProof.checksumSha256) throw fail(); }
      finally { fresh.bytes.fill(0); }
    };
    const verifyPropertiesBefore = async () => {
      const copy = await readPrivatePropertiesFile(path.join(workspace, "properties.before"));
      try {
        const text = copy.bytes.toString("utf8"), names = editablePropertyEntries(text).filter(([key]) => key === "level-name");
        if (copy.checksum !== value.propertiesChecksum || !copy.bytes.equals(Buffer.from(text, "utf8")) ||
            text.startsWith("\ufeff") || text.includes("\0") || names.length !== 1 || names[0]![1] !== value.levelName) throw fail();
      } finally { copy.bytes.fill(0); }
    };
    const recheck = async () => {
      try {
        check();
        if (await backupDirectoryIdentity(root) !== value.rootIdentity || await directoryObjectIdentity(workspace) !== workspaceIdentity ||
            await directoryObjectIdentity(preserved) !== value.currentObjectIdentity ||
            await backupDirectoryIdentity(guardPath) !== guardProof.filesystemIdentity) throw fail();
        await verifyManifest(); await verifyPropertiesBefore();
        const payload = path.join(guardPath, "payload"); await plainRestoreDirectory(payload);
        const children = await readdir(payload); if (children.length !== 1 || children[0] !== value.levelName) throw fail();
        await verifyRestoreTree(path.join(payload, value.levelName), files); check();
        await verifyRestoreTree(preserved, files); check();
        await verifyManifest(); await verifyPropertiesBefore(); check();
        if (await directoryObjectIdentity(workspace) !== workspaceIdentity || await directoryObjectIdentity(preserved) !== value.currentObjectIdentity ||
            await backupDirectoryIdentity(guardPath) !== guardProof.filesystemIdentity || await backupDirectoryIdentity(root) !== value.rootIdentity) throw fail();
      } catch { throw fail(); }
    };
    await recheck(); check();
    return { worldId: event.next.worldId, previousWorldId: event.previous.worldId, guardFiles: files.map(file => ({ ...file })), recheck,
      recordDigest: createHash("sha256").update(JSON.stringify(record)).digest("hex") };
  } catch { throw fail(); }
}
