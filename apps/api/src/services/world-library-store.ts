import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, opendir, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { worldLibraryEntrySchema, type WorldLibraryEntry, type WorldLibraryResponse } from "@mcsm/contracts";
import type { Clock } from "../clock.js";
import type { ActiveWorldState } from "./active-world-state-store.js";
import { worldIdentity } from "./active-world-state-store.js";
import { backupDirectoryIdentity, directoryObjectIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { missingFile, plainRestoreDirectory, safeRestorePath, syncRestoreDirectory, writeRestoreJson } from "./restore-files.js";
import type { TransactionJournalRecord, TransactionJournalStore } from "./transaction-journal.js";
import { readWorldGenerationReservation, worldGenerationReservationSchema, type WorldGenerationReservation } from "./world-generation-reservation.js";
import { readGenerationExecution, validGenerationExecutionReceipt, worldGenerationExecutionSchema, type WorldGenerationExecution } from "./world-generation-execution.js";
import { readWorldLifecycleStopEvidence, type OperationStore } from "./operation-store.js";
import { matchesWorldLifecycleStop, validWorldLifecycleStopSeal } from "./world-lifecycle-receipt.js";
import { readGenerationBirth } from "./world-generation-birth.js";
import { orderedActivationHistory } from "./world-activation-history.js";
import { activationTransitionEvents, projectWorldTransitions, projectWorldTransitionsFromGenesis, type WorldTransitionEvent } from "./world-transition-history.js";
import { orderedWorldTransitionRecords, verifyReplacementAdmissionPrefix, worldTransitionEvent } from "./world-transition-records.js";
import { inspectIssuedGenerationReference } from "./world-generation-reference-issuer.js";
import { generationReferenceObjectWitness } from "./world-generation-genesis-reference.js";
import { inspectInitialMaturityPublicationMetadata } from "./world-generation-maturity-publication.js";

const hashSchema = Type.String({ pattern: "^[0-9a-f]{64}$" });
const storedEntrySchema = Type.Object({ ...worldLibraryEntrySchema.properties,
  directoryIdentity: hashSchema,
  replacesWorldId: Type.Union([worldLibraryEntrySchema.properties.worldId, Type.Null()]),
  admissionRevision: Type.Union([hashSchema, Type.Null()]),
  operationId: Type.Union([Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }), Type.Null()])
}, { additionalProperties: false });
const anchorSchema = Type.Object({ schemaVersion: Type.Literal(1), serverId: Type.String(),
  catalogId: Type.String({ pattern: "^[0-9a-f-]{36}$" }), rootIdentity: hashSchema
}, { additionalProperties: false });
const activationHeadSchema = Type.Object({ sequence: Type.Integer({ minimum: 1 }),
  transactionId: Type.String({ pattern: "^[0-9a-fA-F-]{36}$" }), intentDigest: hashSchema, previousDigest: hashSchema,
  state: Type.Union([Type.Literal("pending"), Type.Literal("committed")]),
  recordDigest: Type.Union([hashSchema, Type.Null()]) }, { additionalProperties: false });
const generationSchema = Type.Object({ reservation: worldGenerationReservationSchema, intentDigest: hashSchema, recordDigest: hashSchema }, { additionalProperties: false });
const publicationSchema = Type.Object({ birthChecksum: hashSchema, birthIdentity: hashSchema, entryDigest: hashSchema, admissionRevision: hashSchema }, { additionalProperties: false });
const recordSchema = Type.Object({ ...anchorSchema.properties, schemaVersion: Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3), Type.Literal(4), Type.Literal(5), Type.Literal(6)]),
  rootIdentity: hashSchema, entries: Type.Array(storedEntrySchema, { maxItems: 1000 }),
  activationHead: Type.Optional(activationHeadSchema), transitionHead: Type.Optional(activationHeadSchema), generation: Type.Optional(generationSchema),
  generationExecution: Type.Optional(worldGenerationExecutionSchema), generationPublication: Type.Optional(publicationSchema)
}, { additionalProperties: false });
// Deliberately separate: all ordinary readers/mutators still accept ONLY1..6.
const initialMatureSchema = Type.Object({ ...anchorSchema.properties, schemaVersion: Type.Literal(7),
  entries: Type.Array(storedEntrySchema, { minItems: 2, maxItems: 2 }),
  generationGenesis: Type.Object({ executionOperationId: worldGenerationExecutionSchema.properties.executionOperationId,
    worldId: worldLibraryEntrySchema.properties.worldId,
    issuer: Type.Object({ checksum: hashSchema, objectIdentity: hashSchema }, { additionalProperties: false })
  }, { additionalProperties: false })
}, { additionalProperties: false });
type StoredEntry = WorldLibraryEntry & { directoryIdentity: string; operationId: string | null; replacesWorldId: string | null; admissionRevision: string | null };
type InitialMatureCatalog = Static<typeof initialMatureSchema>;
type CatalogLifecycleEvidence = NonNullable<Awaited<ReturnType<typeof readWorldLifecycleStopEvidence>>>;
type ActivationHead = { sequence: number; transactionId: string; intentDigest: string; previousDigest: string; state: "pending" | "committed"; recordDigest: string | null };
type LibraryRecord = { schemaVersion: 1 | 2 | 3 | 4 | 5 | 6; serverId: string; catalogId: string; rootIdentity: string; entries: StoredEntry[];
  activationHead?: ActivationHead; transitionHead?: ActivationHead;
  generation?: { reservation: WorldGenerationReservation; intentDigest: string; recordDigest: string };
  generationExecution?: WorldGenerationExecution;
  generationPublication?: { birthChecksum: string; birthIdentity: string; entryDigest: string; admissionRevision: string } };
const headOf = (record: LibraryRecord): ActivationHead | undefined => record.generation ? {
  sequence: 1, transactionId: record.generation.reservation.transactionId, intentDigest: record.generation.intentDigest,
  previousDigest: digest("[]"), state: "pending", recordDigest: null
} : record.transitionHead ?? record.activationHead;
const withTransitionHead = (record: LibraryRecord, head: ActivationHead): LibraryRecord => {
  const next: LibraryRecord = { ...record, schemaVersion: 3, transitionHead: head };
  delete next.activationHead;
  return next;
};
const withExistingHead = (record: LibraryRecord, head: ActivationHead): LibraryRecord => record.schemaVersion === 3
  ? withTransitionHead(record, head) : { ...record, activationHead: head };
type Binding = { serverId: string; rootPath: string };
const unsafe = () => new DomainError(409, "RECOVERY_REQUIRED", "World identity requires inspection", "world-library-identity-unverified", true);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const validName = (value: string) => value.length <= 128 && !value.startsWith(".") &&
  !value.includes("/") && safeRestorePath(value) && value.normalize("NFC") === value;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const allocateWorldIdentity = () => `worldv2-${randomUUID()}`;

function checkRecordStructure(record: LibraryRecord, serverId: string): void {
  const head = headOf(record);
  if ((record.schemaVersion >= 4) !== (record.generation !== undefined) ||
      (record.schemaVersion >= 5) !== (record.generationExecution !== undefined) ||
      (record.schemaVersion === 6) !== (record.generationPublication !== undefined) ||
      ((record.schemaVersion >= 4) && (record.activationHead !== undefined || record.transitionHead !== undefined)) ||
      (record.schemaVersion === 1 && head !== undefined) ||
      (record.schemaVersion === 2 && (!record.activationHead || record.transitionHead !== undefined)) ||
      (record.schemaVersion === 3 && (!record.transitionHead || record.activationHead !== undefined)) || (head &&
      (!uuid.test(head.transactionId.toLowerCase()) || (head.state === "pending" ? head.recordDigest !== null : head.recordDigest === null))) ||
      record.serverId !== serverId || !uuid.test(record.catalogId)) throw unsafe();
  if (record.generation) {
    const g = readWorldGenerationReservation(record.generation.reservation);
    const previous = record.entries[0];
    if (g.serverId !== serverId || g.catalogId !== record.catalogId || g.rootIdentity !== record.rootIdentity ||
        record.entries.length !== (record.schemaVersion === 6 ? 2 : 1) || previous?.origin !== "legacy-observation" || previous.state !== "present" ||
        previous.worldId !== g.previousWorldId || previous.levelName !== g.previousName ||
        (record.schemaVersion !== 6 && record.entries.some(entry => entry.worldId === g.worldId || entry.levelName.toLowerCase() === g.nextName.toLowerCase()))) throw unsafe();
    if (record.generationExecution) {
      const execution = readGenerationExecution(record.generationExecution);
      if (execution.serverId !== serverId || execution.preparationOperationId !== g.operationId ||
          execution.preparationTransactionId !== g.transactionId || execution.worldId !== g.worldId) throw unsafe();
    }
    if (record.schemaVersion === 6) {
      const next = record.entries[1], publication = record.generationPublication!;
      if (!next || next.worldId !== g.worldId || next.levelName !== g.nextName || next.origin !== "generation" || next.state !== "present" ||
          next.operationId !== record.generationExecution!.executionOperationId || next.admissionRevision !== publication.admissionRevision ||
          next.replacesWorldId !== null || digest(JSON.stringify(next)) !== publication.entryDigest) throw unsafe();
    }
  }
  const ids = new Set<string>(), liveNames = new Set<string>(), operations = new Set<string>();
  for (const entry of record.entries) {
    if (entry.origin === "generation" && (record.schemaVersion !== 6 || entry !== record.entries[1])) throw unsafe();
    if (!validName(entry.levelName) || ids.has(entry.worldId) ||
        (entry.origin === "legacy-observation" ? entry.operationId !== null || entry.replacesWorldId !== null || entry.admissionRevision !== null || entry.legacySlotId !== worldIdentity(serverId, entry.levelName)
          : !entry.operationId || !uuid.test(entry.operationId) || entry.admissionRevision === null || entry.legacySlotId !== null) ||
        (entry.operationId !== null && operations.has(entry.operationId))) throw unsafe();
    ids.add(entry.worldId); if (entry.operationId) operations.add(entry.operationId);
    const name = entry.levelName.toLowerCase();
    if (entry.state === "present") { if (liveNames.has(name)) throw unsafe(); liveNames.add(name); }
  }
}

/** Original publication checks, shared by live catalogs and fixed snapshots. */
function verifyPublishedSnapshot(record: LibraryRecord, parent: TransactionJournalRecord): WorldGenerationReservation {
  const publication = record.generationPublication;
  if (record.schemaVersion !== 6 || !publication || !record.generation || !record.generationExecution) throw unsafe();
  const base: LibraryRecord = { ...record, schemaVersion: 5, entries: record.entries.slice(0, 1) };
  delete base.generationPublication;
  if (digest(JSON.stringify(base) + "\n") !== publication.admissionRevision) throw unsafe();
  const pending = base.generation!, g = pending.reservation;
  const names = ["generation-reserved", "stop-confirmed", "guard-verified", "config-ready", "config-switch-intent", "config-installed", "active-state-installed"];
  if (parent.schemaVersion !== 14 || parent.state !== "committed" || parent.checkpoints.length !== names.length ||
      parent.checkpoints.some((point, index) => point.name !== names[index]) || digest(JSON.stringify(parent.intent)) !== pending.intentDigest ||
      JSON.stringify(parent.intent.worldChange?.generation) !== JSON.stringify(g)) throw unsafe();
  const initial = { ...parent, state: "active", checkpoints: [], updatedAt: parent.intent.createdAt };
  const reservation: LibraryRecord = { ...base, schemaVersion: 4 }; delete reservation.generationExecution;
  const detailKeys = [["checksumSha256", "resourceId"], ["checksumSha256"], ["checksumSha256", "resourceId"]];
  if (digest(JSON.stringify(initial)) !== pending.recordDigest || parent.checkpoints[0]?.details?.resourceId !== g.worldId ||
      parent.checkpoints[0]?.details?.checksumSha256 !== digest(JSON.stringify(reservation) + "\n") ||
      parent.checkpoints[1]?.details?.checksumSha256 !== parent.intent.worldChange?.approvedRevision ||
      parent.checkpoints[2]?.details?.resourceId !== g.guardBackupId || !parent.checkpoints[2]?.details?.checksumSha256 ||
      detailKeys.some((keys, index) => { const details = parent.checkpoints[index]?.details;
        return !details || Object.keys(details).length !== keys.length || Object.keys(details).some(key => !keys.includes(key)); }) ||
      parent.checkpoints.slice(3).some(point => point.details !== undefined) ||
      record.generationExecution.preparedRecordDigest !== digest(JSON.stringify(parent))) throw unsafe();
  return structuredClone(g);
}

/** Pure genesis metadata inspection only. The caller must independently verify
 * anchors, birth, receipts and completion. This grants no filesystem, readiness
 * or recovery authority and never reconstructs genesis from a mutable catalog. */
