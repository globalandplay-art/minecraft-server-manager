import { DomainError } from "./domain-errors.js";
import type { TransactionJournalRecord } from "./transaction-journal.js";

const invalid = () => new DomainError(409, "RECOVERY_REQUIRED", "Activation history requires inspection", "world-activation-history-unverified", true);

/** Structural evidence only. Never grants physical recovery confirmation or
 * permission to execute. The caller must also validate scan issues, every
 * protection snapshot, catalog bindings and current filesystem evidence. */
export function orderedActivationHistory(serverId: string, records: readonly TransactionJournalRecord[]): readonly TransactionJournalRecord[] {
  const history = records.filter(record => record.intent.serverId === serverId && record.intent.worldActivation);
  const ids = new Set<string>(), operations = new Set<string>(), guards = new Set<string>();
  for (const record of history) {
    const value = record.intent.worldActivation!;
    const id = record.transactionId.toLowerCase(), operation = record.intent.operationId.toLowerCase(), guard = value.guardBackupId.toLowerCase();
    if (record.state !== "committed" || ids.has(id) || operations.has(operation) || guards.has(guard) ||
        !Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.worldId === value.previousWorldId) throw invalid();
    ids.add(id); operations.add(operation); guards.add(guard);
  }
  history.sort((a, b) => a.intent.worldActivation!.sequence - b.intent.worldActivation!.sequence);
  const first = history[0]?.intent.worldActivation;
  // A world name is not an identity. Retain a bijection across the entire chain,
  // including inactive worlds that are absent from the most recent transition.
  const worlds = new Map<string, { name: string; directory: string }>();
  const names = new Map<string, string>(), directories = new Map<string, string>();
  const bind = (id: string, name: string, directory: string) => {
    const old = worlds.get(id), normalized = name.normalize("NFC").toLowerCase();
    if ((old && (old.name !== name || old.directory !== directory)) ||
        (names.has(normalized) && names.get(normalized) !== id) ||
        (directories.has(directory) && directories.get(directory) !== id)) throw invalid();
    worlds.set(id, { name, directory }); names.set(normalized, id); directories.set(directory, id);
  };
  for (const [index, record] of history.entries()) {
    const value = record.intent.worldActivation!, previous = history[index - 1];
    if (value.sequence !== index + 1 || value.rootIdentity !== first!.rootIdentity || value.catalogId !== first!.catalogId ||
        (previous ? value.predecessorTransactionId?.toLowerCase() !== previous.transactionId.toLowerCase() ||
          value.previousWorldId !== previous.intent.worldActivation!.worldId : value.predecessorTransactionId !== null)) throw invalid();
    bind(value.previousWorldId, value.previousName, value.currentDirectoryIdentity);
    bind(value.worldId, value.nextName, value.targetDirectoryIdentity);
  }
  return history;
}
