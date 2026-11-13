import type { LocalMinecraftServerAdapter } from "../adapters/contract.js";
import type { BackupService } from "./backup-service.js";
import { DomainError } from "./domain-errors.js";
import type { TransactionJournalRecord, TransactionJournalStore } from "./transaction-journal.js";
import type { WorldImportUploadService } from "./world-import-upload-service.js";
import { verifyReplacementInstalledFiles } from "./world-replacement-installed.js";
import { orderedWorldTransitionRecords } from "./world-transition-records.js";
import { verifyActivationProtection } from "./world-activation-protection.js";
import { verifyReplacementProtection } from "./world-replacement-protection.js";
import { verifyReplacementApprovalSnapshots } from "./world-replacement-approval.js";

const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Replacement journal proof requires inspection", "world-replacement-journal-unverified", true);

/** Binds latest installed-file proof to the actual exact scoped journal set.
 * Includes every predecessor's retained immutable protection. Historical live
 * contents/import births and current catalog publication remain separate checks.
 * Caller holds instance/upload leases. No journal/catalog mutation, recovery
 * clearing or runtime exposure. Schema12 remains inspection-only.
 */
export async function verifyReplacementJournalAndInstalledFiles(original: TransactionJournalRecord, originalPrefix: readonly TransactionJournalRecord[],
  adapter: LocalMinecraftServerAdapter, managerRoot: string, backups: Pick<BackupService, "exportSource">,
  uploads: Pick<WorldImportUploadService, "validatedSource">, journal: Pick<TransactionJournalStore, "scan">, check: () => void = () => {}) {
  try {
    const record = structuredClone(original), prefix = structuredClone(originalPrefix), serverId = record.intent.serverId;
    // Do not silently discard unrelated/foreign records from a claimed prefix.
    if (JSON.stringify(orderedWorldTransitionRecords(serverId, prefix)) !== JSON.stringify(prefix)) throw fail();
    const expected = orderedWorldTransitionRecords(serverId, [...prefix, record]);
    if (JSON.stringify(expected.slice(0, -1)) !== JSON.stringify(prefix) ||
        JSON.stringify(expected.at(-1)) !== JSON.stringify(record)) throw fail();
    const verifyJournal = async () => {
      check(); const actual = await journal.scan();
      if (actual.issues.some(issue => !issue.serverId || issue.serverId === serverId) || actual.recoveryServerIds.has(serverId) ||
          JSON.stringify(orderedWorldTransitionRecords(serverId, actual.records)) !== JSON.stringify(expected)) throw fail();
      check();
    };
    await verifyJournal();
    const retained: Array<{ recheck: () => Promise<void> }> = [];
    for (const [index, previous] of prefix.entries()) {
      check();
      if (previous.intent.worldActivation) {
        retained.push(await verifyActivationProtection(previous, adapter.plan.rootPath, managerRoot, backups));
      } else {
        if (previous.schemaVersion !== 13) throw fail();
        retained.push(await verifyReplacementProtection(previous, adapter, managerRoot, backups, check));
        retained.push(await verifyReplacementApprovalSnapshots(previous, adapter.plan.rootPath, prefix.slice(0, index), check));
      }
      check();
    }
    const verifyRetained = async () => {
      for (const proof of retained) { check(); await proof.recheck(); check(); }
    };
    const installed = await verifyReplacementInstalledFiles(record, prefix, adapter, managerRoot, backups, uploads, check);
    const recheck = async () => {
      try {
        await verifyJournal(); await verifyRetained(); await installed.recheck();
        await verifyJournal(); await verifyRetained(); await installed.recheck(); await verifyJournal();
      }
      catch { throw fail(); }
    };
    await recheck();
    return { recheck, recordDigest: installed.recordDigest, phase: installed.phase };
  } catch { throw fail(); }
}
