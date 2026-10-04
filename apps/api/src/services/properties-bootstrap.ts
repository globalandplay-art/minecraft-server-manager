import type { RawServerConfig } from "../config/local-config.js";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import type { JournalScanResult, TransactionJournalStore } from "./transaction-journal.js";
import type { Operation } from "@mcsm/contracts";
import { establishedPropertiesOutcome, verifyCommittedProperties } from "./properties-reconciliation.js";

/** Before launch-plan construction: only physically proven committed records may proceed; never repairs files. */
export async function assertPropertiesBootstrapSafety(configs: readonly RawServerConfig[], scan: JournalScanResult,
  context?: { managerRoot: string; journal: TransactionJournalStore; outcomes: readonly Operation[] }): Promise<void> {
  for (const config of configs) {
    const records = scan.records.filter((record) => record.intent.serverId === config.id && record.intent.kind === "properties-write");
    if (!records.length && !scan.issues.some((issue) => issue.serverId === config.id)) continue;
    let reason = "properties-transaction-requires-inspection";
    if (records.length) {
      try {
        const identity = await backupDirectoryIdentity(config.root);
        if (records.some((record) => record.intent.propertiesWrite?.rootIdentity !== identity)) reason = "properties-root-binding-mismatch";
      } catch { reason = "properties-root-unverifiable"; }
    }
    if (context && records.length && !scan.issues.some((issue) => issue.serverId === config.id) &&
      !reason.startsWith("properties-root-")) {
      try {
        for (const record of records) await verifyCommittedProperties(context.managerRoot, context.journal, record, config.root,
          establishedPropertiesOutcome(record, context.outcomes));
        continue;
      } catch { reason = "properties-terminal-layout-unverifiable"; }
    }
    // No fallback defaults, Java process or automatic repair on this path.
    throw new DomainError(409, "RECOVERY_REQUIRED", "配置事务需要人工恢复核验，管理器未开放启动入口", reason, true);
  }
}