export function inspectGenerationGenesisSnapshot(bytes: Uint8Array, expected: {
  serverId: string; catalogRevision: string; worldId: string; executionOperationId: string; recordDigest: string;
}) {
  if (bytes.byteLength > 1024 * 1024) throw unsafe();
  const copy = Buffer.from(bytes);
  try {
    if (!/^[0-9a-f]{64}$/u.test(expected.catalogRevision) ||
        createHash("sha256").update(copy).digest("hex") !== expected.catalogRevision) throw unsafe();
    const text = copy.toString("utf8"), parsed: unknown = JSON.parse(text);
    if (!copy.equals(Buffer.from(text, "utf8")) || !Value.Check(recordSchema, parsed) ||
        text !== JSON.stringify(parsed) + "\n") throw unsafe();
    const record = parsed as LibraryRecord;
    checkRecordStructure(record, expected.serverId);
    const generation = record.generation?.reservation, execution = record.generationExecution;
    if (record.schemaVersion !== 6 || !generation || !execution || generation.worldId !== expected.worldId ||
        execution.executionOperationId !== expected.executionOperationId || execution.preparedRecordDigest !== expected.recordDigest) throw unsafe();
    const seed = { schemaVersion: 1 as const, origin: "generation" as const, serverId: record.serverId,
      catalogId: record.catalogId, rootIdentity: record.rootIdentity, catalogRevision: expected.catalogRevision,
      worldId: generation.worldId, previousWorldId: generation.previousWorldId,
      levelName: record.entries[1]!.levelName, directoryIdentity: record.entries[1]!.directoryIdentity,
      previousLevelName: record.entries[0]!.levelName, previousDirectoryIdentity: record.entries[0]!.directoryIdentity,
      preparationOperationId: generation.operationId, preparationTransactionId: generation.transactionId,
      guardBackupId: generation.guardBackupId,
      birthChecksum: record.generationPublication!.birthChecksum, birthIdentity: record.generationPublication!.birthIdentity,
      registeredExecutionDigest: execution.registeredExecutionDigest,
      executionAnchorChecksum: digest(JSON.stringify(execution) + "\n"),
      executionOperationId: execution.executionOperationId, recordDigest: execution.preparedRecordDigest };
    return Object.freeze({ ...seed, seedDigest: digest(JSON.stringify(seed)), inspectionOnly: true as const });
  } catch { throw unsafe(); }
  finally { copy.fill(0); }
}

/** Original snapshot plus normalized transitions, structural inspection ONLY.
 * Callers still verify every original journal/anchor/receipt and physical state.
 * No mutable/retired catalog entry is used to reconstruct the genesis seed. */
export function projectGenerationWorldHistory(bytes: Uint8Array,
  expected: Parameters<typeof inspectGenerationGenesisSnapshot>[1], events: readonly WorldTransitionEvent[]) {
  const seed = inspectGenerationGenesisSnapshot(bytes, expected);
  return projectGenerationSeedHistory(seed, events);
}

function generationTransitionSeed(seed: ReturnType<typeof inspectGenerationGenesisSnapshot>) {
  return { serverId: seed.serverId, catalogId: seed.catalogId, rootIdentity: seed.rootIdentity, activeWorldId: seed.worldId,
    worlds: [{ worldId: seed.previousWorldId, levelName: seed.previousLevelName, directoryIdentity: seed.previousDirectoryIdentity },
      { worldId: seed.worldId, levelName: seed.levelName, directoryIdentity: seed.directoryIdentity }] };
}

function projectGenerationSeedHistory(seed: ReturnType<typeof inspectGenerationGenesisSnapshot>, events: readonly WorldTransitionEvent[]) {
  if (!Array.isArray(events) || events.length > 10_000 || events.some(event => !event || event.transactionId === seed.preparationTransactionId ||
      event.operationId === seed.preparationOperationId || event.operationId === seed.executionOperationId ||
      event.guardBackupId === seed.guardBackupId)) throw unsafe();
  const history = projectWorldTransitionsFromGenesis(seed.serverId, events, generationTransitionSeed(seed));
  return { ...history, genesis: seed, inspectionOnly: true as const };
}

/** Structural original-journal projection from the immutable snapshot, never
 * from current catalog entries. Physical/anchor/scan/head checks remain with
 * the caller. Original objects are retained for saved journal-head digests. */
export function projectGenerationJournalHistory(bytes: Uint8Array,
  expected: Parameters<typeof inspectGenerationGenesisSnapshot>[1], input: readonly TransactionJournalRecord[]) {
  const seed = inspectGenerationGenesisSnapshot(bytes, expected);
  const records = orderedWorldTransitionRecords(seed.serverId, input, generationTransitionSeed(seed));
  const projection = projectGenerationSeedHistory(seed, records.map(worldTransitionEvent));
  return { records, projection, inspectionOnly: true as const };
}

/** Pure admission-catalog snapshot proof. No current filesystem/anchor or active
 * state proof and no recovery authority. Snapshot bytes are not returned. */
export function verifyReplacementCatalogSnapshot(bytes: Uint8Array, original: TransactionJournalRecord,
  originalPrefix: readonly TransactionJournalRecord[]): void {
  const copy = Buffer.from(bytes);
  try {
    const intent = structuredClone(original), value = intent.intent.worldReplacement, prefix = structuredClone(originalPrefix);
    if (intent.schemaVersion !== 13 || intent.intent.kind !== "world-replace" || !value?.approval || copy.length > 1024 * 1024 ||
        createHash("sha256").update(copy).digest("hex") !== value.libraryRevision) throw unsafe();
    const text = copy.toString("utf8"), parsed: unknown = JSON.parse(text);
    if (!copy.equals(Buffer.from(text, "utf8")) || !Value.Check(recordSchema, parsed) ||
        (text !== JSON.stringify(parsed) && text !== JSON.stringify(parsed) + "\n")) throw unsafe();
    const catalog = parsed as LibraryRecord; checkRecordStructure(catalog, intent.intent.serverId);
    if (catalog.rootIdentity !== value.rootIdentity || catalog.catalogId !== value.catalogId || catalog.entries.length >= 1000) throw unsafe();
    const history = orderedWorldTransitionRecords(intent.intent.serverId, prefix), events = history.map(worldTransitionEvent), head = headOf(catalog), last = history.at(-1);
    if (last ? !head || head.state !== "committed" || head.sequence !== history.length || head.transactionId !== last.transactionId ||
        head.intentDigest !== digest(JSON.stringify(last.intent)) || head.previousDigest !== digest(JSON.stringify(history.slice(0, -1))) ||
        head.recordDigest !== digest(JSON.stringify(history)) : head !== undefined) throw unsafe();
    if ((events.some(event => event.kind === "replacement") && catalog.schemaVersion !== 3) ||
        events.some(event => event.rootIdentity !== value.rootIdentity || event.catalogId !== value.catalogId.toLowerCase()) ||
        value.sequence !== history.length + 1 || (last ? value.predecessorTransactionId !== last.transactionId ||
          value.previousWorldId !== events.at(-1)!.next.worldId : value.predecessorTransactionId !== null)) throw unsafe();
    const projected = projectWorldTransitions(intent.intent.serverId, events);
    for (const world of projected.worlds) {
      const entry = catalog.entries.find(item => item.worldId === world.worldId);
      if (!entry || entry.levelName !== world.levelName || entry.directoryIdentity !== world.directoryIdentity || entry.state !== world.state) throw unsafe();
    }
    for (const item of history) {
      const replacement = item.intent.worldReplacement;
      if (!replacement) continue;
      const entry = catalog.entries.find(entry => entry.worldId === replacement.worldId);
      if (!entry || entry.origin !== "import" || entry.replacesWorldId !== replacement.previousWorldId || entry.legacySlotId !== null ||
          entry.operationId !== item.intent.operationId.toLowerCase() || entry.admissionRevision !== replacement.libraryRevision) throw unsafe();
    }
    for (const entry of catalog.entries) {
      const retired = history.filter(item => item.intent.worldReplacement?.previousWorldId === entry.worldId);
      const births = history.filter(item => item.intent.worldReplacement?.worldId === entry.worldId);
      if ((entry.state === "retired" && retired.length !== 1) || (entry.replacesWorldId !== null &&
          (births.length !== 1 || births[0]!.intent.worldReplacement!.previousWorldId !== entry.replacesWorldId ||
            entry.operationId !== births[0]!.intent.operationId.toLowerCase() || entry.admissionRevision !== births[0]!.intent.worldReplacement!.libraryRevision))) throw unsafe();
    }
    const previous = catalog.entries.find(entry => entry.worldId === value.previousWorldId && entry.state === "present");
    if (!previous || previous.levelName !== value.levelName || value.confirmationName !== value.levelName || previous.directoryIdentity !== value.currentDirectoryIdentity ||
        events.some(event => event.operationId === intent.intent.operationId.toLowerCase() || event.guardBackupId === value.guardBackupId.toLowerCase()) ||
        catalog.entries.some(entry => entry.worldId === value.worldId || entry.operationId === intent.intent.operationId.toLowerCase())) throw unsafe();
  } catch { throw unsafe(); } finally { copy.fill(0); }
}

/** Sidecar lineage registry. Legacy active-state/backup/journal bytes are never rewritten.
 * Mutators are backend-only and must be called under the owning instance operation lease.
 * A stored directory identity is containment evidence, never proof of world loadability.
 */
