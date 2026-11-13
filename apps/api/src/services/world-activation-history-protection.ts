import type { AdapterRegistry } from "../adapters/registry.js";
import { backupDirectoryIdentity } from "./backup-identity.js";
import type { BackupService } from "./backup-service.js";
import { DomainError } from "./domain-errors.js";
import { orderedActivationHistory } from "./world-activation-history.js";
import { verifyActivationProtection } from "./world-activation-protection.js";
import type { TransactionJournalStore } from "./transaction-journal.js";
import type { WorldLibraryStore } from "./world-library-store.js";
import { activationSourceEvidence } from "./world-activation-source.js";
import { inventoryRestoreTree, restoreFilesChecksum } from "./restore-files.js";
import path from "node:path";

const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Historical activation protection requires inspection", "world-activation-history-protection-unverified", true);

/** Backend-only read-only protection pass. Does NOT accept active state, live
 * world contents, import birth evidence or clear operation recovery causes.
 * Caller owns instance admission; repeated execution/recovery needs all four. */
export class WorldActivationHistoryProtection {
  constructor(private readonly registry: AdapterRegistry, private readonly journal: TransactionJournalStore,
    private readonly library: WorldLibraryStore, private readonly backups: Pick<BackupService, "exportSource">,
    private readonly managerRoot: string) {}

  /** Inactive target content binding for a plan under the instance lease.
   * Returns import provenance when the caller must additionally verify its
   * original upload/birth evidence. Does not accept it on the caller's behalf. */
  async verifyTarget(serverId: string, worldId: string, revision: string) {
    const history = await this.verify(serverId), adapter = this.registry.getLocal(serverId)!;
    const binding = { serverId, rootPath: adapter.plan.rootPath };
    const target = await this.library.activationBinding(binding, worldId, revision);
    const scan = await this.journal.scan();
    if (scan.issues.some(issue => !issue.serverId || issue.serverId === serverId) ||
        JSON.stringify(orderedActivationHistory(serverId, scan.records)) !== JSON.stringify(history.records)) throw fail();
    const evidence = activationSourceEvidence(serverId, { ...target, worldId, rootIdentity: history.rootIdentity }, scan.records);
    if (restoreFilesChecksum(await inventoryRestoreTree(path.join(binding.rootPath, target.levelName))) !== evidence.checksum) throw fail();
    await this.library.activationBinding(binding, worldId, revision);
    return { ...evidence, historyProof: history };
  }

  async verify(serverId: string) {
    const adapter = this.registry.getLocal(serverId);
    if (!adapter || adapter.plan.serverInfo.type !== "vanilla" || adapter.plan.serverInfo.minecraftVersion !== "26.3") throw fail();
    const binding = { serverId, rootPath: adapter.plan.rootPath }, rootIdentity = await backupDirectoryIdentity(binding.rootPath);
    const stopped = async () => {
      const state = await adapter.getStatus();
      if (state.state !== "stopped" || state.ownership !== "none" || state.recoveryRequired ||
          await backupDirectoryIdentity(binding.rootPath) !== rootIdentity) throw fail();
    };
    const read = async () => {
      const scan = await this.journal.scan();
      if (scan.issues.some(issue => !issue.serverId || issue.serverId === serverId) ||
          scan.records.some(record => record.intent.serverId === serverId && (record.intent.worldArchive ||
            ["active", "recovery-required"].includes(record.state)))) throw fail();
      return scan.records.filter(record => record.intent.serverId === serverId);
    };
    await stopped();
    const records = await read(), history = orderedActivationHistory(serverId, records);
    if (!history.length || history.some(record => record.intent.worldActivation!.rootIdentity !== rootIdentity)) throw fail();
    await this.library.auditActivationHead(binding, records);
    const snapshot = JSON.stringify(records);
    const protection: Array<Awaited<ReturnType<typeof verifyActivationProtection>>> = [];
    for (const record of history) {
      await stopped();
      protection.push(await verifyActivationProtection(record, binding.rootPath, this.managerRoot, this.backups));
    }
    // Later guards may have awaited I/O. Revalidate earlier immutable evidence
    // before a caller consumes it; never cache a successful pass across calls.
    await this.library.auditActivationHead(binding, records);
    await stopped();
    if (JSON.stringify(await read()) !== snapshot) throw fail();
    for (const proof of protection) await proof.recheck();
    if (await backupDirectoryIdentity(binding.rootPath) !== rootIdentity) throw fail();
    const recheckProtection = async () => {
      // Used while a new pending head exists: do not accept or clear that head.
      // Every old journal and immutable protection must remain exactly bound.
      for (const record of history) {
        if (JSON.stringify(await this.journal.get(serverId, record.transactionId)) !== JSON.stringify(record)) throw fail();
      }
      for (const proof of protection) await proof.recheck();
      if (await backupDirectoryIdentity(binding.rootPath) !== rootIdentity) throw fail();
    };
    return { records: structuredClone(history), rootIdentity, recheckProtection };
  }
}

export type WorldActivationHistoryProof = Awaited<ReturnType<WorldActivationHistoryProtection["verify"]>>;
