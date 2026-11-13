import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { worldIdentity, type ActiveWorldState } from "../src/services/active-world-state-store.js";
import { allocateWorldIdentity, verifyReplacementCatalogSnapshot, WorldLibraryStore } from "../src/services/world-library-store.js";
import type { TransactionJournalRecord } from "../src/services/transaction-journal.js";
import { replacementCheckpoints } from "../src/services/world-transition-records.js";
import { directoryObjectIdentity } from "../src/services/backup-identity.js";
import { readPrivatePropertiesFile } from "../src/services/properties-private-file.js";
import { verifyReplacementAdmissionFiles, verifyReplacementApprovalFiles, verifyReplacementApprovalSnapshots } from "../src/services/world-replacement-approval.js";

const roots: string[] = [], clock = { now: () => new Date("2026-10-26T00:00:00Z") };
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "lt-head-")); roots.push(root);
  const manager = path.join(root, "manager"), server = path.join(root, "server");
  await mkdir(manager); await mkdir(server); await mkdir(path.join(server, "world"));
  await writeFile(path.join(server, "world", "level.dat"), "isolated fixture");
  const binding = { serverId: "head-test", rootPath: server }, store = new WorldLibraryStore(manager, clock);
  const state: ActiveWorldState = { schemaVersion: 1, serverId: binding.serverId, state: "active", levelName: "world", worldId: worldIdentity(binding.serverId, "world") };
  await store.migrateLegacy(binding, state);
  const initial = await store.list(binding, state), importedId = allocateWorldIdentity();
  await mkdir(path.join(server, "Imported")); await writeFile(path.join(server, "Imported", "level.dat"), "isolated fixture");
  await store.recordInstalled(binding, { worldId: importedId, levelName: "Imported", operationId: randomUUID(), expectedRevision: initial.revision! });
  const list = await store.list(binding, state), old = await store.activationBinding(binding, initial.activeWorldId!, list.revision!);
  const target = await store.activationBinding(binding, importedId, list.revision!);
  const file = path.join(manager, "world-library", binding.serverId, "state.json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  // Head publication unit only: no physical transaction completion is implied.
  const record = { schemaVersion: 10, transactionId: randomUUID(), state: "active", checkpoints: [], intent: {
    operationId: randomUUID(), serverId: binding.serverId, kind: "world-activate", worldActivation: { sequence: 1, predecessorTransactionId: null,
      catalogId: saved.catalogId, rootIdentity: saved.rootIdentity, libraryRevision: list.revision!, previousWorldId: initial.activeWorldId!, worldId: importedId,
      previousName: "world", nextName: "Imported", currentDirectoryIdentity: old.directoryIdentity,
      targetDirectoryIdentity: target.directoryIdentity, guardBackupId: randomUUID() } } } as unknown as TransactionJournalRecord;
  return { manager, binding, state, store, file, revision: list.revision!, record };
}
const committed = (record: TransactionJournalRecord): TransactionJournalRecord => ({ ...record, state: "committed" });
async function replacementReservation(f: Awaited<ReturnType<typeof fixture>>) {
  const a = f.record.intent.worldActivation!, operationId = randomUUID(), worldId = allocateWorldIdentity();
  return { schemaVersion: 12, transactionId: randomUUID(), state: "active", updatedAt: clock.now().toISOString(), checkpoints: [],
    intent: { operationId, serverId: f.binding.serverId, kind: "world-replace", scope: "world-set", resourceId: worldId,
      allowStop: false, originalState: "stopped", createdAt: clock.now().toISOString(), paths: [], worldReplacement: {
        rootIdentity: a.rootIdentity, catalogId: a.catalogId, worldId, previousWorldId: a.previousWorldId, levelName: "world", confirmationName: "world",
        libraryRevision: f.revision, currentWorldRevision: "1".repeat(64), currentContentChecksum: "2".repeat(64),
        currentDirectoryIdentity: a.currentDirectoryIdentity, currentObjectIdentity: await directoryObjectIdentity(path.join(f.binding.rootPath, "world")),
        propertiesRevision: "3".repeat(64), propertiesChecksum: "4".repeat(64), uploadId: randomUUID(), uploadRevision: "5".repeat(64),
        importedChecksum: "6".repeat(64), minecraftVersion: "26.3", guardBackupId: randomUUID(), sequence: 1, predecessorTransactionId: null,
        workspaceName: `.manager-world-replace-${operationId}` } } } as TransactionJournalRecord;
}
describe("catalog activation tail publication (not execution acceptance)", () => {
  it.each(["valid", "invalid-catalog"])("combines actual approval copies with catalog semantics: %s", async scenario => {
    const f = await fixture(), record = await replacementReservation(f), value = record.intent.worldReplacement!;
    const workspace = path.join(f.binding.rootPath, value.workspaceName), properties = "level-name=world\nmotd=Keep\n";
    await mkdir(workspace); await writeFile(path.join(f.binding.rootPath, "server.properties"), properties);
    const originalProperties = await readPrivatePropertiesFile(path.join(f.binding.rootPath, "server.properties")); originalProperties.bytes.fill(0);
    const active = JSON.stringify(f.state), catalog = JSON.parse(await readFile(f.file, "utf8"));
    await mkdir(path.join(f.manager, "active-worlds"));
    const activePath = path.join(f.manager, "active-worlds", `${f.binding.serverId}.json`); await writeFile(activePath, active);
    const activeOriginal = await readPrivatePropertiesFile(activePath), catalogOriginal = await readPrivatePropertiesFile(f.file);
    activeOriginal.bytes.fill(0); catalogOriginal.bytes.fill(0);
    if (scenario === "invalid-catalog") catalog.serverId = "other-instance";
    const catalogText = JSON.stringify(catalog) + "\n", digest = (text: string) => createHash("sha256").update(text).digest("hex");
    Object.assign(record, { schemaVersion: 13 });
    Object.assign(value, { libraryRevision: digest(catalogText), propertiesChecksum: originalProperties.checksum,
      propertiesRevision: digest(`${originalProperties.identity}\0${originalProperties.checksum}`), approval: { schemaVersion: 1,
        propertiesIdentity: originalProperties.identity, activeStateIdentity: activeOriginal.identity, activeStateChecksum: digest(active), catalogFileIdentity: catalogOriginal.identity } });
    record.checkpoints.push({ sequence: 1, name: "replacement-intent-persisted", recordedAt: clock.now().toISOString(), details: { resourceId: value.worldId } });
    record.checkpoints.push({ sequence: 2, name: "replacement-workspace-created", recordedAt: clock.now().toISOString(),
      details: { resourceId: value.worldId, filesystemIdentity: await directoryObjectIdentity(workspace) } });
    for (const [file, step, bytes] of [["properties.before", "replacement-properties-before-verified", properties],
      ["catalog.before", "replacement-catalog-before-verified", catalogText], ["active.before", "replacement-active-before-verified", active]]) {
      await writeFile(path.join(workspace, file!), bytes!);
      const copy = await readPrivatePropertiesFile(path.join(workspace, file!)); copy.bytes.fill(0);
      record.checkpoints.push({ sequence: record.checkpoints.length + 1, name: step!, recordedAt: clock.now().toISOString(),
        details: { resourceId: value.worldId, checksumSha256: copy.checksum, filesystemIdentity: copy.identity } });
    }
    await expect(verifyReplacementApprovalFiles(record, f.binding.rootPath)).resolves.toBeDefined();
    if (scenario === "invalid-catalog") await expect(verifyReplacementApprovalSnapshots(record, f.binding.rootPath, [])).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    else {
      const proof = await verifyReplacementApprovalSnapshots(record, f.binding.rootPath, []); await proof.recheck();
      expect(proof.recordDigest).toBe(digest(JSON.stringify(record)));
      const admission = await verifyReplacementAdmissionFiles(record, f.binding.rootPath, f.manager, []); await admission.recheck();
      // Each original identity is distinct from its immutable copy identity.
      for (const originalPath of [activePath, path.join(f.binding.rootPath, "server.properties"), f.file]) {
        const bytes = await readFile(originalPath);
        await rename(originalPath, originalPath + ".retained"); await writeFile(originalPath, bytes);
        await expect(admission.recheck()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
        await expect(verifyReplacementAdmissionFiles(record, f.binding.rootPath, f.manager, [])).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
        await rm(originalPath); await rename(originalPath + ".retained", originalPath); await admission.recheck();
      }
      await expect(f.store.reserveReplacement(f.binding, f.revision, record, [])).rejects.toThrow();
      await expect(f.store.reserveReplacement(f.binding, f.revision, record, [], { ...admission, recordDigest: "0".repeat(64) })).rejects.toThrow();
      const wrongPhase = { ...admission }; Object.assign(wrongPhase, { phase: "after-reservation" });
      await expect(f.store.reserveReplacement(f.binding, f.revision, record, [], wrongPhase)).rejects.toThrow();
      const originalCatalogBytes = await readFile(f.file), retainedCatalog = path.join(f.manager, `retained-catalog-${randomUUID()}.json`);
      const queuedRace = { ...admission, recheck: async () => {
        await admission.recheck();
        // Keep the original outside the strict catalog directory: rejection
        // must be the file-object CAS check, not an unexpected-directory-entry check.
        await rename(f.file, retainedCatalog); await writeFile(f.file, originalCatalogBytes);
      } };
      try {
        await expect(f.store.reserveReplacement(f.binding, f.revision, record, [], queuedRace)).rejects.toThrow();
        expect(await readFile(f.file)).toEqual(originalCatalogBytes);
      } finally { await rm(f.file); await rename(retainedCatalog, f.file); }
      await admission.recheck();
      const spyable = f.store as unknown as { physical: (binding: typeof f.binding, name: string) => Promise<string> };
      const originalPhysical = spyable.physical.bind(f.store);
      const laterRace = vi.spyOn(spyable, "physical").mockImplementationOnce(async (binding, name) => {
        const identity = await originalPhysical(binding, name);
        await rename(f.file, retainedCatalog); await writeFile(f.file, originalCatalogBytes);
        return identity;
      });
      try {
        await expect(f.store.reserveReplacement(f.binding, f.revision, record, [], admission)).rejects.toThrow();
        expect(await readFile(f.file)).toEqual(originalCatalogBytes);
      } finally { laterRace.mockRestore(); await rm(f.file); await rename(retainedCatalog, f.file); }
      await admission.recheck();
      const pendingRevision = await f.store.reserveReplacement(f.binding, f.revision, record, [], admission);
      expect(pendingRevision).not.toBe(f.revision);
      const pendingCatalog = JSON.parse(await readFile(f.file, "utf8"));
      expect(pendingCatalog.entries).toEqual(catalog.entries); expect(pendingCatalog.transitionHead.state).toBe("pending");
      // Publication changes the original catalog: admission may not be reused.
      await expect(admission.recheck()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
      // Snapshot content proof remains valid; it has a narrower contract.
      await proof.recheck();
      await writeFile(path.join(workspace, "catalog.before"), "changed");
      await expect(proof.recheck()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    }
    expect(await readFile(path.join(f.binding.rootPath, "server.properties"), "utf8")).toBe(properties);
  });
  it.each(["valid", "wrong-digest", "wrong-root", "wrong-catalog", "duplicate-id", "duplicate-name", "retired-orphan", "replaced-orphan", "reused-new-id", "wrong-current", "ambiguous-json"])("verifies immutable approval catalog semantics: %s", async scenario => {
    const f = await fixture(), record = await replacementReservation(f), catalog = JSON.parse(await readFile(f.file, "utf8"));
    Object.assign(record, { schemaVersion: 13 }); Object.assign(record.intent.worldReplacement!, { approval: { schemaVersion: 1 } });
    const value = record.intent.worldReplacement!, before = await readFile(f.file, "utf8");
    if (scenario === "wrong-root") catalog.rootIdentity = "0".repeat(64);
    if (scenario === "wrong-catalog") catalog.catalogId = randomUUID();
    if (scenario === "duplicate-id") catalog.entries.push(structuredClone(catalog.entries[0]));
    if (scenario === "duplicate-name") catalog.entries.push({ ...catalog.entries[0], worldId: allocateWorldIdentity() });
    if (scenario === "retired-orphan") catalog.entries[0].state = "retired";
    if (scenario === "replaced-orphan") catalog.entries[1].replacesWorldId = allocateWorldIdentity();
    if (scenario === "reused-new-id") { value.worldId = catalog.entries[1].worldId; record.intent.resourceId = value.worldId; }
    if (scenario === "wrong-current") value.previousWorldId = allocateWorldIdentity();
    const text = scenario === "ambiguous-json" ? '{"schemaVersion":0,' + JSON.stringify(catalog).slice(1) : JSON.stringify(catalog) + "\n";
    value.libraryRevision = scenario === "wrong-digest" ? "0".repeat(64) : createHash("sha256").update(text).digest("hex");
    const bytes = Buffer.from(text);
    if (scenario === "valid") expect(() => verifyReplacementCatalogSnapshot(bytes, record, [])).not.toThrow();
    else expect(() => verifyReplacementCatalogSnapshot(bytes, record, [])).toThrow(expect.objectContaining({ code: "RECOVERY_REQUIRED" }));
    expect(bytes.toString()).toBe(text); expect(await readFile(f.file, "utf8")).toBe(before);
  });
  it("binds snapshot admission to the exact original nonempty journal prefix", async () => {
    const f = await fixture(), reserved = await f.store.reserveActivation(f.binding, f.revision, f.record, []), prefix = [committed(f.record)];
    const revision = await f.store.completeActivation(f.binding, reserved, prefix), bytes = await readFile(f.file);
    const record = await replacementReservation(f), value = record.intent.worldReplacement!, a = f.record.intent.worldActivation!;
    Object.assign(record, { schemaVersion: 13 }); Object.assign(value, { approval: { schemaVersion: 1 }, libraryRevision: revision,
      sequence: 2, predecessorTransactionId: f.record.transactionId, previousWorldId: a.worldId, levelName: a.nextName,
      confirmationName: a.nextName, currentDirectoryIdentity: a.targetDirectoryIdentity });
    expect(() => verifyReplacementCatalogSnapshot(bytes, record, prefix)).not.toThrow();
    expect(() => verifyReplacementCatalogSnapshot(bytes, record, [])).toThrow();
    const changed = structuredClone(prefix); changed[0]!.updatedAt = "different";
    expect(() => verifyReplacementCatalogSnapshot(bytes, record, changed)).toThrow();
    const reused = structuredClone(record); reused.intent.worldReplacement!.guardBackupId = a.guardBackupId;
    expect(() => verifyReplacementCatalogSnapshot(bytes, reused, prefix)).toThrow();
    expect(await readFile(f.file)).toEqual(bytes);
  });
  it.each(["valid", "wrong-current", "guard-reuse", "operation-reuse"])("binds replacement reservation to nonempty history: %s", async scenario => {
    const f = await fixture(), firstRevision = await f.store.reserveActivation(f.binding, f.revision, f.record, []);
    const history = [committed(f.record)], revision = await f.store.completeActivation(f.binding, firstRevision, history);
    const record = await replacementReservation(f), a = f.record.intent.worldActivation!, value = record.intent.worldReplacement!;
    Object.assign(value, { previousWorldId: a.worldId, levelName: a.nextName, confirmationName: a.nextName,
      currentDirectoryIdentity: a.targetDirectoryIdentity, currentObjectIdentity: await directoryObjectIdentity(path.join(f.binding.rootPath, a.nextName)),
      libraryRevision: revision, sequence: 2, predecessorTransactionId: f.record.transactionId });
    const before = await readFile(f.file, "utf8");
    if (scenario === "wrong-current") Object.assign(value, { previousWorldId: a.previousWorldId, levelName: a.previousName, confirmationName: a.previousName,
      currentDirectoryIdentity: a.currentDirectoryIdentity, currentObjectIdentity: await directoryObjectIdentity(path.join(f.binding.rootPath, a.previousName)) });
    if (scenario === "guard-reuse") value.guardBackupId = a.guardBackupId;
    if (scenario === "operation-reuse") record.intent.operationId = f.record.intent.operationId;
    if (scenario === "valid") {
      await f.store.reserveReplacement(f.binding, revision, record, history);
      const after = JSON.parse(await readFile(f.file, "utf8"));
      expect(after.entries).toEqual(JSON.parse(before).entries);
      expect(after.transitionHead).toMatchObject({ sequence: 2, state: "pending", previousDigest: createHash("sha256").update(JSON.stringify(history)).digest("hex") });
    } else {
      await expect(f.store.reserveReplacement(f.binding, revision, record, history)).rejects.toThrow();
      expect(await readFile(f.file, "utf8")).toBe(before);
    }
  });
  it("reserves replacement-first without retiring identities or changing world data and stays gated on reopen", async () => {
    const f = await fixture(), record = await replacementReservation(f), before = JSON.parse(await readFile(f.file, "utf8"));
    const worldBytes = await readFile(path.join(f.binding.rootPath, "world", "level.dat"));
    const revision = await f.store.reserveReplacement(f.binding, f.revision, record, []);
    const saved = JSON.parse(await readFile(f.file, "utf8"));
    expect(saved.entries).toEqual(before.entries); expect(revision).not.toBe(f.revision);
    expect(saved.schemaVersion).toBe(3); expect(saved.transitionHead).toMatchObject({ state: "pending", recordDigest: null, transactionId: record.transactionId });
    expect((await new WorldLibraryStore(f.manager, clock).list(f.binding, f.state)).state).toBe("inspection-required");
    expect(await readFile(path.join(f.binding.rootPath, "world", "level.dat"))).toEqual(worldBytes);
    const bytes = await readFile(f.file, "utf8");
    await expect(f.store.reserveReplacement(f.binding, revision, record, [])).rejects.toThrow();
    await expect(f.store.completeActivation(f.binding, revision, [committed(record)])).rejects.toThrow();
    expect(await readFile(f.file, "utf8")).toBe(bytes);
  });
  it.each(["revision", "old-id", "object", "directory", "confirmation", "duplicate-id", "resource", "sequence", "predecessor", "committed", "checkpoint"])("does not publish an unsafe replacement reservation: %s", async problem => {
    const f = await fixture(), record = await replacementReservation(f), value = record.intent.worldReplacement!;
    const before = await readFile(f.file, "utf8");
    switch (problem) {
      case "revision": value.libraryRevision = "0".repeat(64); break;
      case "old-id": value.previousWorldId = allocateWorldIdentity(); break;
      case "object": value.currentObjectIdentity = "0".repeat(64); break;
      case "directory": value.currentDirectoryIdentity = "0".repeat(64); break;
      case "confirmation": value.confirmationName = "Imported"; break;
      case "duplicate-id": value.worldId = value.previousWorldId; record.intent.resourceId = value.worldId; break;
      case "resource": record.intent.resourceId = allocateWorldIdentity(); break;
      case "sequence": value.sequence = 2; break;
      case "predecessor": value.predecessorTransactionId = randomUUID(); break;
      case "committed": record.state = "committed"; break;
      case "checkpoint": record.checkpoints.push({ sequence: 1, name: "unexpected", recordedAt: clock.now().toISOString() }); break;
    }
    await expect(f.store.reserveReplacement(f.binding, f.revision, record, [])).rejects.toThrow();
    expect(await readFile(f.file, "utf8")).toBe(before);
  });
  it("projects an exact mixed head without claiming that synthetic markers prove a physical replacement", async () => {
    const f = await fixture(), catalog = JSON.parse(await readFile(f.file, "utf8"));
    const old = catalog.entries.find((entry: { worldId: string }) => entry.worldId === f.record.intent.worldActivation!.previousWorldId);
    const worldId = allocateWorldIdentity(), operationId = randomUUID(), transactionId = randomUUID(), guardBackupId = randomUUID();
    const value = { rootIdentity: catalog.rootIdentity, catalogId: catalog.catalogId, worldId, previousWorldId: old.worldId,
      levelName: old.levelName, confirmationName: old.levelName, libraryRevision: f.revision, currentWorldRevision: "1".repeat(64),
      currentContentChecksum: "2".repeat(64), currentDirectoryIdentity: old.directoryIdentity, currentObjectIdentity: "3".repeat(64),
      propertiesRevision: "4".repeat(64), propertiesChecksum: "5".repeat(64), uploadId: randomUUID(), uploadRevision: "6".repeat(64),
      importedChecksum: "7".repeat(64), minecraftVersion: "26.3" as const, guardBackupId, sequence: 1, predecessorTransactionId: null,
      workspaceName: `.manager-world-replace-${operationId}` };
    const object = "8".repeat(64), directory = "9".repeat(64);
    const record: TransactionJournalRecord = { schemaVersion: 12, transactionId, state: "committed", updatedAt: clock.now().toISOString(),
      intent: { operationId, serverId: f.binding.serverId, kind: "world-replace", scope: "world-set", resourceId: worldId,
        allowStop: false, originalState: "stopped", createdAt: clock.now().toISOString(), paths: [], worldReplacement: value },
      checkpoints: replacementCheckpoints.map((name, index) => ({ name, sequence: index + 1, recordedAt: clock.now().toISOString(),
        details: { resourceId: worldId, ...([1, 5, 9, 10].includes(index) ? { checksumSha256: value.importedChecksum } :
          index === 7 ? { checksumSha256: value.currentContentChecksum } : index === 2 ? { checksumSha256: "ab".repeat(32) } : index === 3 ? { checksumSha256: "0".repeat(64) } : {}),
        ...([5, 9].includes(index) ? { filesystemIdentity: object } : index === 7 ? { filesystemIdentity: value.currentObjectIdentity } :
          index === 10 ? { filesystemIdentity: directory } : [2, 3, 4].includes(index) ? { filesystemIdentity: "ef".repeat(32) } : {}) } })) };
    old.state = "retired";
    catalog.entries.push({ worldId, levelName: old.levelName, state: "present", origin: "import", createdAt: clock.now().toISOString(),
      legacySlotId: null, legacyBackupAssociation: "unverified", directoryIdentity: directory, operationId,
      replacesWorldId: old.worldId, admissionRevision: f.revision });
    const hash = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
    catalog.schemaVersion = 3; catalog.transitionHead = { sequence: 1, transactionId, intentDigest: hash(record.intent),
      previousDigest: hash([]), state: "committed", recordDigest: hash([record]) };
    await writeFile(f.file, JSON.stringify(catalog)); const bytes = await readFile(f.file, "utf8"), store = new WorldLibraryStore(f.manager, clock);
    const projected = await store.projectTransitionHistory(f.binding, [record]);
    expect(projected.activeWorldId).toBe(worldId); expect(projected.retiredWorldIds).toEqual([old.worldId]);
    const nextReplacement = await replacementReservation(f);
    Object.assign(nextReplacement, { schemaVersion: 13 });
    Object.assign(nextReplacement.intent.worldReplacement!, { approval: { schemaVersion: 1 }, previousWorldId: worldId,
      currentDirectoryIdentity: directory, libraryRevision: createHash("sha256").update(bytes).digest("hex"), sequence: 2, predecessorTransactionId: transactionId });
    expect(() => verifyReplacementCatalogSnapshot(Buffer.from(bytes), nextReplacement, [record])).not.toThrow();
    const downgraded = { ...JSON.parse(bytes), schemaVersion: 2, activationHead: catalog.transitionHead };
    delete downgraded.transitionHead;
    const downgradedBytes = Buffer.from(JSON.stringify(downgraded));
    nextReplacement.intent.worldReplacement!.libraryRevision = createHash("sha256").update(downgradedBytes).digest("hex");
    expect(() => verifyReplacementCatalogSnapshot(downgradedBytes, nextReplacement, [record])).toThrow(expect.objectContaining({ code: "RECOVERY_REQUIRED" }));
    // Metadata projection cannot make the old actual directory the new object.
    expect((await store.list(f.binding, f.state)).state).toBe("inspection-required");
    expect(await readFile(f.file, "utf8")).toBe(bytes);
    const altered = structuredClone(record); Object.assign(altered.checkpoints[5]!.details!, { filesystemIdentity: "0".repeat(64) });
    await expect(store.projectTransitionHistory(f.binding, [altered])).rejects.toThrow();
    expect(await readFile(f.file, "utf8")).toBe(bytes);
    catalog.entries.find((entry: { worldId: string }) => entry.worldId === worldId).replacesWorldId = allocateWorldIdentity();
    await writeFile(f.file, JSON.stringify(catalog)); const corrupt = await readFile(f.file, "utf8");
    await expect(new WorldLibraryStore(f.manager, clock).projectTransitionHistory(f.binding, [record])).rejects.toThrow();
    expect(await readFile(f.file, "utf8")).toBe(corrupt);
    for (const state of ["retired", "present"] as const) {
      const orphan = JSON.parse(bytes);
      orphan.entries.push({ worldId: allocateWorldIdentity(), levelName: "orphan-world", state, origin: "import",
        createdAt: clock.now().toISOString(), legacySlotId: null, legacyBackupAssociation: "unverified",
        directoryIdentity: "a".repeat(64), operationId: randomUUID(), admissionRevision: f.revision,
        replacesWorldId: state === "present" ? old.worldId : null });
      await writeFile(f.file, JSON.stringify(orphan)); const retained = await readFile(f.file, "utf8");
      await expect(new WorldLibraryStore(f.manager, clock).projectTransitionHistory(f.binding, [record])).rejects.toThrow();
      expect(await readFile(f.file, "utf8")).toBe(retained);
    }
    // Dedicated invalidation is metadata-only and binds the exact published
    // revision plus the complete original mixed history, not only an intent.
    await writeFile(f.file, bytes);
    const invalidator = new WorldLibraryStore(f.manager, clock), staleRevision = "0".repeat(64);
    const exactRevision = createHash("sha256").update(bytes).digest("hex");
    await expect(invalidator.invalidateReplacement(f.binding, staleRevision, [record])).rejects.toThrow();
    const otherHead = structuredClone(record); otherHead.transactionId = randomUUID();
    await expect(invalidator.invalidateReplacement(f.binding, exactRevision, [otherHead])).rejects.toThrow();
    const drift = structuredClone(record); drift.updatedAt = "changed";
    await expect(invalidator.invalidateReplacement(f.binding, exactRevision, [drift])).rejects.toThrow();
    expect(await readFile(f.file, "utf8")).toBe(bytes);
    const journalBytes = JSON.stringify(record);
    await invalidator.invalidateReplacement(f.binding, exactRevision, [record]);
    const pendingBytes = await readFile(f.file, "utf8"), pendingCatalog = JSON.parse(pendingBytes);
    expect(pendingCatalog.entries).toEqual(JSON.parse(bytes).entries);
    expect(pendingCatalog.transitionHead).toMatchObject({ state: "pending", recordDigest: null });
    expect(JSON.stringify(record)).toBe(journalBytes);
    expect((await new WorldLibraryStore(f.manager, clock).list(f.binding, f.state)).state).toBe("inspection-required");
    await expect(invalidator.invalidateReplacement(f.binding, exactRevision, [record])).rejects.toThrow();
    expect(await readFile(f.file, "utf8")).toBe(pendingBytes);
    await invalidator.invalidateReplacement(f.binding, createHash("sha256").update(pendingBytes).digest("hex"), [record]);
    expect(await readFile(f.file, "utf8")).toBe(pendingBytes);
  });
  it("reads legacy schema2 unchanged, completes it in place and migrates only on the next reservation", async () => {
    const f = await fixture(), reserved = await f.store.reserveActivation(f.binding, f.revision, f.record, []);
    const done = committed(f.record); await f.store.completeActivation(f.binding, reserved, [done]);
    const modern = JSON.parse(await readFile(f.file, "utf8"));
    const legacy = { ...modern, schemaVersion: 2, activationHead: modern.transitionHead }; delete legacy.transitionHead;
    await writeFile(f.file, JSON.stringify(legacy));
    const before = await readFile(f.file, "utf8"), store = new WorldLibraryStore(f.manager, clock);
    await store.auditActivationHead(f.binding, [done]); await store.projectLegacyTransitions(f.binding, [done]);
    await store.projectTransitionHistory(f.binding, [done]);
    expect(await readFile(f.file, "utf8")).toBe(before);
    await store.invalidateActivation(f.binding, f.record);
    const pending = JSON.parse(await readFile(f.file, "utf8")); expect(pending.schemaVersion).toBe(2);
    expect(pending.transitionHead).toBeUndefined(); expect(pending.activationHead.state).toBe("pending");
    const observed = new WorldLibraryStore(f.manager, clock);
    // Read the known owned file's revision without treating pending state as ready.
    const revision = createHash("sha256").update(await readFile(f.file)).digest("hex");
    const completedRevision = await observed.completeActivation(f.binding, revision, [done]);
    expect(JSON.parse(await readFile(f.file, "utf8")).schemaVersion).toBe(2);
    const next = structuredClone(f.record), old = done.intent.worldActivation!;
    Object.assign(next, { transactionId: randomUUID() }); Object.assign(next.intent, { operationId: randomUUID() });
    Object.assign(next.intent.worldActivation!, { sequence: 2, predecessorTransactionId: done.transactionId, libraryRevision: completedRevision,
      previousWorldId: old.worldId, worldId: old.previousWorldId, previousName: old.nextName, nextName: old.previousName,
      currentDirectoryIdentity: old.targetDirectoryIdentity, targetDirectoryIdentity: old.currentDirectoryIdentity, guardBackupId: randomUUID() });
    await observed.reserveActivation(f.binding, completedRevision, next, [done]);
    const migrated = JSON.parse(await readFile(f.file, "utf8"));
    expect(migrated.schemaVersion).toBe(3); expect(migrated.activationHead).toBeUndefined();
    expect(migrated.transitionHead.state).toBe("pending");
    expect(JSON.stringify(done)).toBe(JSON.stringify(committed(f.record)));
  });
  it.each(["mixed", "schema1-head", "schema2-new-head", "schema3-old-head", "schema3-missing-head"])("rejects %s before head selection", async mode => {
    const f = await fixture(), reserved = await f.store.reserveActivation(f.binding, f.revision, f.record, []);
    const done = committed(f.record); await f.store.completeActivation(f.binding, reserved, [done]);
    const value = JSON.parse(await readFile(f.file, "utf8"));
    if (mode === "mixed") value.activationHead = value.transitionHead;
    if (mode === "schema1-head") value.schemaVersion = 1;
    if (mode === "schema2-new-head") value.schemaVersion = 2;
    if (mode === "schema3-old-head") { value.activationHead = value.transitionHead; delete value.transitionHead; }
    if (mode === "schema3-missing-head") delete value.transitionHead;
    await writeFile(f.file, JSON.stringify(value)); const bytes = await readFile(f.file, "utf8"), store = new WorldLibraryStore(f.manager, clock);
    expect((await store.list(f.binding, f.state)).state).toBe("inspection-required");
    await expect(store.auditActivationHead(f.binding, [done])).rejects.toThrow();
    expect(await readFile(f.file, "utf8")).toBe(bytes);
  });
  it("normalizes only observed legacy UUIDs while digesting unchanged original evidence", async () => {
    const f = await fixture(), reserved = await f.store.reserveActivation(f.binding, f.revision, f.record, []);
    const done = committed(f.record); await f.store.completeActivation(f.binding, reserved, [done]);
    const value = JSON.parse(await readFile(f.file, "utf8")), upper = structuredClone(done);
    Object.assign(upper, { transactionId: upper.transactionId.toUpperCase() });
    Object.assign(upper.intent, { operationId: upper.intent.operationId.toUpperCase() });
    Object.assign(upper.intent.worldActivation!, { catalogId: upper.intent.worldActivation!.catalogId.toUpperCase(),
      guardBackupId: upper.intent.worldActivation!.guardBackupId.toUpperCase() });
    const hash = (item: unknown) => createHash("sha256").update(JSON.stringify(item)).digest("hex");
    value.schemaVersion = 2; value.activationHead = { ...value.transitionHead, transactionId: upper.transactionId,
      intentDigest: hash(upper.intent), recordDigest: hash([upper]) }; delete value.transitionHead;
    await writeFile(f.file, JSON.stringify(value)); const bytes = await readFile(f.file, "utf8"), journal = JSON.stringify(upper);
    const projected = await new WorldLibraryStore(f.manager, clock).projectLegacyTransitions(f.binding, [upper]);
    expect(projected.transactionIds).toEqual([upper.transactionId.toLowerCase()]);
    expect(await readFile(f.file, "utf8")).toBe(bytes); expect(JSON.stringify(upper)).toBe(journal);
  });
  it("projects legacy schema1 and schema2 only after exact original journal/head verification", async () => {
    const f = await fixture(), initial = await readFile(f.file, "utf8");
    expect(await f.store.projectLegacyTransitions(f.binding, [])).toMatchObject({ activeWorldId: null, transactionIds: [] });
    expect(await readFile(f.file, "utf8")).toBe(initial);
    const reserved = await f.store.reserveActivation(f.binding, f.revision, f.record, []);
    await expect(f.store.projectLegacyTransitions(f.binding, [committed(f.record)])).rejects.toThrow();
    const done = committed(f.record); await f.store.completeActivation(f.binding, reserved, [done]);
    const bytes = await readFile(f.file, "utf8"), restart = new WorldLibraryStore(f.manager, clock);
    const observed = await restart.projectLegacyTransitions(f.binding, [done]);
    expect(observed.activeWorldId).toBe(done.intent.worldActivation!.worldId);
    expect(observed.transactionIds).toEqual([done.transactionId]);
    expect(await readFile(f.file, "utf8")).toBe(bytes);
    const changed = structuredClone(done); Object.assign(changed.intent, { createdAt: "changed" });
    await expect(restart.projectLegacyTransitions(f.binding, [changed])).rejects.toThrow();
    expect(await readFile(f.file, "utf8")).toBe(bytes);
  });
  it("reserves before apply, keeps pending gated across reconstruction, completes and detects deleted tail", async () => {
    const f = await fixture(), revision = await f.store.reserveActivation(f.binding, f.revision, f.record, []);
    const restarted = new WorldLibraryStore(f.manager, clock);
    expect((await restarted.list(f.binding, f.state)).state).toBe("inspection-required");
    await expect(restarted.auditActivationHead(f.binding, [])).rejects.toThrow();
    const done = committed(f.record);
    await restarted.completeActivation(f.binding, revision, [done]);
    await new WorldLibraryStore(f.manager, clock).auditActivationHead(f.binding, [done]);
    await expect(new WorldLibraryStore(f.manager, clock).auditActivationHead(f.binding, [])).rejects.toThrow();
    const saved = JSON.parse(await readFile(f.file, "utf8"));
    expect(saved.schemaVersion).toBe(3); expect(saved.activationHead).toBeUndefined();
    expect(saved.transitionHead.state).toBe("committed");
  });
  it("rejects stale approval and historical adoption without mutating legacy bytes", async () => {
    const f = await fixture(), before = await readFile(f.file, "utf8");
    await expect(f.store.reserveActivation(f.binding, "0".repeat(64), f.record, [])).rejects.toThrow();
    const staleIntent = structuredClone(f.record); Object.assign(staleIntent.intent.worldActivation!, { libraryRevision: "0".repeat(64) });
    await expect(f.store.reserveActivation(f.binding, f.revision, staleIntent, [])).rejects.toThrow();
    await expect(f.store.auditActivationHead(f.binding, [committed(f.record)])).rejects.toThrow();
    expect(await readFile(f.file, "utf8")).toBe(before);
    await f.store.auditActivationHead(f.binding, []);
  });
  it("persists final-check failure without rewriting terminal journal evidence or another head", async () => {
    const f = await fixture(), reserved = await f.store.reserveActivation(f.binding, f.revision, f.record, []);
    const done = committed(f.record); await f.store.completeActivation(f.binding, reserved, [done]);
    const before = await readFile(f.file, "utf8");
    await expect(f.store.invalidateActivation(f.binding, { ...f.record, transactionId: randomUUID() })).rejects.toThrow();
    expect(await readFile(f.file, "utf8")).toBe(before);
    await f.store.invalidateActivation(f.binding, f.record);
    const pendingBytes = await readFile(f.file, "utf8");
    await f.store.invalidateActivation(f.binding, f.record);
    expect(await readFile(f.file, "utf8")).toBe(pendingBytes);
    const restart = new WorldLibraryStore(f.manager, clock);
    expect((await restart.list(f.binding, f.state)).state).toBe("inspection-required");
    await expect(restart.auditActivationHead(f.binding, [done])).rejects.toThrow();
    expect(done.state).toBe("committed");
  });
  it("advances only from the exact head and detects a truncated prefix or rolled-back catalog", async () => {
    const f = await fixture(), reserved = await f.store.reserveActivation(f.binding, f.revision, f.record, []);
    const first = committed(f.record), revision = await f.store.completeActivation(f.binding, reserved, [first]);
    const firstBytes = await readFile(f.file, "utf8"), old = first.intent.worldActivation!;
    const next = structuredClone(f.record);
    Object.assign(next, { transactionId: randomUUID() });
    Object.assign(next.intent, { operationId: randomUUID() });
    Object.assign(next.intent.worldActivation!, { sequence: 2, predecessorTransactionId: first.transactionId,
      libraryRevision: revision,
      previousWorldId: old.worldId, worldId: old.previousWorldId, previousName: old.nextName, nextName: old.previousName,
      currentDirectoryIdentity: old.targetDirectoryIdentity, targetDirectoryIdentity: old.currentDirectoryIdentity, guardBackupId: randomUUID() });
    const secondReserved = await f.store.reserveActivation(f.binding, revision, next, [first]);
    const second = committed(next); await f.store.completeActivation(f.binding, secondReserved, [first, second]);
    await new WorldLibraryStore(f.manager, clock).auditActivationHead(f.binding, [second, first]);
    await expect(new WorldLibraryStore(f.manager, clock).auditActivationHead(f.binding, [first])).rejects.toThrow();
    const finalBytes = await readFile(f.file, "utf8");
    const alteredFirst = structuredClone(first); Object.assign(alteredFirst.intent, { createdAt: "tampered" });
    await expect(new WorldLibraryStore(f.manager, clock).auditActivationHead(f.binding, [alteredFirst, second])).rejects.toThrow();
    await writeFile(f.file, firstBytes);
    await expect(new WorldLibraryStore(f.manager, clock).auditActivationHead(f.binding, [first, second])).rejects.toThrow();
    // Restore only this known test-owned file, preserving the rejected bytes in
    // variables for assertions. No product repair path is exercised.
    await writeFile(f.file, finalBytes);
  });
  it("keeps partial publication and pending imports blocked without deleting evidence", async () => {
    const f = await fixture(); await f.store.reserveActivation(f.binding, f.revision, f.record, []);
    const before = await readFile(f.file, "utf8");
    await expect(f.store.completeActivation(f.binding, f.revision, [committed(f.record)])).rejects.toThrow();
    await expect(f.store.recordInstalled(f.binding, { worldId: allocateWorldIdentity(), levelName: "Imported", operationId: randomUUID(), expectedRevision: f.revision })).rejects.toThrow();
    expect(await readFile(f.file, "utf8")).toBe(before);
  });
  it("rejects changed intent between reservation and completion", async () => {
    const f = await fixture(), revision = await f.store.reserveActivation(f.binding, f.revision, f.record, []);
    const changed = structuredClone(committed(f.record)); Object.assign(changed.intent, { createdAt: "changed" });
    await expect(f.store.completeActivation(f.binding, revision, [changed])).rejects.toThrow();
    expect((await new WorldLibraryStore(f.manager, clock).list(f.binding, f.state)).state).toBe("inspection-required");
  });
  it("detects changed terminal evidence and refuses unsafe repair of schema mismatch", async () => {
    const f = await fixture(), revision = await f.store.reserveActivation(f.binding, f.revision, f.record, []);
    const done = committed(f.record); await f.store.completeActivation(f.binding, revision, [done]);
    await expect(f.store.auditActivationHead(f.binding, [{ ...done, updatedAt: "altered" }])).rejects.toThrow();
    const saved = JSON.parse(await readFile(f.file, "utf8")); saved.schemaVersion = 1;
    await writeFile(f.file, JSON.stringify(saved));
    expect((await new WorldLibraryStore(f.manager, clock).list(f.binding, f.state)).state).toBe("inspection-required");
    expect(JSON.parse(await readFile(f.file, "utf8")).schemaVersion).toBe(1);
  });
});