export class WorldLibraryStore {
  readonly #root: string;
  readonly #observed = new Map<string, string>();
  readonly #newDirectories = new Set<string>();
  #tail: Promise<void> = Promise.resolve();
  constructor(managerRoot: string, private readonly clock: Clock) {
    this.#root = path.join(path.resolve(managerRoot), "world-library");
  }

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    const before = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>(resolve => { release = resolve; });
    await before;
    try { return await action(); } finally { release(); }
  }

  private async directory(binding: Binding, create = false): Promise<string> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(binding.serverId)) throw unsafe();
    await plainRestoreDirectory(path.dirname(this.#root));
    if (create) await mkdir(this.#root, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
    await plainRestoreDirectory(this.#root);
    if (create) await syncRestoreDirectory(path.dirname(this.#root));
    const directory = path.join(this.#root, binding.serverId);
    if (create) {
      try { await mkdir(directory, { mode: 0o700 }); this.#newDirectories.add(binding.serverId); }
      catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error; }
      await syncRestoreDirectory(this.#root);
    }
    await plainRestoreDirectory(directory);
    let count = 0;
    for await (const item of await opendir(directory)) {
      // A leftover atomic-save stage is evidence, not something to discard or ignore.
      if (++count > 1 || item.name !== "state.json" || !item.isFile() || item.isSymbolicLink()) throw unsafe();
    }
    return directory;
  }

  private async read(binding: Binding): Promise<{ record: LibraryRecord; revision: string; fileIdentity: string } | null> {
    const directory = await this.directory(binding);
    let file;
    try { file = await readPrivatePropertiesFile(path.join(directory, "state.json"), 1024 * 1024); }
    catch (error) {
      if (missingFile(error) && !this.#observed.has(binding.serverId) && this.#newDirectories.has(binding.serverId)) {
        try { await lstat(path.join(this.#root, `${binding.serverId}.identity.json`)); }
        catch (anchorError) { if (missingFile(anchorError)) return null; }
      }
      throw unsafe();
    }
    const revision = file.checksum;
    let parsed: unknown;
    try { parsed = JSON.parse(file.bytes.toString("utf8")); } finally { file.bytes.fill(0); }
    if (!Value.Check(recordSchema, parsed)) throw unsafe();
    const record = parsed as LibraryRecord;
    checkRecordStructure(record, binding.serverId);
    if (record.generationExecution) await this.readExecutionAnchor(binding, record.generationExecution);
    if (record.generationPublication) {
      const birth = await this.birthRecord(binding);
      if (birth.checksum !== record.generationPublication.birthChecksum || birth.identity !== record.generationPublication.birthIdentity || JSON.stringify(birth.value.execution) !== JSON.stringify(record.generationExecution) ||
          birth.value.candidate.directoryIdentity !== record.entries[1]!.directoryIdentity) throw unsafe();
    }
    if (record.serverId !== binding.serverId || record.rootIdentity !== await backupDirectoryIdentity(binding.rootPath)) throw unsafe();
    const anchor = await readPrivatePropertiesFile(path.join(this.#root, `${binding.serverId}.identity.json`), 4096);
    let anchorValue: unknown;
    try { anchorValue = JSON.parse(anchor.bytes.toString("utf8")); } finally { anchor.bytes.fill(0); }
    if (!Value.Check(anchorSchema, anchorValue) || anchorValue.serverId !== binding.serverId ||
        anchorValue.catalogId !== record.catalogId || anchorValue.rootIdentity !== record.rootIdentity || !uuid.test(record.catalogId)) throw unsafe();
    const observed = this.#observed.get(binding.serverId);
    if (observed && observed !== revision) throw unsafe();
    this.#observed.set(binding.serverId, revision);
    return { record, revision, fileIdentity: file.identity };
  }

  private async physical(binding: Binding, levelName: string): Promise<string> {
    if (!validName(levelName)) throw unsafe();
    await backupDirectoryIdentity(binding.rootPath);
    const directory = path.join(binding.rootPath, levelName);
    const identity = await backupDirectoryIdentity(directory);
    const level = path.join(directory, "level.dat");
    const info = await lstat(level);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw unsafe();
    if (identity !== await backupDirectoryIdentity(directory)) throw unsafe();
    return identity;
  }

  private async commit(binding: Binding, record: LibraryRecord, previous: string | null, expectedFileIdentity?: string): Promise<string> {
    const current = await this.read(binding);
    if ((current?.revision ?? null) !== previous || (expectedFileIdentity !== undefined && current?.fileIdentity !== expectedFileIdentity) || record.entries.length > 1000 ||
        record.rootIdentity !== await backupDirectoryIdentity(binding.rootPath)) throw unsafe();
    const file = path.join(await this.directory(binding), "state.json");
    if (previous === null) {
      // A permanent sibling anchor makes a missing catalog distinguishable from
      // first adoption even after a new Manager process. Never recreate this anchor.
      const anchorFile = path.join(this.#root, `${binding.serverId}.identity.json`);
      const handle = await open(anchorFile, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ schemaVersion: 1, serverId: binding.serverId,
          catalogId: record.catalogId, rootIdentity: record.rootIdentity }) + "\n", "utf8");
        await handle.sync();
      } finally { await handle.close(); }
      await syncRestoreDirectory(this.#root);
    }
    await writeRestoreJson(file, record);
    // Do not accept a lost/changed publication as a successful identity assignment.
    this.#observed.delete(binding.serverId);
    const saved = await this.read(binding);
    if (!saved || saved.revision !== digest(JSON.stringify(record) + "\n")) throw unsafe();
    this.#newDirectories.delete(binding.serverId);
    return saved.revision;
  }

  /** One-time observation only after the legacy reconciler has accepted active state. */
  async migrateLegacy(binding: Binding, active: ActiveWorldState): Promise<void> {
    return this.exclusive(async () => {
      if (active.serverId !== binding.serverId || active.state !== "active" || !active.levelName ||
          active.worldId !== worldIdentity(binding.serverId, active.levelName)) throw unsafe();
      await this.directory(binding, true);
      const existing = await this.read(binding);
      const physical = await this.physical(binding, active.levelName);
      if (existing) {
        if (existing.record.generation) throw unsafe();
        const entry = existing.record.entries.find(item => item.state === "present" && item.levelName === active.levelName);
        if (!entry || entry.directoryIdentity !== physical) throw unsafe();
        return;
      }
      const entry: StoredEntry = { worldId: allocateWorldIdentity(), levelName: active.levelName,
        state: "present", origin: "legacy-observation", createdAt: this.clock.now().toISOString(),
        legacySlotId: active.worldId, legacyBackupAssociation: "unverified", directoryIdentity: physical, operationId: null, replacesWorldId: null, admissionRevision: null };
      await this.commit(binding, { schemaVersion: 1, serverId: binding.serverId, catalogId: randomUUID(),
        rootIdentity: await backupDirectoryIdentity(binding.rootPath), entries: [entry] }, null);
    });
  }

  /** Commit a verified installation; replacement preserves the prior immutable entry.
   * No filesystem data is installed/deleted here. A caller must journal and verify that first.
   */
  async recordInstalled(binding: Binding, body: { worldId: string; levelName: string; operationId: string;
    expectedRevision: string; replacesWorldId?: string }): Promise<string> {
    return this.exclusive(async () => {
      if (!uuid.test(body.operationId) || !body.worldId.startsWith("worldv2-") || !uuid.test(body.worldId.slice(8))) throw unsafe();
      const current = await this.read(binding);
      if (!current) throw unsafe();
      if (headOf(current.record)?.state === "pending") throw unsafe();
      const physical = await this.physical(binding, body.levelName);
      const repeated = current.record.entries.find(entry => entry.operationId === body.operationId);
      if (repeated) {
        if (repeated.worldId !== body.worldId || repeated.levelName !== body.levelName || repeated.directoryIdentity !== physical || repeated.state !== "present" ||
            repeated.replacesWorldId !== (body.replacesWorldId ?? null)) throw unsafe();
        if (repeated.admissionRevision !== body.expectedRevision) throw unsafe();
        return repeated.worldId;
      }
      if (current.revision !== body.expectedRevision) throw unsafe();
      if (current.record.entries.some(entry => entry.worldId === body.worldId)) throw unsafe();
      const previous = current.record.entries.find(entry => entry.state === "present" && entry.levelName.toLowerCase() === body.levelName.toLowerCase());
      if (previous ? previous.worldId !== body.replacesWorldId || previous.directoryIdentity === physical
        : body.replacesWorldId !== undefined) throw unsafe();
      const entries = current.record.entries.map(entry => entry === previous ? { ...entry, state: "retired" as const } : entry);
      // The caller must persist this already-allocated ID in its intent before
      // installing data. Never invent a new lineage during commit/recovery.
      const worldId = body.worldId;
      entries.push({ worldId, levelName: body.levelName, state: "present", origin: "import",
        createdAt: this.clock.now().toISOString(), legacySlotId: null, legacyBackupAssociation: "unverified",
        directoryIdentity: physical, operationId: body.operationId, replacesWorldId: previous?.worldId ?? null, admissionRevision: body.expectedRevision });
      await this.commit(binding, { ...current.record, entries }, current.revision);
      return worldId;
    });
  }

  /** Unmounted reservation only. Caller retains the instance lease. Requires an
   * already persisted schema14 intent; grants no generation/start authority. */
  async reserveGeneration(binding: Binding, expectedRevision: string, original: TransactionJournalRecord,
    journal: Pick<TransactionJournalStore, "scan">): Promise<string> {
    return this.exclusive(async () => {
      const intent = structuredClone(original), g = readWorldGenerationReservation(intent.intent.worldChange?.generation);
      const current = await this.read(binding);
      if (!current || current.revision !== expectedRevision || current.record.schemaVersion !== 1 || headOf(current.record) ||
          intent.schemaVersion !== 14 || intent.state !== "active" || intent.checkpoints.length !== 0 ||
          g.serverId !== binding.serverId || g.catalogRevision !== expectedRevision || g.catalogId !== current.record.catalogId ||
          g.rootIdentity !== current.record.rootIdentity || current.record.entries.length !== 1) throw unsafe();
      const previous = current.record.entries[0]!;
      if (previous.worldId !== g.previousWorldId || previous.levelName !== g.previousName || previous.origin !== "legacy-observation" ||
          previous.state !== "present") throw unsafe();
      const verify = async () => {
        const scan = await journal.scan(), records = scan.records.filter(record => record.intent.serverId === binding.serverId);
        if (scan.issues.some(issue => !issue.serverId || issue.serverId === binding.serverId) ||
            records.length !== 1 || JSON.stringify(records[0]) !== JSON.stringify(intent)) throw unsafe();
        if (await this.physical(binding, previous.levelName) !== previous.directoryIdentity ||
            (await readdir(binding.rootPath)).some(name => name.toLowerCase() === g.nextName.toLowerCase())) throw unsafe();
        const properties = await readPrivatePropertiesFile(path.join(binding.rootPath, "server.properties"));
        try { if (properties.checksum !== g.propertiesBefore) throw unsafe(); } finally { properties.bytes.fill(0); }
        const active = await readPrivatePropertiesFile(path.join(path.dirname(this.#root), "active-worlds", `${binding.serverId}.json`), 16 * 1024);
        try {
          const text = active.bytes.toString("utf8"), state: unknown = JSON.parse(text);
          if (active.checksum !== g.activeStateRevision || !state || typeof state !== "object" ||
              Array.isArray(state) || !active.bytes.equals(Buffer.from(text, "utf8")) ||
              (text !== JSON.stringify(state) && text !== JSON.stringify(state) + "\n") ||
              Object.keys(state).length !== 5 || Object.keys(state).some(key => !["schemaVersion", "serverId", "state", "levelName", "worldId"].includes(key)) ||
              !("schemaVersion" in state) || state.schemaVersion !== 1 ||
              !("serverId" in state) || state.serverId !== binding.serverId || !("state" in state) || state.state !== "active" ||
              !("levelName" in state) || state.levelName !== g.previousName || !("worldId" in state) ||
              state.worldId !== worldIdentity(binding.serverId, g.previousName)) throw unsafe();
        } finally { active.bytes.fill(0); }
      };
      await verify();
      // Existing protected publication performs another catalog revision/identity CAS.
      // Reservation has no directory identity and never creates a present entry.
      return this.commit(binding, { ...current.record, schemaVersion: 4,
        generation: { reservation: g, intentDigest: digest(JSON.stringify(intent.intent)), recordDigest: digest(JSON.stringify(intent)) } },
      expectedRevision, current.fileIdentity);
    });
  }

  /** Dedicated metadata readback only. Does not verify generated files, approve
   * a lifecycle continuation or clear any recovery cause. Later checkpoints
   * require their own verifier; this reads the exact initial reserved boundary. */
  async readGenerationReservation(binding: Binding, journal: Pick<TransactionJournalStore, "scan">): Promise<{
    reservation: WorldGenerationReservation; catalogRevision: string; recordDigest: string;
  }> {
    return this.exclusive(async () => {
      const before = await this.read(binding), pending = before?.record.generation;
      if (!before || before.record.schemaVersion !== 4 || !pending) throw unsafe();
      await this.assertUnsealedGeneration(binding);
      const verify = async () => {
        const scan = await journal.scan(), records = scan.records.filter(record => record.intent.serverId === binding.serverId);
        const record = records[0];
        if (scan.issues.some(issue => !issue.serverId || issue.serverId === binding.serverId) || records.length !== 1 ||
            !record || record.schemaVersion !== 14 || record.state !== "active" || record.checkpoints.length !== 0 ||
            digest(JSON.stringify(record)) !== pending.recordDigest || digest(JSON.stringify(record.intent)) !== pending.intentDigest ||
            JSON.stringify(record.intent.worldChange?.generation) !== JSON.stringify(pending.reservation)) throw unsafe();
      };
      await verify();
      const after = await this.read(binding);
      if (!after || after.revision !== before.revision || after.fileIdentity !== before.fileIdentity) throw unsafe();
      await verify();
      return { reservation: structuredClone(pending.reservation), catalogRevision: before.revision, recordDigest: pending.recordDigest };
    });
  }

  /** Dedicated prepared boundary, not a relaxation of initial reservation readback.
   * Structural evidence only; a caller must separately verify controls and guard. */
  async readPreparedGeneration(binding: Binding, journal: Pick<TransactionJournalStore, "scan">) {
    return this.exclusive(() => this.preparedGeneration(binding, journal, false));
  }

  private async preparedGeneration(binding: Binding, journal: Pick<TransactionJournalStore, "scan">, sealed: boolean) {
      const saved = await this.read(binding), pending = saved?.record.generation;
      if (!saved || saved.record.schemaVersion !== (sealed ? 5 : 4) || !pending) throw unsafe();
      if (!sealed) await this.assertUnsealedGeneration(binding);
      const scan = await journal.scan(), records = scan.records.filter(record => record.intent.serverId === binding.serverId), record = records[0];
      const names = ["generation-reserved", "stop-confirmed", "guard-verified", "config-ready", "config-switch-intent", "config-installed", "active-state-installed"];
      if (scan.issues.some(issue => !issue.serverId || issue.serverId === binding.serverId) || records.length !== 1 || !record ||
          record.schemaVersion !== 14 || record.state !== "committed" || record.checkpoints.length !== names.length ||
          record.checkpoints.some((point, index) => point.name !== names[index]) ||
          digest(JSON.stringify(record.intent)) !== pending.intentDigest ||
          JSON.stringify(record.intent.worldChange?.generation) !== JSON.stringify(pending.reservation)) throw unsafe();
      const initial = { ...record, state: "active", checkpoints: [], updatedAt: record.intent.createdAt };
      const g = pending.reservation;
      const reservationCatalog = { ...saved.record, schemaVersion: 4 as const }; delete reservationCatalog.generationExecution;
      const reservationRevision = sealed ? digest(JSON.stringify(reservationCatalog) + "\n") : saved.revision;
      const detailKeys = [["checksumSha256", "resourceId"], ["checksumSha256"], ["checksumSha256", "resourceId"]];
      if (digest(JSON.stringify(initial)) !== pending.recordDigest ||
          detailKeys.some((keys, index) => {
            const details = record.checkpoints[index]?.details;
            return !details || Object.keys(details).length !== keys.length || Object.keys(details).some(key => !keys.includes(key));
          }) ||
          record.checkpoints[0]?.details?.resourceId !== g.worldId || record.checkpoints[0]?.details?.checksumSha256 !== reservationRevision ||
          record.checkpoints[1]?.details?.checksumSha256 !== record.intent.worldChange?.approvedRevision ||
          record.checkpoints[2]?.details?.resourceId !== g.guardBackupId || !record.checkpoints[2]?.details?.checksumSha256 ||
          record.checkpoints.slice(3).some(point => point.details !== undefined)) throw unsafe();
      const after = await this.read(binding), finalScan = await journal.scan();
      if (!after || after.revision !== saved.revision || after.fileIdentity !== saved.fileIdentity ||
          finalScan.issues.some(issue => !issue.serverId || issue.serverId === binding.serverId) ||
          JSON.stringify(finalScan.records.filter(item => item.intent.serverId === binding.serverId)) !== JSON.stringify(records)) throw unsafe();
      return { reservation: structuredClone(g), record: structuredClone(record), catalogRevision: saved.revision,
        catalogFileIdentity: saved.fileIdentity, previousDirectoryIdentity: saved.record.entries[0]!.directoryIdentity,
        recordDigest: digest(JSON.stringify(record)) };
  }

  private async executionReceipt(execution: WorldGenerationExecution, receipts: Pick<OperationStore, "list">) {
    const related = (await receipts.list()).filter(record => record.worldGenerationExecution?.serverId === execution.serverId &&
      (record.worldGenerationExecution.preparationOperationId === execution.preparationOperationId ||
       record.worldGenerationExecution.preparationTransactionId === execution.preparationTransactionId || record.worldGenerationExecution.worldId === execution.worldId));
    const record = related[0];
    if (related.length !== 1 || !record || !validGenerationExecutionReceipt(record) ||
        (Object.keys(worldGenerationExecutionSchema.properties) as (keyof WorldGenerationExecution)[]).some(key => record.worldGenerationExecution![key] !== execution[key])) throw unsafe();
    return record;
  }

  private executionAnchor(binding: Binding): string {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/u.test(binding.serverId)) throw unsafe();
    return path.join(this.#root, `${binding.serverId}.generation-execution.json`);
  }
  private async assertUnsealedGeneration(binding: Binding): Promise<void> {
    try { await lstat(this.executionAnchor(binding)); throw unsafe(); }
    catch (error) { if (!missingFile(error)) throw error; }
  }
  private async readExecutionAnchor(binding: Binding, execution: WorldGenerationExecution): Promise<void> {
    const file = await readPrivatePropertiesFile(this.executionAnchor(binding), 4096);
    try {
      const text = file.bytes.toString("utf8"), value = readGenerationExecution(JSON.parse(text));
      if (!file.bytes.equals(Buffer.from(text, "utf8")) || text !== JSON.stringify(value) + "\n" ||
          JSON.stringify(value) !== JSON.stringify(execution)) throw unsafe();
    } finally { file.bytes.fill(0); }
  }

  /** One-way storage seal, NOT a launch permit. Caller retains instance lease.
   * Any successful publication consumes the attempt, including lost responses. */
  async sealGenerationExecution(binding: Binding, expectedRevision: string, value: unknown,
    journal: Pick<TransactionJournalStore, "scan">, receipts: Pick<OperationStore, "list">) {
    return this.exclusive(async () => {
      const execution = readGenerationExecution(value), before = await this.read(binding);
      if (!before || ![4, 5].includes(before.record.schemaVersion)) throw unsafe();
      const sealed = before.record.schemaVersion === 5;
      const prepared = await this.preparedGeneration(binding, journal, sealed), g = prepared.reservation;
      if (execution.serverId !== binding.serverId || execution.preparationOperationId !== g.operationId ||
          execution.preparationTransactionId !== g.transactionId || execution.worldId !== g.worldId || execution.preparedRecordDigest !== prepared.recordDigest) throw unsafe();
      const receipt = await this.executionReceipt(execution, receipts);
      if (sealed) {
        if (JSON.stringify(before.record.generationExecution) !== JSON.stringify(execution)) throw unsafe();
        return { alreadySealed: true, catalogRevision: before.revision };
      }
      if (before.revision !== expectedRevision || prepared.catalogRevision !== expectedRevision || !["queued", "running"].includes(receipt.operation.state)) throw unsafe();
      if (JSON.stringify(await this.executionReceipt(execution, receipts)) !== JSON.stringify(receipt)) throw unsafe();
      // Permanent, exclusive sibling seal survives a missing/reverted catalog.
      // A failed publication is consumed evidence; never delete/recreate it.
      await this.directory(binding);
      const anchor = await open(this.executionAnchor(binding), "wx", 0o600);
      try { await anchor.writeFile(JSON.stringify(execution) + "\n", "utf8"); await anchor.sync(); }
      finally { await anchor.close(); }
      await syncRestoreDirectory(this.#root);
      await this.readExecutionAnchor(binding, execution);
      const revision = await this.commit(binding, { ...before.record, schemaVersion: 5, generationExecution: execution }, expectedRevision, before.fileIdentity);
      await this.preparedGeneration(binding, journal, true);
      const after = await this.read(binding);
      if (!after || after.revision !== revision || JSON.stringify(after.record.generationExecution) !== JSON.stringify(execution) ||
          JSON.stringify(await this.executionReceipt(execution, receipts)) !== JSON.stringify(receipt)) throw unsafe();
      return { alreadySealed: false, catalogRevision: revision };
    });
  }

  /** Read-only inspection of a consumed attempt; never marks it runnable again. */
  async readGenerationExecutionSeal(binding: Binding, journal: Pick<TransactionJournalStore, "scan">, receipts: Pick<OperationStore, "list">) {
    return this.exclusive(async () => {
      const prepared = await this.preparedGeneration(binding, journal, true), saved = await this.read(binding), execution = saved?.record.generationExecution;
      if (!saved || !execution || saved.revision !== prepared.catalogRevision || execution.preparedRecordDigest !== prepared.recordDigest) throw unsafe();
      await this.executionReceipt(execution, receipts);
      return { execution: structuredClone(execution), catalogRevision: saved.revision, consumed: true as const };
    });
  }

  /** Consumed-state metadata for physical prelaunch verification, never a retry permit. */
  async readSealedGenerationPreparation(binding: Binding, journal: Pick<TransactionJournalStore, "scan">,
    receipts: Pick<OperationStore, "list">, value: unknown, requireRunning = false) {
    return this.exclusive(async () => {
      const execution = readGenerationExecution(value), prepared = await this.preparedGeneration(binding, journal, true);
      const saved = await this.read(binding), receipt = await this.executionReceipt(execution, receipts);
      if (!saved || saved.revision !== prepared.catalogRevision || JSON.stringify(saved.record.generationExecution) !== JSON.stringify(execution) ||
          !(receipt.operation.state === "running" || (!requireRunning && receipt.operation.state === "queued")) ||
          execution.preparedRecordDigest !== prepared.recordDigest) throw unsafe();
      return prepared;
    });
  }

  private birthFile(binding: Binding): string {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/u.test(binding.serverId)) throw unsafe();
    return path.join(this.#root, `${binding.serverId}.generation-birth.json`);
  }
  private async birthRecord(binding: Binding) {
    const file = await readPrivatePropertiesFile(this.birthFile(binding), 8192);
    try {
      const text = file.bytes.toString("utf8"), value = readGenerationBirth(JSON.parse(text));
      if (!file.bytes.equals(Buffer.from(text, "utf8")) || text !== JSON.stringify(value) + "\n" || value.execution.serverId !== binding.serverId) throw unsafe();
      return { value, checksum: file.checksum, identity: file.identity };
    } finally { file.bytes.fill(0); }
  }

  /** One-way birth evidence only. Does not publish an entry or release recovery.
   * The mandatory live callback must revalidate the owned exit and candidate;
   * a serialized old observation can never authorize this writer. */
  async sealGenerationBirth(binding: Binding, value: unknown, journal: Pick<TransactionJournalStore, "scan">,
    receipts: Pick<OperationStore, "list">, recheckLive: () => Promise<void>, assertLive: () => undefined) {
    if (typeof recheckLive !== "function" || typeof assertLive !== "function") throw unsafe();
    const authorize = () => {
      const result: unknown = assertLive();
      if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw unsafe(); }
    };
    const birth = readGenerationBirth(value);
    return this.exclusive(async () => {
      const verify = async () => {
        const prepared = await this.preparedGeneration(binding, journal, true), current = await this.read(binding);
        const receipt = await this.executionReceipt(birth.execution, receipts);
        if (!current || current.revision !== prepared.catalogRevision || birth.execution.serverId !== binding.serverId ||
            birth.execution.preparedRecordDigest !== prepared.recordDigest ||
            JSON.stringify(current.record.generationExecution) !== JSON.stringify(birth.execution) ||
            !["queued", "running"].includes(receipt.operation.state)) throw unsafe();
        return current.revision;
      };
      const revision = await verify();
      await recheckLive();
      if (await verify() !== revision) throw unsafe();
      await recheckLive();
      // No overwrite, repair or deletion, including publication/readback failure.
      await this.directory(binding);
      authorize();
      const file = await open(this.birthFile(binding), "wx", 0o600);
      try { await file.writeFile(JSON.stringify(birth) + "\n", "utf8"); await file.sync(); }
      finally { await file.close(); }
      await syncRestoreDirectory(this.#root);
      const saved = await this.birthRecord(binding);
      if (JSON.stringify(saved.value) !== JSON.stringify(birth) || await verify() !== revision) throw unsafe();
      await recheckLive();
      const final = await this.birthRecord(binding);
      if (final.checksum !== saved.checksum || final.identity !== saved.identity || JSON.stringify(final.value) !== JSON.stringify(birth)) throw unsafe();
      authorize();
      return { checksum: saved.checksum, worldId: birth.execution.worldId };
    });
  }

  /** Read-only receipt binding; not a runnable/recovery/publication permit. */
  async readGenerationBirth(binding: Binding, journal: Pick<TransactionJournalStore, "scan">, receipts: Pick<OperationStore, "list">) {
    return this.exclusive(async () => {
      const prepared = await this.preparedGeneration(binding, journal, true), current = await this.read(binding), birth = await this.birthRecord(binding);
      if (!current || current.revision !== prepared.catalogRevision || birth.value.execution.preparedRecordDigest !== prepared.recordDigest || JSON.stringify(current.record.generationExecution) !== JSON.stringify(birth.value.execution)) throw unsafe();
      await this.executionReceipt(birth.value.execution, receipts);
      return { ...birth, inspectionOnly: true as const };
    });
  }

  private async generationParentReceipt(binding: Binding, record: TransactionJournalRecord, receipts: Pick<OperationStore, "list">) {
    const parent = (await receipts.list()).find(item => item.operation.id === record.intent.operationId), g = record.intent.worldChange?.generation;
    if (!g || !parent || parent.worldGenerationExecution || parent.operation.serverId !== binding.serverId || parent.operation.kind !== "world-create" ||
        !["succeeded", "interrupted"].includes(parent.operation.state) || parent.operation.result?.resourceId !== g.guardBackupId || parent.operation.result.rollbackAvailable) throw unsafe();
    return parent;
  }

  private async publishedPreparation(binding: Binding, journal: Pick<TransactionJournalStore, "scan">, receipts: Pick<OperationStore, "list">) {
    const saved = await this.read(binding), publication = saved?.record.generationPublication;
    if (!saved || saved.record.schemaVersion !== 6 || !publication) throw unsafe();
    const scan = await journal.scan(), records = scan.records.filter(record => record.intent.serverId === binding.serverId), record = records[0];
    if (scan.issues.some(issue => !issue.serverId || issue.serverId === binding.serverId) || records.length !== 1 || !record) throw unsafe();
    const g = verifyPublishedSnapshot(saved.record, record);
    const birth = await this.birthRecord(binding), execution = saved.record.generationExecution!;
    if (execution.preparedRecordDigest !== digest(JSON.stringify(record)) || birth.checksum !== publication.birthChecksum) throw unsafe();
    await this.generationParentReceipt(binding, record, receipts);
    await this.executionReceipt(execution, receipts);
    const after = await this.read(binding), finalScan = await journal.scan();
    if (!after || after.revision !== saved.revision || after.fileIdentity !== saved.fileIdentity ||
        finalScan.issues.some(issue => !issue.serverId || issue.serverId === binding.serverId) ||
        JSON.stringify(finalScan.records.filter(item => item.intent.serverId === binding.serverId)) !== JSON.stringify(records)) throw unsafe();
    return { reservation: structuredClone(g), record: structuredClone(record), catalogRevision: saved.revision,
      catalogFileIdentity: saved.fileIdentity, previousDirectoryIdentity: saved.record.entries[0]!.directoryIdentity,
      recordDigest: digest(JSON.stringify(record)) };
  }

  /** Schema6 inspection only; never accepted by execution/seal/birth writers. */
  async readPublishedGenerationPreparation(binding: Binding, journal: Pick<TransactionJournalStore, "scan">, receipts: Pick<OperationStore, "list">) {
    return this.exclusive(() => this.publishedPreparation(binding, journal, receipts));
  }

  /** Inspection snapshot only, with the complete parent/receipt/publication chain. */
  async readPublishedGenerationEvidence(binding: Binding, journal: Pick<TransactionJournalStore, "scan">, receipts: Pick<OperationStore, "list">) {
    return this.exclusive(async () => {
      const prepared = await this.publishedPreparation(binding, journal, receipts), birth = await this.birthRecord(binding);
      const current = await this.read(binding);
      if (!current || current.revision !== prepared.catalogRevision || current.record.generationPublication?.birthChecksum !== birth.checksum ||
          current.record.generationPublication.birthIdentity !== birth.identity) throw unsafe();
      const executionReceipt = await this.executionReceipt(birth.value.execution, receipts);
      const parentReceipt = await this.generationParentReceipt(binding, prepared.record, receipts);
      return { prepared, birth, receiptDigest: digest(JSON.stringify([parentReceipt, executionReceipt])), inspectionOnly: true as const };
    });
  }

  private async initialMaturityEvidence(binding: Binding, executionId: string, issuerProof: unknown,
    registeredExecutionDigest: string, journal: Pick<TransactionJournalStore, "scan">, receipts: Pick<OperationStore, "list">,
    authorize: () => undefined, lifecycle?: CatalogLifecycleEvidence) {
    const guard = () => {
      if (typeof authorize !== "function") throw unsafe();
      const result: unknown = authorize();
      if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw unsafe(); }
    };
    const read = async () => {
      guard();
      const issued = await inspectIssuedGenerationReference(path.dirname(this.#root), binding.serverId, executionId,
        { ...binding, registeredExecutionDigest }, issuerProof, authorize); guard();
      const original = issued.reference.reference;
      const file = path.join(path.dirname(this.#root), "active-worlds", `${binding.serverId}.${executionId}.generation-genesis.json`);
      const object = await generationReferenceObjectWitness(file), saved = await readPrivatePropertiesFile(file, 1024 * 1024);
      let snapshot: LibraryRecord;
      try {
        if (object !== issued.reference.objects.snapshot || await generationReferenceObjectWitness(file) !== object) throw unsafe();
        inspectGenerationGenesisSnapshot(saved.bytes, { serverId: binding.serverId, catalogRevision: original.snapshot.checksum,
          worldId: original.worldId, executionOperationId: executionId, recordDigest: original.recordDigest });
        snapshot = JSON.parse(saved.bytes.toString("utf8")) as LibraryRecord;
      } finally { saved.bytes.fill(0); }
      guard();
      const scan = await journal.scan(), scoped = scan.records.filter(record => record.intent.serverId === binding.serverId), parent = scoped[0];
      if (scan.issues.some(issue => !issue.serverId || issue.serverId === binding.serverId) || scoped.length !== 1 || !parent ||
          digest(JSON.stringify(parent)) !== original.recordDigest) throw unsafe();
      const g = verifyPublishedSnapshot(snapshot, parent);
      if (g.serverId !== binding.serverId || g.operationId !== issued.seed.preparationOperationId || g.worldId !== original.worldId ||
          snapshot.catalogId !== issued.reference.catalogId || snapshot.rootIdentity !== issued.reference.rootIdentity) throw unsafe();
      const parentReceipt = await this.generationParentReceipt(binding, parent, receipts);
      const executionReceipt = await this.executionReceipt(snapshot.generationExecution!, receipts);
      if (digest(JSON.stringify([parentReceipt, executionReceipt])) !== issued.reference.receiptDigest) throw unsafe();
      // Already canonical-parsed, fully cross-bound and strongly read back by
      // the issued reader; do not repeat that physical read for each consumer.
      const birth = structuredClone(issued.birthEvidence);
      const currentReceipts = await receipts.list();
      const allowed = new Set([g.operationId, executionId]);
      if (lifecycle) {
        for (const expected of [lifecycle.start, lifecycle.stop]) {
          const matches = currentReceipts.filter(record => record.operation.id === expected.operation.id);
          if (matches.length !== 1 || JSON.stringify(matches[0]) !== JSON.stringify(expected)) throw unsafe();
          allowed.add(expected.operation.id);
        }
      }
      const otherPending = currentReceipts.some(record => record.operation.serverId === binding.serverId &&
        !allowed.has(record.operation.id) && ((lifecycle && record.worldLifecycle !== undefined) ||
          ["queued", "running", "interrupted"].includes(record.operation.state)));
      if (otherPending) throw unsafe(); guard();
      return { snapshot, issued, birth, parent: structuredClone(parent), recordsDigest: digest(JSON.stringify(scoped)) };
    };
    const initial = await read();
    return { ...initial, guard, recheck: async () => { if (JSON.stringify(await read()) !== JSON.stringify(initial)) throw unsafe(); } };
  }

  private async closeInitialMaturity(binding: Binding, executionId: string, catalogDirectoryIdentity: string,
    evidence: Awaited<ReturnType<WorldLibraryStore["initialMaturityEvidence"]>>) {
    const directory = await this.directory(binding), issuer = evidence.issued.reference;
    if (await backupDirectoryIdentity(directory) !== catalogDirectoryIdentity ||
        await backupDirectoryIdentity(path.join(path.dirname(this.#root), "active-worlds")) !== issuer.directoryIdentity ||
        await backupDirectoryIdentity(this.#root) !== issuer.libraryIdentity ||
        await backupDirectoryIdentity(binding.rootPath) !== issuer.rootIdentity) throw unsafe();
    try { await lstat(path.join(path.dirname(this.#root), "active-worlds", `${binding.serverId}.${executionId}.generation-slot.tmp`)); throw unsafe(); }
    catch (error) { if (!missingFile(error)) throw error; }
    evidence.guard();
  }

  /** Internal detached candidate ONLY. Explicit issuer proof must come from the
   * trusted issuer caller. No schema7 publication, migration or ready permit. */
  async prepareInitialGenerationMaturity(binding: Binding, expectedRevision: string, executionId: string, issuerProof: unknown,
    registeredExecutionDigest: string, journal: Pick<TransactionJournalStore, "scan">, receipts: Pick<OperationStore, "list">,
    authorize: () => undefined) {
    try { binding = structuredClone(binding); issuerProof = structuredClone(issuerProof); } catch { throw unsafe(); }
    return this.exclusive(async () => {
      const directory = await this.directory(binding), directoryIdentity = await backupDirectoryIdentity(directory);
      const file = path.join(directory, "state.json"), object = await generationReferenceObjectWitness(file);
      const current = await this.read(binding);
      if (!current || current.record.schemaVersion !== 6 || current.revision !== expectedRevision ||
          current.record.generationExecution?.executionOperationId !== executionId) throw unsafe();
      const evidence = await this.initialMaturityEvidence(binding, executionId, structuredClone(issuerProof), registeredExecutionDigest, journal, receipts, authorize);
      if (JSON.stringify(current.record) !== JSON.stringify(evidence.snapshot)) throw unsafe();
      const candidate: InitialMatureCatalog = { schemaVersion: 7, serverId: binding.serverId, catalogId: current.record.catalogId,
        rootIdentity: current.record.rootIdentity, entries: structuredClone(current.record.entries), generationGenesis: {
          executionOperationId: executionId, worldId: evidence.issued.seed.worldId, issuer: structuredClone(evidence.issued.issuer) } };
      if (!Value.Check(initialMatureSchema, candidate)) throw unsafe();
      await evidence.recheck(); const final = await this.read(binding);
      if (!final || final.revision !== current.revision || final.fileIdentity !== current.fileIdentity ||
          await generationReferenceObjectWitness(file) !== object) throw unsafe();
      await this.closeInitialMaturity(binding, executionId, directoryIdentity, evidence);
      return { inspectionOnly: true as const, recoveryRequired: true as const, catalogPublicationVerified: false as const,
        candidate: structuredClone(candidate), expectedCatalog: { checksum: current.revision, identity: current.fileIdentity, objectIdentity: object } };
    }).catch(() => { throw unsafe(); });
  }

  /** Explicit schema7 READ only; ordinary schema/type/read remain1..6 and reject
   * this catalog. Staged bytes are NOT proof of authorized publication/readiness. */
  async inspectInitialGenerationMaturity(binding: Binding, registeredExecutionDigest: string,
    journal: Pick<TransactionJournalStore, "scan">, receipts: Pick<OperationStore, "list">, authorize: () => undefined) {
    try { binding = structuredClone(binding); } catch { throw unsafe(); }
    return this.exclusive(async () => (await this.inspectMaturityCatalog(binding, registeredExecutionDigest, journal, receipts, authorize)).result)
      .catch(() => { throw unsafe(); });
  }

  private async inspectMaturityPublication(binding: Binding, checked: Awaited<ReturnType<WorldLibraryStore["inspectMaturityCatalog"]>>,
    authorize: () => undefined, recheckLifecycle: () => Promise<void>) {
    const { result, evidence } = checked;
    const { catalogId, rootIdentity, generationGenesis } = result.catalog;
    await inspectInitialMaturityPublicationMetadata(path.dirname(this.#root), binding, {
      executionOperationId: generationGenesis.executionOperationId, worldId: generationGenesis.worldId,
      catalogId, rootIdentity, issuer: generationGenesis.issuer,
      genesisCatalogRevision: evidence.issued.reference.reference.snapshot.checksum,
      birthProofDigest: evidence.issued.reference.proofDigest,
      catalog: { checksum: result.revision, objectIdentity: result.objectIdentity }
    }, async () => {
      await evidence.recheck();
      await recheckLifecycle();
    }, authorize);
  }

  private async inspectMaturityCatalog(binding: Binding, registeredExecutionDigest: string,
    journal: Pick<TransactionJournalStore, "scan">, receipts: Pick<OperationStore, "list">, authorize: () => undefined,
    lifecycle?: CatalogLifecycleEvidence) {
      const directory = await this.directory(binding), directoryIdentity = await backupDirectoryIdentity(directory);
      const file = path.join(directory, "state.json"), object = await generationReferenceObjectWitness(file);
      const saved = await readPrivatePropertiesFile(file, 1024 * 1024);
      let catalog: InitialMatureCatalog;
      try {
        const text = saved.bytes.toString("utf8"), value: unknown = JSON.parse(text);
        if (!saved.bytes.equals(Buffer.from(text, "utf8")) || !Value.Check(initialMatureSchema, value) ||
            text !== JSON.stringify(value) + "\n" || value.serverId !== binding.serverId) throw unsafe();
        catalog = structuredClone(value);
      } finally { saved.bytes.fill(0); }
      if (lifecycle) {
        const stop = lifecycle.stop.worldLifecycle;
        if (!matchesWorldLifecycleStop(lifecycle.start, lifecycle.stop, lifecycle.launch) || stop?.action !== "stop" ||
            lifecycle.stop.operation.state !== "running" || lifecycle.stop.operation.step !== "running" ||
            lifecycle.stop.operation.result !== null || lifecycle.stop.operation.error !== null ||
            stop.serverId !== binding.serverId || stop.worldId !== catalog.generationGenesis.worldId || stop.catalogRevision !== saved.checksum ||
            stop.rootIdentity !== catalog.rootIdentity || stop.registeredExecutionDigest !== registeredExecutionDigest ||
            stop.worldDirectoryIdentity !== catalog.entries.find(entry => entry.worldId === stop.worldId)?.directoryIdentity ||
            !validWorldLifecycleStopSeal(lifecycle.revision) || lifecycle.revision.stopOperationId !== lifecycle.stop.operation.id ||
            lifecycle.revision.stopIntentDigest !== digest(JSON.stringify(lifecycle.stop))) throw unsafe();
      }
      const evidence = await this.initialMaturityEvidence(binding, catalog.generationGenesis.executionOperationId,
        catalog.generationGenesis.issuer, registeredExecutionDigest, journal, receipts, authorize, lifecycle);
      if (catalog.catalogId !== evidence.snapshot.catalogId || catalog.rootIdentity !== evidence.snapshot.rootIdentity ||
          catalog.generationGenesis.worldId !== evidence.issued.seed.worldId ||
          JSON.stringify(catalog.entries) !== JSON.stringify(evidence.snapshot.entries)) throw unsafe();
      await evidence.recheck();
      const final = await readPrivatePropertiesFile(file, 1024 * 1024);
      try { if (final.checksum !== saved.checksum || final.identity !== saved.identity ||
          await generationReferenceObjectWitness(file) !== object) throw unsafe(); }
      finally { final.bytes.fill(0); }
      await this.closeInitialMaturity(binding, catalog.generationGenesis.executionOperationId, directoryIdentity, evidence);
      return { result: { inspectionOnly: true as const, recoveryRequired: true as const, catalogPublicationVerified: false as const,
        catalog: structuredClone(catalog), revision: saved.checksum, objectIdentity: object }, evidence };
  }

  /** Original published metadata, explicitly sourced from immutable snapshot6,
   * fenced by current7 controls. Internal physical-verifier input, not an API. */
  async readInitialMaturePublishedEvidence(binding: Binding, registeredExecutionDigest: string,
    journal: Pick<TransactionJournalStore, "scan">, receipts: Pick<OperationStore, "list">, authorize: () => undefined) {
    try { binding = structuredClone(binding); } catch { throw unsafe(); }
    return this.exclusive(async () => {
      const checked = await this.inspectMaturityCatalog(binding, registeredExecutionDigest, journal, receipts, authorize);
      const evidence = checked.evidence, snapshot = evidence.snapshot, original = evidence.issued.reference.reference;
      return { prepared: { reservation: structuredClone(snapshot.generation!.reservation), record: structuredClone(evidence.parent),
        catalogRevision: original.snapshot.checksum,
        // This is the actual retained snapshot inode, NOT the old mutable6 inode.
        catalogFileIdentity: original.snapshot.identity, catalogSource: "immutable-genesis-snapshot" as const,
        previousDirectoryIdentity: snapshot.entries[0]!.directoryIdentity, recordDigest: original.recordDigest },
        birth: structuredClone(evidence.birth), receiptDigest: evidence.issued.reference.receiptDigest, inspectionOnly: true as const,
        maturity: { revision: checked.result.revision, objectIdentity: checked.result.objectIdentity,
          issuer: structuredClone(checked.result.catalog.generationGenesis.issuer),
          birthProofDigest: evidence.issued.reference.proofDigest,
          installedSlot: structuredClone(evidence.issued.installedSlot), catalogPublicationVerified: false as const } };
    }).catch(() => { throw unsafe(); });
  }

  /** Closed metadata for the dedicated stopped-generation issuer. The caller
   * holds the existing instance inspection lease and separately proves the
   * physical stopped revision; this snapshot never grants recovery release. */
  async inspectStoppedInitialGeneration(binding: Binding, registeredExecutionDigest: string,
    journal: Pick<TransactionJournalStore, "scan">, receipts: Pick<OperationStore, "list" | "read" | "readWorldLaunchSeal" | "readWorldStopSeal">,
    lifecycle: CatalogLifecycleEvidence, authorize: () => undefined) {
    const retained = structuredClone(binding), expected = structuredClone(lifecycle);
    return this.exclusive(async () => {
      const checked = await this.inspectMaturityCatalog(retained, registeredExecutionDigest, journal, receipts, authorize, expected);
      await this.inspectMaturityPublication(retained, checked, authorize, async () => {
        const current = await readWorldLifecycleStopEvidence(receipts, expected.start.operation.id, expected.stop.operation.id);
        if (JSON.stringify(current) !== JSON.stringify(expected)) throw unsafe();
      });
      const entry = checked.result.catalog.entries.find(item => item.worldId === expected.stop.worldLifecycle?.worldId);
      if (!entry || entry.state !== "present") throw unsafe();
      return { serverId: retained.serverId, levelName: entry.levelName, worldId: entry.worldId,
        preparationOperationId: checked.evidence.parent.intent.operationId,
        executionOperationId: checked.result.catalog.generationGenesis.executionOperationId,
        catalogId: checked.result.catalog.catalogId,
        catalog: { checksum: checked.result.revision, objectIdentity: checked.result.objectIdentity },
        genesis: { checksum: checked.evidence.issued.reference.reference.snapshot.checksum,
          objectIdentity: checked.evidence.issued.reference.objects.snapshot }, inspectionOnly: true as const };
    }).catch(() => { throw unsafe(); });
  }

  /** Publish a pending entry only during the original verified live execution.
   * Neither this CAS nor a readable schema6 releases any recovery permission. */
  async publishGenerationBirth(binding: Binding, value: unknown, journal: Pick<TransactionJournalStore, "scan">,
    receipts: Pick<OperationStore, "list">, recheckLive: () => Promise<void>, assertLive: () => undefined) {
    if (typeof recheckLive !== "function" || typeof assertLive !== "function") throw unsafe();
    const birth = readGenerationBirth(value), authorize = () => {
      const result: unknown = assertLive();
      if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw unsafe(); }
    };
    return this.exclusive(async () => {
      const prepared = await this.preparedGeneration(binding, journal, true), current = await this.read(binding), storedBirth = await this.birthRecord(binding);
      const receipt = await this.executionReceipt(birth.execution, receipts), g = prepared.reservation;
      const parent = await this.generationParentReceipt(binding, prepared.record, receipts);
      if (!current || current.record.schemaVersion !== 5 || current.revision !== prepared.catalogRevision ||
          JSON.stringify(current.record.generationExecution) !== JSON.stringify(birth.execution) ||
          JSON.stringify(storedBirth.value) !== JSON.stringify(birth) || birth.execution.preparedRecordDigest !== prepared.recordDigest ||
          receipt.operation.state !== "running" || receipt.operation.step !== "generation-birth-awaiting-catalog-publication") throw unsafe();
      const recheckPersistent = async () => {
        const scan = await journal.scan();
        if (scan.issues.some(issue => !issue.serverId || issue.serverId === binding.serverId) ||
            JSON.stringify(scan.records.filter(record => record.intent.serverId === binding.serverId)) !== JSON.stringify([prepared.record]) ||
            JSON.stringify(await this.executionReceipt(birth.execution, receipts)) !== JSON.stringify(receipt) ||
            JSON.stringify(await this.generationParentReceipt(binding, prepared.record, receipts)) !== JSON.stringify(parent)) throw unsafe();
        const value = await this.birthRecord(binding);
        if (value.checksum !== storedBirth.checksum || value.identity !== storedBirth.identity) throw unsafe();
      };
      const entry: StoredEntry = { worldId: g.worldId, levelName: g.nextName, state: "present", origin: "generation",
        createdAt: this.clock.now().toISOString(), legacySlotId: null, legacyBackupAssociation: "unverified",
        directoryIdentity: birth.candidate.directoryIdentity, operationId: birth.execution.executionOperationId,
        replacesWorldId: null, admissionRevision: current.revision };
      const next: LibraryRecord = { ...current.record, schemaVersion: 6, entries: [...current.record.entries, entry],
        generationPublication: { birthChecksum: storedBirth.checksum, birthIdentity: storedBirth.identity, entryDigest: digest(JSON.stringify(entry)), admissionRevision: current.revision } };
      checkRecordStructure(next, binding.serverId);
      await recheckLive();
      const directory = await this.directory(binding), identity = await backupDirectoryIdentity(directory);
      const file = path.join(directory, "state.json"), temporary = file + "." + randomUUID() + ".tmp", payload = JSON.stringify(next) + "\n";
      authorize();
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(payload, "utf8"); await handle.sync(); } finally { await handle.close(); }
      await recheckLive();
      await this.generationPublicationStage({ directory, temporary, payload, identity, binding, rootIdentity: current.record.rootIdentity });
      await recheckPersistent();
      const old = await readPrivatePropertiesFile(file, 1024 * 1024);
      try { if (old.checksum !== current.revision || old.identity !== current.fileIdentity) throw unsafe(); } finally { old.bytes.fill(0); }
      authorize();
      await rename(temporary, file); await syncRestoreDirectory(directory);
      this.#observed.delete(binding.serverId);
      const saved = await this.read(binding);
      if (!saved || saved.revision !== digest(payload)) throw unsafe();
      await recheckLive();
      await recheckPersistent();
      const final = await this.read(binding);
      if (!final || final.revision !== saved.revision || final.fileIdentity !== saved.fileIdentity) throw unsafe();
      authorize();
      return { catalogRevision: final.revision, worldId: entry.worldId, inspectionOnly: true as const };
    });
  }

  private async generationPublicationStage(value: { directory: string; temporary: string; payload: string; identity: string; binding: Binding; rootIdentity: string }) {
    const staged = await readPrivatePropertiesFile(value.temporary, 1024 * 1024);
    try { if (staged.checksum !== digest(value.payload)) throw unsafe(); } finally { staged.bytes.fill(0); }
    if (await backupDirectoryIdentity(value.directory) !== value.identity || await backupDirectoryIdentity(value.binding.rootPath) !== value.rootIdentity) throw unsafe();
    const names = new Set(["state.json", path.basename(value.temporary)]);
    for await (const item of await opendir(value.directory)) { if (!names.delete(item.name) || !item.isFile() || item.isSymbolicLink()) throw unsafe(); }
    if (names.size) throw unsafe();
  }

  async reserveActivation(binding: Binding, expectedRevision: string, intent: TransactionJournalRecord,
    committedHistory: readonly TransactionJournalRecord[]): Promise<string> {
    return this.exclusive(async () => {
      const current = await this.read(binding), value = intent.intent.worldActivation;
      if (!current || current.revision !== expectedRevision || !value || intent.intent.serverId !== binding.serverId ||
          value.libraryRevision !== expectedRevision ||
          intent.state !== "active" || intent.checkpoints.length !== 0 || value.catalogId !== current.record.catalogId ||
          value.rootIdentity !== current.record.rootIdentity) throw unsafe();
      const history = orderedActivationHistory(binding.serverId, committedHistory), head = headOf(current.record);
      this.checkHead(head, history);
      const previous = history.at(-1);
      if (value.sequence !== history.length + 1 || (previous ? value.predecessorTransactionId !== previous.transactionId ||
          value.previousWorldId !== previous.intent.worldActivation!.worldId : value.predecessorTransactionId !== null)) throw unsafe();
      // Validate the proposed transition structurally without asserting that it
      // has physically completed or publishing a committed journal record.
      orderedActivationHistory(binding.serverId, [...history, { ...intent, state: "committed" }]);
      for (const [id, name, directory] of [[value.previousWorldId, value.previousName, value.currentDirectoryIdentity],
        [value.worldId, value.nextName, value.targetDirectoryIdentity]]) {
        const entry = current.record.entries.find(item => item.worldId === id && item.state === "present");
        if (!entry || entry.levelName !== name || entry.directoryIdentity !== directory ||
            await this.physical(binding, entry.levelName) !== directory) throw unsafe();
      }
      return this.commit(binding, withTransitionHead(current.record, {
        sequence: value.sequence, transactionId: intent.transactionId, intentDigest: digest(JSON.stringify(intent.intent)),
        previousDigest: digest(JSON.stringify(history)), state: "pending", recordDigest: null }), current.revision);
    });
  }

  private checkHead(head: ActivationHead | undefined, history: readonly TransactionJournalRecord[]): void {
    const last = history.at(-1);
    if (!head) { if (last) throw unsafe(); return; }
    if (head.state !== "committed" || !last || head.sequence !== history.length || head.transactionId !== last.transactionId ||
        head.intentDigest !== digest(JSON.stringify(last.intent)) || head.recordDigest !== digest(JSON.stringify(history)) ||
        head.previousDigest !== digest(JSON.stringify(history.slice(0, -1)))) throw unsafe();
  }

  /** Reserves only a pending replacement tail. Caller holds the instance lease,
   * has persisted a validated schema12 intent, and separately checks active state,
   * approval/source revisions and protection. No retirement or data move occurs.
   * There is deliberately no generic completion/recovery authority here.
   */
  async reserveReplacement(binding: Binding, expectedRevision: string, original: TransactionJournalRecord,
    committedHistory: readonly TransactionJournalRecord[], admission?: { phase: "before-reservation"; recordDigest: string; recheck: () => Promise<void> }): Promise<string> {
    const intent = structuredClone(original), records = structuredClone(committedHistory);
    if (intent.schemaVersion === 13) {
      verifyReplacementAdmissionPrefix(intent);
      if (intent.checkpoints.length !== 5 || admission?.phase !== "before-reservation" ||
          admission.recordDigest !== digest(JSON.stringify(intent)) || typeof admission.recheck !== "function") throw unsafe();
      // Filesystem-only proof outside the nonreentrant catalog lock. The catalog
      // object identity, exact head and revision are compared again inside CAS.
      await admission.recheck();
    }
    // Validate both directions before taking the publication lock. The exact
    // expected revision and original head are checked again inside that lock.
    await this.projectTransitionHistory(binding, records);
    return this.exclusive(async () => {
      const current = await this.read(binding), value = intent.intent.worldReplacement;
      if (!current || current.revision !== expectedRevision || ![12, 13].includes(intent.schemaVersion) || !value ||
          intent.intent.worldActivation || intent.intent.kind !== "world-replace" || intent.intent.serverId !== binding.serverId ||
          intent.intent.resourceId !== value.worldId || intent.state !== "active" ||
          (intent.schemaVersion === 12 ? intent.checkpoints.length !== 0 || value.approval !== undefined :
            intent.checkpoints.length !== 5 || current.fileIdentity !== value.approval!.catalogFileIdentity) ||
          value.libraryRevision !== expectedRevision || value.catalogId !== current.record.catalogId || value.rootIdentity !== current.record.rootIdentity ||
          !uuid.test(intent.transactionId.toLowerCase()) || !uuid.test(intent.intent.operationId.toLowerCase()) ||
          !uuid.test(value.guardBackupId.toLowerCase()) || !value.worldId.startsWith("worldv2-") || !uuid.test(value.worldId.slice(8)) ||
          current.record.entries.length >= 1000 || current.record.entries.some(entry => entry.worldId === value.worldId ||
            entry.operationId === intent.intent.operationId.toLowerCase())) throw unsafe();
      const history = orderedWorldTransitionRecords(binding.serverId, records), events = history.map(worldTransitionEvent);
      this.checkHead(headOf(current.record), history);
      const last = events.at(-1);
      if (value.sequence !== history.length + 1 || (last ? value.predecessorTransactionId?.toLowerCase() !== last.transactionId ||
          value.previousWorldId !== last.next.worldId : value.predecessorTransactionId !== null) ||
          events.some(event => event.operationId === intent.intent.operationId.toLowerCase() ||
            event.guardBackupId === value.guardBackupId.toLowerCase())) throw unsafe();
      const previous = current.record.entries.find(entry => entry.worldId === value.previousWorldId && entry.state === "present");
      if (!previous || value.confirmationName !== previous.levelName || value.levelName !== previous.levelName ||
          previous.directoryIdentity !== value.currentDirectoryIdentity ||
          await this.physical(binding, previous.levelName) !== value.currentDirectoryIdentity ||
          await directoryObjectIdentity(path.join(binding.rootPath, previous.levelName)) !== value.currentObjectIdentity) throw unsafe();
      return this.commit(binding, withTransitionHead(current.record, {
        sequence: value.sequence, transactionId: intent.transactionId, intentDigest: digest(JSON.stringify(intent.intent)),
        previousDigest: digest(JSON.stringify(history)), state: "pending", recordDigest: null }), current.revision,
        intent.schemaVersion === 13 ? value.approval!.catalogFileIdentity : undefined);
    });
  }

  /** Only after physical completion and committed journal publication. A crash
   * before this publication leaves pending evidence, never an accepted prefix. */
  async completeReplacement(binding: Binding, expectedRevision: string, originalRecords: readonly TransactionJournalRecord[],
    installed: { phase: "installed-files"; recordDigest: string; recheck: () => Promise<void> }): Promise<string> {
    const records = structuredClone(originalRecords), history = orderedWorldTransitionRecords(binding.serverId, records), last = history.at(-1);
    const value = last?.intent.worldReplacement;
    if (!last || last.schemaVersion !== 13 || !value?.approval || installed.phase !== "installed-files" ||
        installed.recordDigest !== digest(JSON.stringify(last)) || typeof installed.recheck !== "function") throw unsafe();
    // Caller owns instance/upload leases and verifies journal freshness and the
    // prefix's physical history separately. Proof runs outside this store lock.
    const verify = installed.recheck;
    await verify();
    const published = await this.exclusive(async () => {
      const current = await this.read(binding), head = current ? headOf(current.record) : undefined;
      if (!current || current.revision !== expectedRevision || current.record.schemaVersion !== 3 || !head || head.state !== "pending" ||
          head.sequence !== history.length || head.transactionId !== last.transactionId || head.intentDigest !== digest(JSON.stringify(last.intent)) ||
          head.previousDigest !== digest(JSON.stringify(history.slice(0, -1))) || value.catalogId !== current.record.catalogId ||
          value.rootIdentity !== current.record.rootIdentity) throw unsafe();
      const workspace = path.join(binding.rootPath, value.workspaceName), markers = (name: string) => last.checkpoints.find(point => point.name === name)!.details!;
      if (await directoryObjectIdentity(workspace) !== markers("replacement-workspace-created").filesystemIdentity) throw unsafe();
      const copy = await readPrivatePropertiesFile(path.join(workspace, "catalog.before"), 1024 * 1024);
      try {
        const checkpoint = markers("replacement-catalog-before-verified");
        if (copy.identity !== checkpoint.filesystemIdentity || copy.checksum !== checkpoint.checksumSha256) throw unsafe();
        verifyReplacementCatalogSnapshot(copy.bytes, last, history.slice(0, -1));
        const before = JSON.parse(copy.bytes.toString("utf8")) as LibraryRecord;
        if (JSON.stringify(before.entries) !== JSON.stringify(current.record.entries)) throw unsafe();
      } finally { copy.bytes.fill(0); }
      const event = worldTransitionEvent(last), nextDirectory = await this.physical(binding, value.levelName);
      if (nextDirectory !== event.next.directoryIdentity || await directoryObjectIdentity(path.join(binding.rootPath, value.levelName)) !== markers("replacement-world-installed").filesystemIdentity ||
          await directoryObjectIdentity(path.join(workspace, "previous-world")) !== value.currentObjectIdentity ||
          await directoryObjectIdentity(workspace) !== markers("replacement-workspace-created").filesystemIdentity) throw unsafe();
      const entries: StoredEntry[] = current.record.entries.map(entry => entry.worldId === value.previousWorldId ? { ...entry, state: "retired" } : entry);
      entries.push({ worldId: value.worldId, levelName: value.levelName, state: "present", origin: "import", createdAt: this.clock.now().toISOString(),
        legacySlotId: null, legacyBackupAssociation: "unverified", directoryIdentity: nextDirectory, operationId: last.intent.operationId.toLowerCase(),
        replacesWorldId: value.previousWorldId, admissionRevision: value.libraryRevision });
      const revision = await this.commit(binding, withTransitionHead({ ...current.record, entries }, { ...head, state: "committed", recordDigest: digest(JSON.stringify(history)) }),
        current.revision, current.fileIdentity);
      const readback = await this.read(binding);
      if (!readback || readback.revision !== revision) throw unsafe();
      return { revision, fileIdentity: readback.fileIdentity };
    });
    try {
      await verify();
      await this.exclusive(async () => {
        const current = await this.read(binding);
        if (!current || current.revision !== published.revision || current.fileIdentity !== published.fileIdentity) throw unsafe();
        this.checkHead(headOf(current.record), history);
      });
    }
    catch {
      // Exact CAS only; failure/changed tail retains inspection evidence and is
      // not a license to rewrite a newer head or the committed journal.
      try { await this.invalidateReplacement(binding, published.revision, history); } catch { /* Caller must retain recovery; no data rollback. */ }
      throw unsafe();
    }
    return published.revision;
  }

  /** Activation-only publication remains separate from schema13 replacement. */
  async completeActivation(binding: Binding, expectedRevision: string, records: readonly TransactionJournalRecord[]): Promise<string> {
    return this.exclusive(async () => {
      const current = await this.read(binding), history = orderedActivationHistory(binding.serverId, records), last = history.at(-1);
      const head = current ? headOf(current.record) : undefined;
      if (!current || current.revision !== expectedRevision || !last || !head || head.state !== "pending" ||
          head.sequence !== history.length || head.transactionId !== last.transactionId ||
          head.intentDigest !== digest(JSON.stringify(last.intent)) || head.previousDigest !== digest(JSON.stringify(history.slice(0, -1))) ||
          last.intent.worldActivation!.catalogId !== current.record.catalogId ||
          last.intent.worldActivation!.rootIdentity !== current.record.rootIdentity) throw unsafe();
      return this.commit(binding, withExistingHead(current.record, { ...head, state: "committed", recordDigest: digest(JSON.stringify(history)) }), current.revision);
    });
  }

  /** Read-only durable-tail check. This grants no physical recovery authority. */
  async invalidateActivation(binding: Binding, record: TransactionJournalRecord): Promise<void> {
    return this.exclusive(async () => {
      const current = await this.read(binding), head = current ? headOf(current.record) : undefined;
      if (!current || !head || head.transactionId !== record.transactionId || record.intent.serverId !== binding.serverId ||
          head.intentDigest !== digest(JSON.stringify(record.intent))) throw unsafe();
      if (head.state === "pending") return;
      // Terminal journals remain immutable. A failed final physical check must
      // leave a separate durable inspection gate, not rewrite committed history.
      await this.commit(binding, withExistingHead(current.record, { ...head, state: "pending", recordDigest: null }), current.revision);
    });
  }

  /** Fail-closed CAS after a replacement publication fails its final physical
   * check. Never alters journal/world bytes, retires an extra entry or touches a
   * newer/different head. Caller must retain the operation recovery cause.
   */
  async invalidateReplacement(binding: Binding, expectedRevision: string, original: readonly TransactionJournalRecord[]): Promise<void> {
    const records = structuredClone(original);
    return this.exclusive(async () => {
      const current = await this.read(binding), history = orderedWorldTransitionRecords(binding.serverId, records), last = history.at(-1);
      const head = current ? headOf(current.record) : undefined, value = last?.intent.worldReplacement;
      if (!current || current.revision !== expectedRevision || current.record.schemaVersion !== 3 || !last || !value || !head ||
          value.catalogId !== current.record.catalogId || value.rootIdentity !== current.record.rootIdentity ||
          head.sequence !== history.length || head.transactionId !== last.transactionId ||
          head.intentDigest !== digest(JSON.stringify(last.intent)) || head.previousDigest !== digest(JSON.stringify(history.slice(0, -1))) ||
          (head.state === "committed" && head.recordDigest !== digest(JSON.stringify(history)))) throw unsafe();
      if (head.state === "pending") return;
      await this.commit(binding, withTransitionHead(current.record, { ...head, state: "pending", recordDigest: null }), current.revision);
    });
  }

  /** Read-only durable-tail check. This grants no physical recovery authority. */
  async hasActivationHead(binding: Binding): Promise<boolean> {
    return this.exclusive(async () => {
      const current = await this.read(binding);
      if (!current) throw unsafe();
      return headOf(current.record) !== undefined;
    });
  }

  /** Read-only durable-tail check. This grants no physical recovery authority. */
  async auditActivationHead(binding: Binding, records: readonly TransactionJournalRecord[]): Promise<void> {
    return this.exclusive(async () => {
      const current = await this.read(binding);
      if (!current) throw unsafe();
      const history = orderedActivationHistory(binding.serverId, records);
      if (history.some(record => record.intent.worldActivation!.catalogId !== current.record.catalogId ||
          record.intent.worldActivation!.rootIdentity !== current.record.rootIdentity)) throw unsafe();
      this.checkHead(headOf(current.record), history);
    });
  }

  /** Compatibility observation for the forthcoming unified transition reader.
   * Requires the unchanged activation-only head over ORIGINAL journal bytes first;
   * normalized UUIDs never replace the saved digest. No catalog migration,
   * filesystem recovery confirmation or acceptance of replacement records.
   */
  async projectLegacyTransitions(binding: Binding, records: readonly TransactionJournalRecord[]) {
    return this.exclusive(async () => {
      const current = await this.read(binding);
      if (!current) throw unsafe();
      const events = activationTransitionEvents(binding.serverId, records);
      if (events.some(event => event.catalogId !== current.record.catalogId.toLowerCase() || event.rootIdentity !== current.record.rootIdentity)) throw unsafe();
      this.checkHead(headOf(current.record), orderedActivationHistory(binding.serverId, records));
      const projected = projectWorldTransitions(binding.serverId, events);
      if ((await this.read(binding))?.revision !== current.revision) throw unsafe();
      return projected;
    });
  }

  /** Structural head/catalog observation only. Birth-only entries, guards,
   * preserved directories, uploads and live state require separate verification.
   * This cannot clear a recovery cause or enable replacement execution.
   */
  async projectTransitionHistory(binding: Binding, records: readonly TransactionJournalRecord[]) {
    return this.exclusive(async () => {
      const current = await this.read(binding);
      if (!current) throw unsafe();
      const history = orderedWorldTransitionRecords(binding.serverId, records), events = history.map(worldTransitionEvent);
      if ((events.some(event => event.kind === "replacement") && current.record.schemaVersion !== 3) ||
          events.some(event => event.catalogId !== current.record.catalogId.toLowerCase() || event.rootIdentity !== current.record.rootIdentity)) throw unsafe();
      this.checkHead(headOf(current.record), history);
      const projected = projectWorldTransitions(binding.serverId, events);
      for (const world of projected.worlds) {
        const entry = current.record.entries.find(item => item.worldId === world.worldId);
        if (!entry || entry.levelName !== world.levelName || entry.directoryIdentity !== world.directoryIdentity || entry.state !== world.state) throw unsafe();
      }
      for (const record of history) {
        const replacement = record.intent.worldReplacement;
        if (!replacement) continue;
        const entry = current.record.entries.find(item => item.worldId === replacement.worldId);
        if (!entry || entry.origin !== "import" || entry.legacySlotId !== null || entry.operationId !== record.intent.operationId.toLowerCase() ||
            entry.replacesWorldId !== replacement.previousWorldId || entry.admissionRevision !== replacement.libraryRevision) throw unsafe();
      }
      const replacements = history.filter(record => record.intent.worldReplacement);
      for (const entry of current.record.entries) {
        if (entry.state === "retired" && replacements.filter(record => record.intent.worldReplacement!.previousWorldId === entry.worldId).length !== 1) throw unsafe();
        if (entry.replacesWorldId !== null) {
          const owners = replacements.filter(record => record.intent.worldReplacement!.worldId === entry.worldId);
          if (owners.length !== 1 || owners[0]!.intent.worldReplacement!.previousWorldId !== entry.replacesWorldId ||
              entry.operationId !== owners[0]!.intent.operationId.toLowerCase() ||
              entry.admissionRevision !== owners[0]!.intent.worldReplacement!.libraryRevision) throw unsafe();
        }
      }
      if ((await this.read(binding))?.revision !== current.revision) throw unsafe();
      return projected;
    });
  }

  /** Backend-only journal binding. Never serialize catalog/physical ownership. */
  async activationBinding(binding: Binding, worldId: string, expectedRevision: string) {
    return this.exclusive(async () => {
      const saved = await this.read(binding);
      const entry = saved?.record.entries.find(item => item.worldId === worldId && item.state === "present");
      if (!saved || saved.record.generation || saved.revision !== expectedRevision || !entry || entry.origin === "generation" ||
          await this.physical(binding, entry.levelName) !== entry.directoryIdentity) throw unsafe();
      return { catalogId: saved.record.catalogId, directoryIdentity: entry.directoryIdentity,
        operationId: entry.operationId, levelName: entry.levelName, origin: entry.origin };
    });
  }

  /** Backend preflight binding for later queued/journaled operations. No filesystem path
   * or content is returned; callers must still hold/recheck the shared instance lease.
   */
  async resolve(binding: Binding, worldId: string, expectedLibraryRevision: string): Promise<{
    worldId: string; levelName: string; worldRevision: string;
  }> {
    return this.exclusive(async () => {
      const current = await this.read(binding);
      if (!current || current.record.generation || current.revision !== expectedLibraryRevision) throw unsafe();
      const entry = current.record.entries.find(item => item.worldId === worldId && item.state === "present");
      if (!entry || await this.physical(binding, entry.levelName) !== entry.directoryIdentity) throw unsafe();
      const level = await readPrivatePropertiesFile(path.join(binding.rootPath, entry.levelName, "level.dat"), 8 * 1024 * 1024);
      const checksum = level.checksum; level.bytes.fill(0);
      if (await this.physical(binding, entry.levelName) !== entry.directoryIdentity ||
          (await this.read(binding))?.revision !== expectedLibraryRevision) throw unsafe();
      return { worldId, levelName: entry.levelName,
        worldRevision: digest(`world-revision-v2\0${worldId}\0${entry.directoryIdentity}\0${checksum}`) };
    });
  }

  /** Independent journal evidence prevents an older/missing catalog from silently
   * dropping a completed V2 installation. Does not execute or repair transactions.
   */
  async auditImportBindings(binding: Binding, records: readonly TransactionJournalRecord[], allowUnadopted = false,
    generationEvidence?: { journal: Pick<TransactionJournalStore, "scan">; receipts: Pick<OperationStore, "list" | "read" | "readWorldLaunchSeal" | "readWorldStopSeal">;
      registeredExecutionDigest?: string; authorize?: () => undefined }): Promise<void> {
    return this.exclusive(async () => {
      const relevant = records.filter(record => record.intent.serverId === binding.serverId && record.intent.worldLibraryImport);
      // Startup-only classification: no ordinary import work, NOT ready. The
      // normal reader below still rejects7 in every other context.
      if (allowUnadopted && relevant.length === 0 && generationEvidence?.registeredExecutionDigest) {
        let version: unknown;
        try {
          const file = await readPrivatePropertiesFile(path.join(await this.directory(binding), "state.json"), 1024 * 1024);
          try { version = JSON.parse(file.bytes.toString("utf8")).schemaVersion; } finally { file.bytes.fill(0); }
        } catch (error) { if (!missingFile(error)) throw unsafe(); }
        if (version === 7) {
          if (typeof generationEvidence.authorize !== "function") throw unsafe();
          const scoped = (await generationEvidence.receipts.list()).filter(record => record.operation.serverId === binding.serverId && record.worldLifecycle);
          let lifecycle: CatalogLifecycleEvidence | undefined;
          if (scoped.length) {
            const start = scoped.find(record => record.worldLifecycle?.action === "start");
            const stop = scoped.find(record => record.worldLifecycle?.action === "stop");
            if (scoped.length !== 2 || !start || !stop) throw unsafe();
            lifecycle = await readWorldLifecycleStopEvidence(generationEvidence.receipts, start.operation.id, stop.operation.id);
            if (!lifecycle || JSON.stringify(lifecycle.start) !== JSON.stringify(start) || JSON.stringify(lifecycle.stop) !== JSON.stringify(stop)) throw unsafe();
          }
          const checked = await this.inspectMaturityCatalog(binding, generationEvidence.registeredExecutionDigest,
            generationEvidence.journal, generationEvidence.receipts, generationEvidence.authorize, lifecycle);
          await this.inspectMaturityPublication(binding, checked, generationEvidence.authorize, async () => {
            if (lifecycle && JSON.stringify(await readWorldLifecycleStopEvidence(generationEvidence.receipts,
              lifecycle.start.operation.id, lifecycle.stop.operation.id)) !== JSON.stringify(lifecycle)) throw unsafe();
          });
          return;
        }
      }
      let current;
      try { current = await this.read(binding); }
      catch (error) {
        if (!allowUnadopted || relevant.length || !missingFile(error)) throw error;
        await plainRestoreDirectory(path.dirname(this.#root));
        try { await lstat(this.#root); } catch (rootError) { if (missingFile(rootError)) return; throw rootError; }
        await plainRestoreDirectory(this.#root);
        for (const candidate of [path.join(this.#root, binding.serverId), path.join(this.#root, `${binding.serverId}.identity.json`)]) {
          try { await lstat(candidate); throw unsafe(); } catch (itemError) { if (!missingFile(itemError)) throw itemError; }
        }
        return;
      }
      if (!current) throw unsafe();
      if (current.record.generation) {
        // This exact first-generation catalog has no ordinary import work.
        // It remains recovery-gated; metadata evidence is not physical readiness.
        if (current.record.schemaVersion !== 6 || relevant.length !== 0 || current.record.entries.some(entry => entry.origin === "import") ||
            !generationEvidence?.journal || !generationEvidence.receipts) throw unsafe();
        const prepared = await this.publishedPreparation(binding, generationEvidence.journal, generationEvidence.receipts);
        const birth = await this.birthRecord(binding);
        const receipt = await this.executionReceipt(birth.value.execution, generationEvidence.receipts);
        if (prepared.catalogRevision !== current.revision || prepared.catalogFileIdentity !== current.fileIdentity ||
            !["succeeded", "interrupted"].includes(receipt.operation.state) ||
            birth.checksum !== current.record.generationPublication?.birthChecksum ||
            birth.identity !== current.record.generationPublication.birthIdentity) throw unsafe();
        return;
      }
      for (const entry of current.record.entries.filter(item => item.origin === "import")) {
        const owners = relevant.filter(record => record.intent.operationId === entry.operationId);
        if (owners.length !== 1) throw unsafe();
        const intent = owners[0]!.intent.worldLibraryImport!;
        if (intent.worldId !== entry.worldId || intent.targetName !== entry.levelName ||
            intent.libraryRevision !== entry.admissionRevision || entry.replacesWorldId !== null) throw unsafe();
      }
      for (const record of relevant.filter(item => item.state === "committed")) {
        const intent = record.intent.worldLibraryImport!;
        const entry = current.record.entries.find(item => item.worldId === intent.worldId && item.operationId === record.intent.operationId);
        if (!entry || entry.state !== "present" || await this.physical(binding, entry.levelName) !== entry.directoryIdentity) throw unsafe();
      }
    });
  }

  /** Dedicated first-replacement birth audit. Unlike the legacy auditor, the
   * explicitly retired predecessor is checked in its retained owned workspace.
   * No recovery authority, metadata mutation or arbitrary retirement allowance. */
  async auditReplacementImportBindings(binding: Binding, originalRecords: readonly TransactionJournalRecord[], replacement: TransactionJournalRecord) {
    const records = structuredClone(originalRecords), value = replacement.intent.worldReplacement;
    if (replacement.schemaVersion !== 13 || replacement.state !== "committed" || replacement.intent.serverId !== binding.serverId || !value) throw unsafe();
    return this.exclusive(async () => {
      const current = await this.read(binding); if (!current) throw unsafe();
      const births = records.filter(record => record.intent.serverId === binding.serverId && record.intent.worldLibraryImport);
      const steps = ["identity-intent-persisted", "independent-workspace-created", "independent-world-staged", "independent-world-install-intent", "independent-world-installed", "independent-identity-installed"];
      const ordinary = current.record.entries.filter(entry => entry.origin === "import" && entry.replacesWorldId === null);
      for (const entry of ordinary) {
        const owners = births.filter(record => record.intent.operationId === entry.operationId && record.intent.worldLibraryImport!.worldId === entry.worldId);
        if (owners.length !== 1) throw unsafe();
      }
      for (const record of births) {
        const imported = record.intent.worldLibraryImport!, owners = ordinary.filter(entry => entry.worldId === imported.worldId && entry.operationId === record.intent.operationId);
        if (owners.length !== 1 || record.state !== "committed" || record.schemaVersion !== 9 || imported.rootIdentity !== current.record.rootIdentity ||
            record.checkpoints.length !== steps.length || record.checkpoints.some((point, index) => point.name !== steps[index] || point.sequence !== index + 1)) throw unsafe();
        const entry = owners[0]!;
        if (entry.levelName !== imported.targetName || entry.admissionRevision !== imported.libraryRevision || entry.legacySlotId !== null) throw unsafe();
        const detail = (name: string) => record.checkpoints.find(point => point.name === name)!.details;
        const staged = detail("independent-world-staged"), installed = detail("independent-world-installed"), identity = detail("independent-identity-installed"), workspace = detail("independent-workspace-created");
        if (!staged?.filesystemIdentity || staged.resourceId !== entry.worldId || staged.checksumSha256 !== imported.importedChecksum ||
            installed?.filesystemIdentity !== staged.filesystemIdentity || installed?.resourceId !== entry.worldId || installed?.checksumSha256 !== imported.importedChecksum ||
            identity?.resourceId !== entry.worldId || identity?.checksumSha256 !== imported.importedChecksum || workspace?.resourceId !== entry.worldId ||
            await directoryObjectIdentity(path.join(binding.rootPath, imported.workspaceName)) !== workspace?.filesystemIdentity) throw unsafe();
        if (entry.state === "retired") {
          if (entry.worldId !== value.previousWorldId || entry.levelName !== value.levelName || entry.directoryIdentity !== value.currentDirectoryIdentity ||
              staged.filesystemIdentity !== value.currentObjectIdentity ||
              await directoryObjectIdentity(path.join(binding.rootPath, value.workspaceName, "previous-world")) !== staged.filesystemIdentity) throw unsafe();
        } else if (await this.physical(binding, entry.levelName) !== entry.directoryIdentity ||
            await directoryObjectIdentity(path.join(binding.rootPath, entry.levelName)) !== staged.filesystemIdentity) throw unsafe();
      }
      if ((await this.read(binding))?.revision !== current.revision) throw unsafe();
      return births;
    });
  }

  async list(binding: Binding, active: ActiveWorldState | null, proof?: { journal: Pick<TransactionJournalStore, "scan">; receipts: Pick<OperationStore, "list">;
    registeredExecutionDigest?: string; assertCurrent?: () => undefined; readLifecycle?: () => Promise<CatalogLifecycleEvidence | undefined> }): Promise<WorldLibraryResponse["data"]> {
    binding = structuredClone(binding); active = structuredClone(active);
    return this.exclusive(async () => {
      const failed: WorldLibraryResponse["data"] = { serverId: binding.serverId, state: "inspection-required", reason: "identity-unverified",
        revision: null, activeWorldId: null, items: [], mutationsAvailable: false };
      try {
        let current: Awaited<ReturnType<WorldLibraryStore["read"]>>;
        try { current = await this.read(binding); }
        catch {
          // Explicit initial7 metadata view only. Ordinary readers/mutators keep
          // rejecting7; an entry here confers no active-world or startup authority.
          if (!proof?.registeredExecutionDigest || !proof.assertCurrent || !active || active.serverId !== binding.serverId || active.state !== "active") return failed;
          const assertCurrent = proof.assertCurrent, registered = proof.registeredExecutionDigest;
          const authorize = (): undefined => {
            const result: unknown = assertCurrent();
            if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw unsafe(); }
            return undefined;
          };
          authorize();
          const lifecycle = structuredClone(await proof.readLifecycle?.());
          const checked = await this.inspectMaturityCatalog(binding, registered, proof.journal, proof.receipts, authorize, lifecycle);
          const generated = checked.result.catalog.entries.find(entry => entry.worldId === checked.result.catalog.generationGenesis.worldId);
          if (!generated || generated.state !== "present" || active.levelName !== generated.levelName ||
              active.worldId !== worldIdentity(binding.serverId, generated.levelName)) return failed;
          for (const entry of checked.result.catalog.entries.filter(item => item.state === "present")) {
            if (await this.physical(binding, entry.levelName) !== entry.directoryIdentity) return failed;
          }
          authorize();
          const final = await this.inspectMaturityCatalog(binding, registered, proof.journal, proof.receipts, authorize, lifecycle);
          if (lifecycle) await this.inspectMaturityPublication(binding, final, authorize, async () => {
            if (JSON.stringify(await proof.readLifecycle?.()) !== JSON.stringify(lifecycle)) throw unsafe();
          });
          authorize();
          if (JSON.stringify(final.result) !== JSON.stringify(checked.result)) return failed;
          return { ...failed, revision: final.result.revision,
            items: final.result.catalog.entries.map(entry => ({ worldId: entry.worldId, levelName: entry.levelName, state: entry.state,
              origin: entry.origin, createdAt: entry.createdAt, legacySlotId: entry.legacySlotId, legacyBackupAssociation: entry.legacyBackupAssociation })) };
        }
        if (current?.record.schemaVersion === 6) {
          if (!proof) return failed;
          const prepared = await this.publishedPreparation(binding, proof.journal, proof.receipts), g = prepared.reservation;
          if (!active || active.serverId !== binding.serverId || active.state !== "pending-generation" || active.levelName !== g.nextName ||
              active.worldId !== worldIdentity(binding.serverId, g.nextName)) return failed;
          for (const entry of current.record.entries) if (await this.physical(binding, entry.levelName) !== entry.directoryIdentity) return failed;
          if ((await this.read(binding))?.revision !== prepared.catalogRevision) return failed;
          return { ...failed, revision: prepared.catalogRevision,
            items: current.record.entries.map(entry => ({ worldId: entry.worldId, levelName: entry.levelName, state: entry.state,
              origin: entry.origin, createdAt: entry.createdAt, legacySlotId: entry.legacySlotId, legacyBackupAssociation: entry.legacyBackupAssociation })) };
        }
        if (!current || headOf(current.record)?.state === "pending" || !active || active.serverId !== binding.serverId) return failed;
        for (const entry of current.record.entries.filter(item => item.state === "present")) {
          if (await this.physical(binding, entry.levelName) !== entry.directoryIdentity) return failed;
        }
        if (proof?.assertCurrent) {
          proof.assertCurrent();
          const final = await this.read(binding);
          if (!final || final.revision !== current.revision || final.fileIdentity !== current.fileIdentity) return failed;
          proof.assertCurrent();
        }
        const selected = active.state === "active" ? current.record.entries.find(entry =>
          entry.state === "present" && entry.levelName === active.levelName) : undefined;
        if (active.state === "active" && !selected) return failed;
        return { serverId: binding.serverId, state: "ready", reason: null, revision: current.revision,
          activeWorldId: selected?.worldId ?? null, mutationsAvailable: false,
          items: current.record.entries.map(entry => ({ worldId: entry.worldId, levelName: entry.levelName,
            state: entry.state, origin: entry.origin, createdAt: entry.createdAt,
            legacySlotId: entry.legacySlotId, legacyBackupAssociation: entry.legacyBackupAssociation })) };
      } catch { return failed; }
    });
  }
}
