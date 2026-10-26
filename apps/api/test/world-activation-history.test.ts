import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { orderedActivationHistory } from "../src/services/world-activation-history.js";
import type { TransactionJournalRecord } from "../src/services/transaction-journal.js";

// Structural fixtures only: no physical recovery or successful activation is
// inferred from these deliberately minimal in-memory records.
const catalogId = randomUUID(), a = `worldv2-${randomUUID()}`, b = `worldv2-${randomUUID()}`, c = `worldv2-${randomUUID()}`;
function transition(sequence: number, previous: TransactionJournalRecord | null, from: string, to: string): TransactionJournalRecord {
  return { transactionId: randomUUID(), state: "committed", intent: { operationId: randomUUID(), serverId: "test",
    worldActivation: { sequence, predecessorTransactionId: previous?.transactionId ?? null, catalogId, rootIdentity: "root",
      previousWorldId: from, worldId: to, previousName: from, nextName: to,
      currentDirectoryIdentity: `dir-${from}`, targetDirectoryIdentity: `dir-${to}`, guardBackupId: randomUUID() } } } as TransactionJournalRecord;
}
function chain() {
  const first = transition(1, null, a, b), second = transition(2, first, b, c), third = transition(3, second, c, a);
  return [first, second, third];
}
describe("activation structural history (not physical acceptance)", () => {
  it("orders an unordered return-to-original chain without timestamps or mutating input", () => {
    const [first, second, third] = chain(), input = [third!, first!, second!];
    expect(orderedActivationHistory("test", input)).toEqual([first, second, third]);
    expect(input[0]).toBe(third);
    expect(orderedActivationHistory("other", input)).toEqual([]);
  });
  it.each(["missing-first", "missing-middle", "fork", "cycle", "duplicate", "unknown", "wrong-predecessor-world",
    "catalog-drift", "root-drift", "rebound-original", "alias", "directory-alias", "operation-reuse", "guard-reuse"])("rejects %s", problem => {
    const records = chain(), [first, second, third] = records;
    const one = first!.intent.worldActivation!, two = second!.intent.worldActivation!, three = third!.intent.worldActivation!;
    switch (problem) {
      case "missing-first": records.shift(); break;
      case "missing-middle": records.splice(1, 1); break;
      case "fork": three.sequence = 2; three.predecessorTransactionId = first!.transactionId; break;
      case "cycle": one.predecessorTransactionId = third!.transactionId; break;
      case "duplicate": records.push(first!); break;
      case "unknown": second!.state = "recovery-required"; break;
      case "wrong-predecessor-world": two.previousWorldId = a; break;
      case "catalog-drift": three.catalogId = randomUUID(); break;
      case "root-drift": three.rootIdentity = "changed"; break;
      case "rebound-original": three.targetDirectoryIdentity = "new-object"; break;
      case "alias": three.nextName = three.previousName; break;
      case "directory-alias": three.targetDirectoryIdentity = three.currentDirectoryIdentity; break;
      case "operation-reuse": third!.intent.operationId = first!.intent.operationId; break;
      case "guard-reuse": three.guardBackupId = one.guardBackupId; break;
    }
    expect(() => orderedActivationHistory("test", records)).toThrow(expect.objectContaining({ code: "RECOVERY_REQUIRED" }));
  });
});
