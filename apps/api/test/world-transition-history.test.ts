import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { activationTransitionEvents, projectWorldTransitions, projectWorldTransitionsFromGenesis, type TransitionWorld, type WorldTransitionEvent } from "../src/services/world-transition-history.js";
import type { TransactionJournalRecord } from "../src/services/transaction-journal.js";

const world = (levelName: string, digit: string): TransitionWorld => ({ worldId: `worldv2-${randomUUID()}`, levelName, directoryIdentity: digit.repeat(64) });
const catalogId = randomUUID(), rootIdentity = "a".repeat(64);
function event(kind: WorldTransitionEvent["kind"], previous: TransitionWorld, next: TransitionWorld,
  parent?: WorldTransitionEvent): WorldTransitionEvent {
  return { kind, serverId: "test", transactionId: randomUUID(), operationId: randomUUID(), guardBackupId: randomUUID(),
    catalogId, rootIdentity, sequence: (parent?.sequence ?? 0) + 1, predecessorTransactionId: parent?.transactionId ?? null,
    previous, next };
}
function chain() {
  const a = world("world", "1"), b = world("Imported", "2"), c = world("Imported", "3"), d = world("Another", "4");
  const first = event("activation", a, b), replacement = event("replacement", b, c, first), last = event("activation", c, d, replacement);
  return { a, b, c, d, first, replacement, last, records: [first, replacement, last] };
}
describe("structural world transition projection (no physical authority)", () => {
  it("starts at actual generated identity without inventing a transition", () => {
    const previous = world("Original", "1"), generated = world("Generated", "2");
    const genesis = { serverId: "test", catalogId, rootIdentity, activeWorldId: generated.worldId, worlds: [previous, generated] };
    const before = JSON.stringify(genesis), empty = projectWorldTransitionsFromGenesis("test", [], genesis);
    expect(empty).toEqual({ activeWorldId: generated.worldId, retiredWorldIds: [],
      worlds: [{ ...previous, state: "present" }, { ...generated, state: "present" }], transactionIds: [] });
    const first = event("activation", generated, previous), second = event("activation", previous, generated, first);
    expect(projectWorldTransitionsFromGenesis("test", [second, first], genesis).transactionIds).toEqual([first.transactionId, second.transactionId]);
    expect(JSON.stringify(genesis)).toBe(before);
  });
  it("retains generated retirement and the original world through a same-name replacement", () => {
    const original = world("Original", "1"), generated = world("Generated", "2"), replacement = world("Generated", "3");
    const genesis = { serverId: "test", catalogId, rootIdentity, activeWorldId: generated.worldId, worlds: [original, generated] };
    const first = event("replacement", generated, replacement);
    const result = projectWorldTransitionsFromGenesis("test", [first], genesis);
    expect(result.worlds).toContainEqual({ ...generated, state: "retired" });
    expect(result.worlds).toContainEqual({ ...original, state: "present" });
    expect(result.activeWorldId).toBe(replacement.worldId);
    expect(() => projectWorldTransitionsFromGenesis("test", [first, event("activation", replacement, generated, first)], genesis)).toThrow();
  });
  it.each(["wrong-active", "root", "catalog", "server", "duplicate-id", "name-alias", "directory-alias", "missing-world"])("rejects genesis %s", problem => {
    const previous = world("Original", "1"), generated = world("Generated", "2");
    const genesis = { serverId: "test", catalogId, rootIdentity, activeWorldId: generated.worldId, worlds: [previous, generated] };
    let first = event("activation", generated, previous);
    switch (problem) {
      case "wrong-active": first = event("activation", previous, generated); break;
      case "root": genesis.rootIdentity = "b".repeat(64); break;
      case "catalog": genesis.catalogId = randomUUID(); break;
      case "server": genesis.serverId = "other"; break;
      case "duplicate-id": genesis.worlds[1] = { ...generated, worldId: previous.worldId }; break;
      case "name-alias": genesis.worlds[1] = { ...generated, levelName: "original" }; break;
      case "directory-alias": genesis.worlds[1] = { ...generated, directoryIdentity: previous.directoryIdentity }; break;
      case "missing-world": genesis.worlds.pop(); break;
    }
    expect(() => projectWorldTransitionsFromGenesis("test", [first], genesis)).toThrow(expect.objectContaining({ code: "RECOVERY_REQUIRED" }));
  });
  it.each([12, 13])("rejects schema%s replacement evidence through activation-only projection", schemaVersion => {
    for (const marker of ["kind", "payload", "both"]) {
      // Deliberately incomplete records: rejection must precede activation-only
      // normalization even when only one replacement discriminator is present.
      const record = { schemaVersion, intent: { serverId: "test",
        ...(marker !== "payload" ? { kind: "world-replace" } : {}),
        ...(marker !== "kind" ? { worldReplacement: {} } : {}) } } as TransactionJournalRecord;
      const before = JSON.stringify(record);
      expect(() => activationTransitionEvents("test", [record])).toThrow(expect.objectContaining({ code: "RECOVERY_REQUIRED" }));
      expect(JSON.stringify(record)).toBe(before);
    }
  });
  it("preserves every old binding while explicit replacement releases only the live name", () => {
    const f = chain(), result = projectWorldTransitions("test", [f.last, f.first, f.replacement]);
    expect(result.activeWorldId).toBe(f.d.worldId); expect(result.retiredWorldIds).toEqual([f.b.worldId]);
    expect(result.worlds).toContainEqual({ ...f.b, state: "retired" });
    expect(result.worlds).toContainEqual({ ...f.c, state: "present" });
    expect(result.transactionIds).toEqual(f.records.map(record => record.transactionId));
  });
  it("supports replacement-first and repeated same-name retirement without reusing IDs", () => {
    const a = world("world", "1"), b = world("world", "2"), c = world("world", "3");
    const first = event("replacement", a, b), second = event("replacement", b, c, first);
    expect(projectWorldTransitions("test", [second, first])).toMatchObject({ activeWorldId: c.worldId, retiredWorldIds: [a.worldId, b.worldId] });
  });
  it("supports a normal activation roundtrip and leaves source objects/input order unchanged", () => {
    const a = world("world", "1"), b = world("Imported", "2"), first = event("activation", a, b);
    const second = event("activation", b, a, first), input = [second, first], before = JSON.stringify(input);
    expect(projectWorldTransitions("test", input).activeWorldId).toBe(a.worldId);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("projects old activation records only after their original source-guard checks pass", () => {
    const a = world("world", "1"), b = world("Imported", "2"), first = event("activation", a, b);
    const second = event("activation", b, a, first);
    const records = [first, second].map(item => ({ transactionId: item.transactionId, state: "committed", intent: {
      serverId: "test", operationId: item.operationId, worldActivation: { rootIdentity, catalogId,
        sequence: item.sequence, predecessorTransactionId: item.predecessorTransactionId, guardBackupId: item.guardBackupId,
        previousWorldId: item.previous.worldId, previousName: item.previous.levelName, currentDirectoryIdentity: item.previous.directoryIdentity,
        worldId: item.next.worldId, nextName: item.next.levelName, targetDirectoryIdentity: item.next.directoryIdentity,
        currentContentChecksum: "1".repeat(64), targetContentChecksum: "1".repeat(64) } } })) as TransactionJournalRecord[];
    expect(projectWorldTransitions("test", activationTransitionEvents("test", records)).activeWorldId).toBe(a.worldId);
    const uppercase = JSON.parse(JSON.stringify(records)) as TransactionJournalRecord[];
    for (const record of uppercase) {
      Object.assign(record, { transactionId: record.transactionId.toUpperCase() });
      Object.assign(record.intent, { operationId: record.intent.operationId.toUpperCase() });
      const transition = record.intent.worldActivation!;
      Object.assign(transition, { guardBackupId: transition.guardBackupId.toUpperCase(), catalogId: transition.catalogId.toUpperCase(),
        predecessorTransactionId: transition.predecessorTransactionId?.toUpperCase() ?? null });
    }
    const saved = JSON.stringify(uppercase);
    expect(projectWorldTransitions("test", activationTransitionEvents("test", uppercase)).activeWorldId).toBe(a.worldId);
    expect(JSON.stringify(uppercase)).toBe(saved);
    Object.assign(records[1]!.intent.worldActivation!, { sourceGuard: { transactionId: randomUUID(), guardBackupId: randomUUID(), checksum: "1".repeat(64) } });
    expect(() => activationTransitionEvents("test", records)).toThrow(expect.objectContaining({ code: "RECOVERY_REQUIRED" }));
  });
  it.each(["retired-target", "reused-id", "reused-directory", "case-alias", "implicit-retirement", "wrong-name",
    "missing-first", "missing-middle", "fork", "wrong-active", "foreign-server", "catalog-drift", "root-drift",
    "duplicate-operation", "duplicate-guard", "invalid-identity", "path-name"])("rejects %s", problem => {
    const f = chain(), records = [...f.records];
    const last = { ...f.last, previous: { ...f.last.previous }, next: { ...f.last.next } };
    records[2] = last;
    switch (problem) {
      case "retired-target": last.next = f.b; break;
      case "reused-id": records[1] = { ...f.replacement, next: { ...f.c, worldId: f.a.worldId } }; break;
      case "reused-directory": records[1] = { ...f.replacement, next: { ...f.c, directoryIdentity: f.b.directoryIdentity } }; break;
      case "case-alias": records[1] = { ...f.replacement, next: { ...f.c, levelName: "imported" } }; break;
      case "implicit-retirement": records[1] = { ...f.replacement, kind: "activation" }; break;
      case "wrong-name": records[1] = { ...f.replacement, next: { ...f.c, levelName: "Other" } }; break;
      case "missing-first": records.shift(); break;
      case "missing-middle": records.splice(1, 1); break;
      case "fork": records.push({ ...f.replacement, transactionId: randomUUID() }); break;
      case "wrong-active": last.previous = f.a; break;
      case "foreign-server": last.serverId = "other"; break;
      case "catalog-drift": last.catalogId = randomUUID(); break;
      case "root-drift": last.rootIdentity = "b".repeat(64); break;
      case "duplicate-operation": last.operationId = f.first.operationId; break;
      case "duplicate-guard": last.guardBackupId = f.first.guardBackupId; break;
      case "invalid-identity": last.next = { ...last.next, worldId: "world" }; break;
      case "path-name": last.next = { ...last.next, levelName: "../outside" }; break;
    }
    expect(() => projectWorldTransitions("test", records)).toThrow(expect.objectContaining({ code: "RECOVERY_REQUIRED" }));
  });
  it("has no active-world or recovery authority for an empty history", () => {
    expect(projectWorldTransitions("test", [])).toEqual({ activeWorldId: null, retiredWorldIds: [], worlds: [], transactionIds: [] });
  });
  it("never feeds mixed replacement history through the legacy-only adapter", () => {
    const record = { intent: { serverId: "test", kind: "world-replace" } } as unknown as TransactionJournalRecord;
    expect(() => activationTransitionEvents("test", [record])).toThrow(expect.objectContaining({ code: "RECOVERY_REQUIRED" }));
  });
  it("rejects malformed or oversized normalized histories with a fixed recovery error", () => {
    for (const bad of [[null], [{}], [{ sequence: NaN }], Array(10_001).fill(chain().first)]) {
      expect(() => projectWorldTransitions("test", bad as unknown as WorldTransitionEvent[]))
        .toThrow(expect.objectContaining({ code: "RECOVERY_REQUIRED" }));
    }
  });
});
