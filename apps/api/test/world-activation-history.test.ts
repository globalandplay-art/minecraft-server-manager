import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { orderedActivationHistory } from "../src/services/world-activation-history.js";
import { activationSourceEvidence } from "../src/services/world-activation-source.js";
import type { TransactionJournalRecord, TransactionJournalStore } from "../src/services/transaction-journal.js";
import { WorldActivationReconciler } from "../src/services/world-activation-reconciler.js";

// Structural fixtures only: no physical recovery or successful activation is
// inferred from these deliberately minimal in-memory records.
const catalogId = randomUUID(), a = `worldv2-${randomUUID()}`, b = `worldv2-${randomUUID()}`, c = `worldv2-${randomUUID()}`;
function transition(sequence: number, previous: TransactionJournalRecord | null, from: string, to: string): TransactionJournalRecord {
  return { transactionId: randomUUID(), state: "committed", intent: { operationId: randomUUID(), serverId: "test",
    worldActivation: { sequence, predecessorTransactionId: previous?.transactionId ?? null, catalogId, rootIdentity: "root",
      previousWorldId: from, worldId: to, previousName: from, nextName: to,
      currentDirectoryIdentity: `dir-${from}`, targetDirectoryIdentity: `dir-${to}`, guardBackupId: randomUUID(),
      currentContentChecksum: `${sequence}`.repeat(64) } } } as TransactionJournalRecord;
}
function chain() {
  const first = transition(1, null, a, b), second = transition(2, first, b, c), third = transition(3, second, c, a);
  return [first, second, third];
}
describe("activation structural history (not physical acceptance)", () => {
  it("does not supersede an untouched import with other worlds' repeated activations", async () => {
    const records = chain(), untouched = `worldv2-${randomUUID()}`;
    const source = { transactionId: randomUUID(), intent: { serverId: "test", worldLibraryImport: { worldId: untouched } } } as TransactionJournalRecord;
    const scan = { records, issues: [] as Array<{ fileName: string; serverId: string }> };
    // Only the non-supersession decision is tested. Null collaborators ensure
    // this fixture cannot be mistaken for physical evidence acceptance.
    const reconciler = new WorldActivationReconciler(null!, null!, { scan: async () => scan } as TransactionJournalStore,
      null!, null!, null!, "unused-structural-fixture");
    expect(await reconciler.verifiesSupersession(source)).toBeNull();
    await expect(reconciler.verifiesSupersession({ ...source, intent: { ...source.intent, worldLibraryImport: { ...source.intent.worldLibraryImport!, worldId: b } } }))
      .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    scan.issues.push({ fileName: "unverified", serverId: "test" });
    await expect(reconciler.verifiesSupersession(source)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  const target = (worldId: string) => ({ worldId, catalogId, rootIdentity: "root", levelName: worldId,
    directoryIdentity: `dir-${worldId}`, origin: "legacy-observation" as const, operationId: null });
  it("selects original-world guard without inventing an import identity", () => {
    const records = chain().slice(0, 2), first = records[0]!;
    expect(activationSourceEvidence("test", target(a), records)).toEqual({ kind: "activation-guard",
      transactionId: first.transactionId, guardBackupId: first.intent.worldActivation!.guardBackupId, checksum: "1".repeat(64) });
  });
  it("selects latest departure rather than obsolete birth contents", () => {
    const records = chain(), fourth = transition(4, records[2]!, a, b); records.push(fourth);
    expect(activationSourceEvidence("test", target(a), records)).toMatchObject({ transactionId: fourth.transactionId, checksum: "4".repeat(64) });
  });
  it.each(["valid", "wrong-transaction", "wrong-guard", "wrong-checksum", "future-source"])("checks guard source across transitions: %s", mode => {
    const records = chain(), first = records[0]!, last = records[2]!.intent.worldActivation!;
    Object.assign(last, { sourceImportTransactionId: null, sourceImportChecksum: null, targetContentChecksum: "1".repeat(64),
      sourceGuard: { transactionId: first.transactionId, guardBackupId: first.intent.worldActivation!.guardBackupId, checksum: "1".repeat(64) } });
    if (mode === "wrong-transaction") last.sourceGuard!.transactionId = randomUUID();
    if (mode === "wrong-guard") last.sourceGuard!.guardBackupId = randomUUID();
    if (mode === "wrong-checksum") last.sourceGuard!.checksum = "9".repeat(64);
    if (mode === "future-source") last.sourceGuard!.transactionId = records[2]!.transactionId;
    if (mode === "valid") expect(orderedActivationHistory("test", records)).toEqual(records);
    else expect(() => orderedActivationHistory("test", records)).toThrow();
  });
  it("rejects an active target, missing original departure and directory rebinding", () => {
    const records = chain().slice(0, 2);
    expect(() => activationSourceEvidence("test", target(c), records)).toThrow();
    expect(() => activationSourceEvidence("test", target(a), [])).toThrow();
    expect(() => activationSourceEvidence("test", { ...target(a), directoryIdentity: "replacement" }, records)).toThrow();
  });
  it("binds first imported source to the exact server and owning operation", () => {
    const operationId = randomUUID(), transactionId = randomUUID();
    const imported = { transactionId, state: "committed", intent: { serverId: "test", operationId,
      worldLibraryImport: { worldId: a, rootIdentity: "root", targetName: a, importedChecksum: "a".repeat(64) } } } as TransactionJournalRecord;
    const binding = { ...target(a), origin: "import" as const, operationId };
    expect(activationSourceEvidence("test", binding, [imported])).toEqual({ kind: "import", transactionId, checksum: "a".repeat(64) });
    expect(() => activationSourceEvidence("other", binding, [imported])).toThrow();
    expect(() => activationSourceEvidence("test", binding, [imported, imported])).toThrow();
  });
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
