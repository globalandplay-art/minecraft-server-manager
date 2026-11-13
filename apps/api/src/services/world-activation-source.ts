import { DomainError } from "./domain-errors.js";
import { orderedActivationHistory } from "./world-activation-history.js";
import type { TransactionJournalRecord } from "./transaction-journal.js";

export type ActivationSourceEvidence =
  | { kind: "import"; transactionId: string; checksum: string }
  | { kind: "activation-guard"; transactionId: string; guardBackupId: string; checksum: string };
type Target = { worldId: string; catalogId: string; rootIdentity: string; levelName: string; directoryIdentity: string;
  origin: "legacy-observation" | "import"; operationId: string | null };
const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "World source evidence requires inspection", "world-activation-source-unverified", true);

/** Selects evidence to verify, not permission to activate. Callers must validate
 * the durable history head and physically verify the returned source and live
 * content before recording any new intent. Never treats a guard as an import. */
export function activationSourceEvidence(serverId: string, target: Target,
  records: readonly TransactionJournalRecord[]): ActivationSourceEvidence {
  const history = orderedActivationHistory(serverId, records);
  if (history.some(record => record.intent.worldActivation!.catalogId !== target.catalogId ||
      record.intent.worldActivation!.rootIdentity !== target.rootIdentity)) throw fail();
  if (history.at(-1)?.intent.worldActivation!.worldId === target.worldId) throw fail();
  // The last departure captures the last accepted contents of this now-inactive
  // world. Earlier birth/import hashes need not describe later Minecraft saves.
  const departure = [...history].reverse().find(record => record.intent.worldActivation!.previousWorldId === target.worldId);
  if (departure) {
    const value = departure.intent.worldActivation!;
    if (value.previousName !== target.levelName || value.currentDirectoryIdentity !== target.directoryIdentity) throw fail();
    return { kind: "activation-guard", transactionId: departure.transactionId,
      guardBackupId: value.guardBackupId, checksum: value.currentContentChecksum };
  }
  if (target.origin === "legacy-observation" || !target.operationId) throw fail();
  const owners = records.filter(record => record.intent.serverId === serverId && record.intent.operationId === target.operationId);
  if (owners.length !== 1) throw fail();
  const record = owners[0]!, imported = record.intent.worldLibraryImport;
  if (record.state !== "committed" || !imported || imported.worldId !== target.worldId ||
      imported.rootIdentity !== target.rootIdentity || imported.targetName !== target.levelName) throw fail();
  return { kind: "import", transactionId: record.transactionId, checksum: imported.importedChecksum };
}
