import path from "node:path";
import type { LocalMinecraftServerAdapter } from "../adapters/contract.js";
import type { BackupService } from "./backup-service.js";
import { backupDirectoryIdentity, directoryObjectIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { verifyRestoreTree } from "./restore-files.js";
import type { TransactionJournalRecord } from "./transaction-journal.js";
import type { WorldImportUploadService } from "./world-import-upload-service.js";
import { verifyReplacementApprovalSnapshots } from "./world-replacement-approval.js";
import { verifyReplacementProtection } from "./world-replacement-protection.js";
import { replacementTransitionEvent } from "./world-transition-records.js";

const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Replacement installed files require inspection", "world-replacement-installed-unverified", true);

/** Shared retained-source/claim observation. Parsed journal input only; caller
 * holds upload lease and separately verifies target/live state. Never mutates. */
export async function readReplacementSource(record: TransactionJournalRecord, managerRoot: string,
  uploads: Pick<WorldImportUploadService, "validatedSource">) {
  if (record.schemaVersion !== 13 || !record.intent.worldReplacement) throw fail();
  return readRetainedWorldSource(record, managerRoot, uploads);
}

/** Same mandatory claim evidence for an ordinary retained import birth. */
export async function readRetainedWorldSource(record: TransactionJournalRecord, managerRoot: string,
  uploads: Pick<WorldImportUploadService, "validatedSource">) {
  try {
    const value = record.schemaVersion === 13 && record.intent.kind === "world-replace" ? record.intent.worldReplacement :
      record.schemaVersion === 9 && record.intent.kind === "world-library-import" ? record.intent.worldLibraryImport : undefined;
    if (!value || !/^[0-9a-f-]{36}$/iu.test(value.uploadId) || !/^[0-9a-f-]{36}$/iu.test(record.intent.operationId)) throw fail();
    const uploadId = value.uploadId.toLowerCase(), operationId = record.intent.operationId.toLowerCase();
    const source = structuredClone(await uploads.validatedSource(record.intent.serverId, uploadId, value.uploadRevision, operationId));
    const expected = path.resolve(managerRoot, "world-imports", uploadId), normalize = (name: string) => process.platform === "win32" ? path.resolve(name).toLowerCase() : path.resolve(name);
    if (normalize(source.directory) !== normalize(expected) || source.revision !== value.uploadRevision ||
        source.checksumSha256 !== value.importedChecksum || source.minecraftVersion !== "26.3") throw fail();
    const consumed = await readPrivatePropertiesFile(path.join(source.directory, "consumed.json"), 16 * 1024);
    try {
      const text = consumed.bytes.toString("utf8"), marker = JSON.parse(text) as Record<string, unknown>;
      if (!consumed.bytes.equals(Buffer.from(text, "utf8")) || !marker || typeof marker !== "object" || Array.isArray(marker) || (text !== JSON.stringify(marker) && text !== JSON.stringify(marker) + "\n") ||
          Object.keys(marker).some(key => !["schemaVersion", "serverId", "uploadId", "operationId"].includes(key)) ||
          marker.schemaVersion !== 1 || marker.serverId !== record.intent.serverId || typeof marker.uploadId !== "string" ||
          marker.uploadId.toLowerCase() !== uploadId || typeof marker.operationId !== "string" || marker.operationId.toLowerCase() !== operationId) throw fail();
      const identity = consumed.identity, checksum = consumed.checksum;
      const recheckClaim = async () => {
        const fresh = await readPrivatePropertiesFile(path.join(source.directory, "consumed.json"), 16 * 1024);
        try { if (fresh.identity !== identity || fresh.checksum !== checksum) throw fail(); } finally { fresh.bytes.fill(0); }
      };
      return { source, recheckClaim, claimIdentity: identity, claimChecksum: checksum };
    } finally { consumed.bytes.fill(0); }
  } catch { throw fail(); }
}

/** Latest installed-file proof, not historical live-content proof. Caller holds
 * the instance AND upload leases for the entire call and each recheck. Does not
 * publish/accept catalog head, clear recovery, replay, mutate or start anything.
 */
export async function verifyReplacementInstalledFiles(original: TransactionJournalRecord, originalPrefix: readonly TransactionJournalRecord[],
  adapter: LocalMinecraftServerAdapter, managerRoot: string, backups: Pick<BackupService, "exportSource">,
  uploads: Pick<WorldImportUploadService, "validatedSource">, check: () => void = () => {}) {
  try {
    const record = structuredClone(original), prefix = structuredClone(originalPrefix), value = record.intent.worldReplacement;
    if (record.schemaVersion !== 13 || !value?.approval) throw fail();
    const event = replacementTransitionEvent(record), approval = value.approval, root = adapter.plan.rootPath, target = path.join(root, value.levelName);
    const protection = await verifyReplacementProtection(record, adapter, managerRoot, backups, check);
    const snapshots = await verifyReplacementApprovalSnapshots(record, root, prefix, check);
    if (protection.recordDigest !== snapshots.recordDigest) throw fail();
    const installedObject = record.checkpoints.find(point => point.name === "replacement-world-installed")!.details!.filesystemIdentity;
    const installedIdentities = async () => {
      check();
      if (await backupDirectoryIdentity(root) !== value.rootIdentity || await backupDirectoryIdentity(target) !== event.next.directoryIdentity ||
          await directoryObjectIdentity(target) !== installedObject) throw fail();
    };
    const runtime = async () => {
      check(); const status = await adapter.getStatus();
      if (status.state !== "stopped" || status.ownership !== "none" || status.recoveryRequired) throw fail();
      await installedIdentities();
    };
    const unchangedControls = async () => {
      for (const [file, identity, checksum] of [[path.join(root, "server.properties"), approval.propertiesIdentity, value.propertiesChecksum],
        [path.join(managerRoot, "active-worlds", `${record.intent.serverId}.json`), approval.activeStateIdentity, approval.activeStateChecksum]]) {
        const current = await readPrivatePropertiesFile(file!);
        try { if (current.identity !== identity || current.checksum !== checksum) throw fail(); } finally { current.bytes.fill(0); }
      }
    };
    const verifySourceAndTarget = async () => {
      const retained = await readReplacementSource(record, managerRoot, uploads);
      await unchangedControls(); await verifyRestoreTree(target, retained.source.files); await unchangedControls();
      await retained.recheckClaim();
    };
    const recheck = async () => {
      try {
        await runtime(); await unchangedControls(); await protection.recheck(); await snapshots.recheck();
        await verifySourceAndTarget();
        await snapshots.recheck(); await protection.recheck(); await runtime();
        // Final bounded pass follows the last awaited guard/snapshot/status
        // phase: a directory identity alone cannot certify world contents.
        await verifySourceAndTarget(); await installedIdentities(); check();
      } catch { throw fail(); }
    };
    await recheck();
    return { recheck, recordDigest: protection.recordDigest, phase: "installed-files" as const };
  } catch { throw fail(); }
}
