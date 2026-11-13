import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { TransactionJournalRecord } from "../src/services/transaction-journal.js";
import { orderedWorldTransitionRecords, replacementCheckpoints, replacementExecutionCheckpoints, replacementTransitionEvent } from "../src/services/world-transition-records.js";

const catalogId = randomUUID(), rootIdentity = "1".repeat(64), now = "2026-10-27T00:00:00Z";
type World = { id: string; name: string; directory: string; object: string };
const world = (name: string, digit: string): World => ({ id: `worldv2-${randomUUID()}`, name, directory: digit.repeat(64), object: `${digit}a`.repeat(32) });
const nextSequence = (parent?: TransactionJournalRecord) => (parent?.intent.worldActivation?.sequence ?? parent?.intent.worldReplacement?.sequence ?? 0) + 1;
function replace(previous: World, next: World, parent?: TransactionJournalRecord): TransactionJournalRecord {
  const operationId = randomUUID(), transactionId = randomUUID();
  const value = { rootIdentity, catalogId, worldId: next.id, previousWorldId: previous.id, levelName: previous.name, confirmationName: previous.name,
    libraryRevision: "2".repeat(64), currentWorldRevision: "3".repeat(64), currentContentChecksum: "4".repeat(64),
    currentDirectoryIdentity: previous.directory, currentObjectIdentity: previous.object, propertiesRevision: "5".repeat(64),
    propertiesChecksum: "6".repeat(64), uploadId: randomUUID(), uploadRevision: "7".repeat(64), importedChecksum: "8".repeat(64),
    minecraftVersion: "26.3" as const, guardBackupId: randomUUID(), sequence: nextSequence(parent),
    predecessorTransactionId: parent?.transactionId ?? null, workspaceName: `.manager-world-replace-${operationId}` };
  const checkpoints = replacementCheckpoints.map((name, index) => ({ name, sequence: index + 1, recordedAt: now,
    details: { resourceId: next.id, ...([1, 5, 9, 10].includes(index) ? { checksumSha256: value.importedChecksum } :
      index === 7 ? { checksumSha256: value.currentContentChecksum } : index === 2 ? { checksumSha256: "ab".repeat(32) } : index === 3 ? { checksumSha256: "0".repeat(64) } : {}),
    ...([5, 9].includes(index) ? { filesystemIdentity: next.object } : index === 7 ? { filesystemIdentity: previous.object } :
      index === 10 ? { filesystemIdentity: next.directory } : [2, 3, 4].includes(index) ? { filesystemIdentity: "ef".repeat(32) } : {}) } }));
  return { schemaVersion: 12, transactionId, state: "committed", updatedAt: now, checkpoints,
    intent: { operationId, serverId: "test", kind: "world-replace", scope: "world-set", resourceId: next.id,
      allowStop: false, originalState: "stopped", createdAt: now, paths: [], worldReplacement: value } };
}
function activate(previous: World, next: World, parent?: TransactionJournalRecord): TransactionJournalRecord {
  const operationId = randomUUID();
  return { schemaVersion: 10, transactionId: randomUUID(), state: "committed", updatedAt: now, checkpoints: [],
    intent: { operationId, serverId: "test", kind: "world-activate", scope: "world-set", resourceId: next.id, allowStop: false,
      originalState: "stopped", createdAt: now, paths: [], worldActivation: { rootIdentity, catalogId, worldId: next.id,
        previousWorldId: previous.id, previousName: previous.name, nextName: next.name, libraryRevision: "2".repeat(64),
        currentWorldRevision: "3".repeat(64), targetWorldRevision: "3".repeat(64), currentContentChecksum: "4".repeat(64),
        targetContentChecksum: "4".repeat(64), currentDirectoryIdentity: previous.directory, targetDirectoryIdentity: next.directory,
        sourceImportTransactionId: randomUUID(), sourceImportChecksum: "4".repeat(64), predecessorTransactionId: parent?.transactionId ?? null,
        sequence: nextSequence(parent), guardBackupId: randomUUID(), propertiesBefore: "5".repeat(64), propertiesAfter: "6".repeat(64),
        workspaceName: `.manager-world-activate-${operationId}` } } };
}
function chain() {
  const a = world("world", "a"), b = world("world", "b"), c = world("Imported", "c"), d = world("Imported", "d");
  const first = replace(a, b), departure = activate(b, c, first), third = replace(c, d, departure), last = activate(d, b, third);
  Object.assign(last, { schemaVersion: 11 });
  Object.assign(last.intent.worldActivation!, { sourceImportTransactionId: null, sourceImportChecksum: null,
    sourceGuard: { transactionId: departure.transactionId, guardBackupId: departure.intent.worldActivation!.guardBackupId,
      checksum: departure.intent.worldActivation!.currentContentChecksum } });
  return { a, b, c, d, records: [first, departure, third, last] };
}
describe("mixed original journal projection, structural only", () => {
  it.each(["activation", "replacement"] as const)("binds the first %s to the immutable generated genesis and preserves original bytes", kind => {
    const previous = world("Original", "a"), generated = world("Generated", "b"), imported = world("Imported", "c");
    const next = kind === "replacement" ? { ...imported, name: generated.name } : imported;
    const event = kind === "replacement" ? replace(generated, next) : activate(generated, next);
    const genesis = { serverId: "test", catalogId, rootIdentity, activeWorldId: generated.id,
      worlds: [previous, generated].map(item => ({ worldId: item.id, levelName: item.name, directoryIdentity: item.directory })) };
    const original = JSON.stringify(event), result = orderedWorldTransitionRecords("test", [event], genesis);
    expect(result[0]).toBe(event); expect(JSON.stringify(event)).toBe(original);
    // An otherwise valid first transition cannot choose the old inactive world.
    expect(() => orderedWorldTransitionRecords("test", [event], { ...genesis, activeWorldId: previous.id })).toThrow();
    const rebind = { ...genesis, worlds: genesis.worlds.map(item => item.worldId === generated.id
      ? { ...item, directoryIdentity: "d".repeat(64) } : item) };
    expect(() => orderedWorldTransitionRecords("test", [event], rebind)).toThrow();
  });
  it("checks genesis even when there are no successor records", () => {
    const a = world("Original", "a"), b = world("Generated", "b");
    const genesis = { serverId: "test", catalogId, rootIdentity, activeWorldId: b.id,
      worlds: [a, b].map(item => ({ worldId: item.id, levelName: item.name, directoryIdentity: item.directory })) };
    expect(orderedWorldTransitionRecords("test", [], genesis)).toEqual([]);
    expect(() => orderedWorldTransitionRecords("test", [], { ...genesis, serverId: "other" })).toThrow();
  });
  it.each(["valid", "legacy-marker-order", "missing-approval", "copy-checksum", "copy-identity", "original-revision", "downgraded", "wrong-order"])("validates explicitly versioned schema13 structure: %s", scenario => {
    const previous = world("world", "a"), next = world("world", "b"), base = replace(previous, next), before = JSON.stringify(base);
    const approval = { schemaVersion: 1 as const, propertiesIdentity: "a".repeat(64), activeStateIdentity: "b".repeat(64),
      activeStateChecksum: "c".repeat(64), catalogFileIdentity: "d".repeat(64) };
    const value = { ...base.intent.worldReplacement!, approval,
      propertiesRevision: createHash("sha256").update(`${approval.propertiesIdentity}\0${base.intent.worldReplacement!.propertiesChecksum}`).digest("hex") };
    const record: TransactionJournalRecord = { ...base, schemaVersion: 13, intent: { ...base.intent, worldReplacement: value },
      checkpoints: replacementExecutionCheckpoints.map((name, index) => {
        const old = base.checkpoints.find(point => point.name === name);
        const checksum = name === "replacement-properties-before-verified" ? value.propertiesChecksum :
          name === "replacement-catalog-before-verified" ? value.libraryRevision : name === "replacement-active-before-verified" ? approval.activeStateChecksum : undefined;
        return { name, sequence: index + 1, recordedAt: now, details: old ? { ...old.details! } :
          { resourceId: value.worldId, ...(checksum ? { checksumSha256: checksum, filesystemIdentity: "e".repeat(64) } : {}) } };
      }) };
    if (scenario === "legacy-marker-order") Object.assign(record, { checkpoints: structuredClone(base.checkpoints) });
    if (scenario === "missing-approval") Reflect.deleteProperty(value, "approval");
    if (scenario === "copy-checksum") record.checkpoints[3]!.details!.checksumSha256 = "0".repeat(64);
    if (scenario === "copy-identity") Reflect.deleteProperty(record.checkpoints[4]!.details!, "filesystemIdentity");
    if (scenario === "original-revision") value.propertiesRevision = "f".repeat(64);
    if (scenario === "downgraded") Object.assign(record, { schemaVersion: 12 });
    if (scenario === "wrong-order") Object.assign(record.checkpoints[0]!, { name: "replacement-head-reserved" });
    if (scenario === "valid") {
      expect(replacementTransitionEvent(record).next.worldId).toBe(next.id);
      expect(orderedWorldTransitionRecords("test", [record])).toEqual([record]);
    } else expect(() => replacementTransitionEvent(record)).toThrow(expect.objectContaining({ code: "RECOVERY_REQUIRED" }));
    expect(JSON.stringify(base)).toBe(before);
  });
  it("orders replacement-first and activation/retirement records without rewriting original evidence", () => {
    const f = chain(), input = [...f.records].reverse(), before = JSON.stringify(input);
    const result = orderedWorldTransitionRecords("test", input);
    expect(result).toEqual(f.records); expect(result[0]).toBe(f.records[0]); expect(JSON.stringify(input)).toBe(before);
    const event = replacementTransitionEvent(f.records[0]!);
    expect(event.previous.directoryIdentity).toBe(f.a.directory);
    expect(event.next.directoryIdentity).toBe(f.b.directory); expect(event.next.directoryIdentity).not.toBe(f.b.object);
  });
  it.each(["missing", "extra", "order", "resource", "source-checksum", "malformed-guard-checksum", "preserved-object", "installed-object",
    "path-versus-object", "collapsed-identities", "missing-guard-identity", "missing-manifest-proof", "missing-workspace-proof", "partial", "schema"])("rejects invalid checkpoint protocol: %s", problem => {
    const f = chain(), record = structuredClone(f.records[0]!);
    switch (problem) {
      case "missing": (record.checkpoints as unknown[]).pop(); break;
      case "extra": (record.checkpoints as unknown[]).push(record.checkpoints[0]); break;
      case "order": Object.assign(record.checkpoints[6]!, { name: "replacement-install-intent" }); break;
      case "resource": Object.assign(record.checkpoints[0]!.details!, { resourceId: f.a.id }); break;
      case "source-checksum": Object.assign(record.checkpoints[1]!.details!, { checksumSha256: "0".repeat(64) }); break;
      case "malformed-guard-checksum": Object.assign(record.checkpoints[2]!.details!, { checksumSha256: "malformed" }); break;
      case "preserved-object": Object.assign(record.checkpoints[7]!.details!, { filesystemIdentity: f.b.object }); break;
      case "installed-object": Object.assign(record.checkpoints[9]!.details!, { filesystemIdentity: f.a.object }); break;
      case "path-versus-object": Object.assign(record.checkpoints[10]!.details!, { filesystemIdentity: f.a.directory }); break;
      case "collapsed-identities": Object.assign(record.checkpoints[10]!.details!, { filesystemIdentity: f.b.object }); break;
      case "missing-guard-identity": Reflect.deleteProperty(record.checkpoints[2]!.details!, "filesystemIdentity"); break;
      case "missing-manifest-proof": Reflect.deleteProperty(record.checkpoints[3]!.details!, "checksumSha256"); break;
      case "missing-workspace-proof": Reflect.deleteProperty(record.checkpoints[4]!.details!, "filesystemIdentity"); break;
      case "partial": Object.assign(record, { state: "active" }); break;
      case "schema": Object.assign(record, { schemaVersion: 11 }); break;
    }
    expect(() => replacementTransitionEvent(record)).toThrow(expect.objectContaining({ code: "RECOVERY_REQUIRED" }));
  });
  it.each(["guard-transaction", "guard-id", "guard-checksum", "retired-target", "lost-replacement", "fork"])("rejects mixed-chain drift: %s", problem => {
    const f = chain(), last = f.records[3]!.intent.worldActivation!;
    switch (problem) {
      case "guard-transaction": Object.assign(last.sourceGuard!, { transactionId: randomUUID() }); break;
      case "guard-id": Object.assign(last.sourceGuard!, { guardBackupId: randomUUID() }); break;
      case "guard-checksum": Object.assign(last.sourceGuard!, { checksum: "0".repeat(64) }); break;
      case "retired-target": Object.assign(last, { worldId: f.a.id, nextName: f.a.name, targetDirectoryIdentity: f.a.directory }); break;
      case "lost-replacement": f.records.splice(2, 1); break;
      case "fork": f.records.push({ ...f.records[2]!, transactionId: randomUUID() }); break;
    }
    expect(() => orderedWorldTransitionRecords("test", f.records)).toThrow(expect.objectContaining({ code: "RECOVERY_REQUIRED" }));
  });
  it("keeps the legacy-only route's source guard validation", () => {
    const a = world("world", "a"), b = world("Imported", "b"), first = activate(a, b), second = activate(b, a, first);
    expect(orderedWorldTransitionRecords("test", [second, first])).toEqual([first, second]);
    Object.assign(second.intent.worldActivation!, { sourceGuard: { transactionId: randomUUID(), guardBackupId: randomUUID(), checksum: "4".repeat(64) } });
    expect(() => orderedWorldTransitionRecords("test", [first, second])).toThrow();
  });
});
