import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, opendir } from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { worldLibraryEntrySchema, type WorldLibraryEntry, type WorldLibraryResponse } from "@mcsm/contracts";
import type { Clock } from "../clock.js";
import type { ActiveWorldState } from "./active-world-state-store.js";
import { worldIdentity } from "./active-world-state-store.js";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { missingFile, plainRestoreDirectory, safeRestorePath, syncRestoreDirectory, writeRestoreJson } from "./restore-files.js";
import type { TransactionJournalRecord } from "./transaction-journal.js";

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
const recordSchema = Type.Object({ ...anchorSchema.properties,
  rootIdentity: hashSchema, entries: Type.Array(storedEntrySchema, { maxItems: 1000 })
}, { additionalProperties: false });
type StoredEntry = WorldLibraryEntry & { directoryIdentity: string; operationId: string | null; replacesWorldId: string | null; admissionRevision: string | null };
type LibraryRecord = { schemaVersion: 1; serverId: string; catalogId: string; rootIdentity: string; entries: StoredEntry[] };
type Binding = { serverId: string; rootPath: string };
const unsafe = () => new DomainError(409, "RECOVERY_REQUIRED", "World identity requires inspection", "world-library-identity-unverified", true);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const validName = (value: string) => value.length <= 128 && !value.startsWith(".") &&
  !value.includes("/") && safeRestorePath(value) && value.normalize("NFC") === value;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const allocateWorldIdentity = () => `worldv2-${randomUUID()}`;

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

  private async read(binding: Binding): Promise<{ record: LibraryRecord; revision: string } | null> {
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
    if (record.serverId !== binding.serverId || record.rootIdentity !== await backupDirectoryIdentity(binding.rootPath)) throw unsafe();
    const anchor = await readPrivatePropertiesFile(path.join(this.#root, `${binding.serverId}.identity.json`), 4096);
    let anchorValue: unknown;
    try { anchorValue = JSON.parse(anchor.bytes.toString("utf8")); } finally { anchor.bytes.fill(0); }
    if (!Value.Check(anchorSchema, anchorValue) || anchorValue.serverId !== binding.serverId ||
        anchorValue.catalogId !== record.catalogId || anchorValue.rootIdentity !== record.rootIdentity || !uuid.test(record.catalogId)) throw unsafe();
    const ids = new Set<string>(), liveNames = new Set<string>(), operations = new Set<string>();
    for (const entry of record.entries) {
      if (!validName(entry.levelName) || ids.has(entry.worldId) ||
          (entry.origin === "legacy-observation" ? entry.operationId !== null || entry.replacesWorldId !== null || entry.admissionRevision !== null || entry.legacySlotId !== worldIdentity(binding.serverId, entry.levelName)
            : !entry.operationId || !uuid.test(entry.operationId) || entry.admissionRevision === null || entry.legacySlotId !== null) ||
          (entry.operationId !== null && operations.has(entry.operationId))) throw unsafe();
      ids.add(entry.worldId); if (entry.operationId) operations.add(entry.operationId);
      const name = entry.levelName.toLowerCase();
      if (entry.state === "present") { if (liveNames.has(name)) throw unsafe(); liveNames.add(name); }
    }
    const observed = this.#observed.get(binding.serverId);
    if (observed && observed !== revision) throw unsafe();
    this.#observed.set(binding.serverId, revision);
    return { record, revision };
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

  private async commit(binding: Binding, record: LibraryRecord, previous: string | null): Promise<string> {
    const current = await this.read(binding);
    if ((current?.revision ?? null) !== previous || record.entries.length > 1000 ||
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

  /** Backend-only journal binding. Never serialize catalog/physical ownership. */
  async activationBinding(binding: Binding, worldId: string, expectedRevision: string) {
    return this.exclusive(async () => {
      const saved = await this.read(binding);
      const entry = saved?.record.entries.find(item => item.worldId === worldId && item.state === "present");
      if (!saved || saved.revision !== expectedRevision || !entry ||
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
      if (!current || current.revision !== expectedLibraryRevision) throw unsafe();
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
  async auditImportBindings(binding: Binding, records: readonly TransactionJournalRecord[], allowUnadopted = false): Promise<void> {
    return this.exclusive(async () => {
      const relevant = records.filter(record => record.intent.serverId === binding.serverId && record.intent.worldLibraryImport);
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

  async list(binding: Binding, active: ActiveWorldState | null): Promise<WorldLibraryResponse["data"]> {
    return this.exclusive(async () => {
      const failed: WorldLibraryResponse["data"] = { serverId: binding.serverId, state: "inspection-required", reason: "identity-unverified",
        revision: null, activeWorldId: null, items: [], mutationsAvailable: false };
      try {
        const current = await this.read(binding);
        if (!current || !active || active.serverId !== binding.serverId) return failed;
        for (const entry of current.record.entries.filter(item => item.state === "present")) {
          if (await this.physical(binding, entry.levelName) !== entry.directoryIdentity) return failed;
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
