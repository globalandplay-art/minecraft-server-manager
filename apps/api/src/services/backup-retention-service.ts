import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { Value } from "@sinclair/typebox/value";
import { backupRetentionResponseSchema, backupRetentionSettingsSchema, type BackupInfo, type BackupRetentionResponse,
  type BackupRetentionResult, type BackupRetentionRunRequest, type BackupRetentionUpdate } from "@mcsm/contracts";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Clock } from "../clock.js";
import { readBoundedRegularFile } from "../config/properties.js";
import { backupDirectoryIdentity } from "./backup-identity.js";
import type { BackupService } from "./backup-service.js";
import { DomainError } from "./domain-errors.js";
import type { OperationService } from "./operation-service.js";
import { missingFile, plainRestoreDirectory, safeRestorePath, syncRestoreDirectory, verifyRestoreTree, writeRestoreJson } from "./restore-files.js";
import { ServerNotFoundError } from "./server-service.js";
import type { TransactionJournalStore } from "./transaction-journal.js";

type Policy = BackupRetentionResponse["data"];
type Stored = Policy & { schemaVersion: 1; serverId: string; rootIdentity: string };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const unsafe = () => new DomainError(409, "RETENTION_STATE_UNSAFE", "备份保留状态不确定，已保留数据", "unsafe-retention-state");
const day = 86_400_000;
type Entry = { relative: string; identity: string; directory: boolean };
function fileIdentity(info: Awaited<ReturnType<typeof lstat>>): string {
  return `${info.dev}:${info.ino}:${info.birthtimeMs}:${info.size}:${info.mtimeMs}:${info.nlink}`;
}

/** Conservative union retention; bounded unlink only after a durable identity-bound intent. */
export class BackupRetentionService {
  #closed = false;
  #unsubscribe: (() => void) | undefined;
  #tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly registry: AdapterRegistry, private readonly operations: OperationService,
    private readonly backups: BackupService, private readonly journal: TransactionJournalStore,
    private readonly managerRoot: string, private readonly clock: Clock,
    private readonly inject?: (checkpoint: string) => Promise<void>) {}
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(action); this.#tail = next.catch(() => {}); return next;
  }
  private adapter(serverId: string) {
    if (!this.registry.get(serverId)) throw new ServerNotFoundError();
    const adapter = this.registry.getLocal(serverId);
    if (!adapter || adapter.plan.serverInfo.type !== "vanilla") throw new DomainError(501, "CAPABILITY_UNSUPPORTED", "保留策略仅支持本地 Vanilla", "unsupported-retention");
    return adapter;
  }
  private async directory() {
    await plainRestoreDirectory(this.managerRoot);
    const directory = path.join(this.managerRoot, "backup-retention");
    await mkdir(directory, { recursive: true, mode: 0o700 }); await plainRestoreDirectory(directory);
    return directory;
  }
  private public(record: Stored): Policy { return structuredClone({ revision: record.revision, settings: record.settings, lastRun: record.lastRun }); }
  private async load(serverId: string): Promise<Stored> {
    const adapter = this.adapter(serverId);
    let identity: string, file: string;
    try { identity = await backupDirectoryIdentity(adapter.plan.rootPath); file = path.join(await this.directory(), `${serverId}.json`); }
    catch { throw unsafe(); }
    try {
      const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw unsafe();
      const record = JSON.parse(await readBoundedRegularFile(file, 512 * 1024, "备份保留策略")) as Stored;
      if (!record || record.schemaVersion !== 1 || record.serverId !== serverId || record.rootIdentity !== identity ||
        !Value.Check(backupRetentionResponseSchema.properties.data, this.public(record)) ||
        Object.keys(record).some((key) => !["schemaVersion", "serverId", "rootIdentity", "revision", "settings", "lastRun"].includes(key))) throw unsafe();
      return record;
    } catch (error) {
      if (missingFile(error)) return { schemaVersion: 1, serverId, rootIdentity: identity, revision: hash(`default\0${serverId}\0${identity}`),
        settings: { enabled: false, retainCount: 10, retainDays: 7 }, lastRun: null };
      throw unsafe();
    }
  }
  private async save(record: Stored) {
    if (record.rootIdentity !== await backupDirectoryIdentity(this.adapter(record.serverId).plan.rootPath)) throw unsafe();
    await writeRestoreJson(path.join(await this.directory(), `${record.serverId}.json`), record);
    await syncRestoreDirectory(this.managerRoot);
  }
  get(serverId: string): Promise<Policy> { return this.serialize(async () => this.public(await this.load(serverId))); }
  update(serverId: string, body: BackupRetentionUpdate): Promise<Policy> {
    return this.serialize(() => this.operations.runExclusive(serverId, async () => {
      if (!Value.Check(backupRetentionSettingsSchema, body.settings)) throw new DomainError(400, "VALIDATION_ERROR", "保留策略格式无效");
      const record = await this.load(serverId); this.revision(record, body.revision);
      record.settings = { ...body.settings }; record.revision = hash(randomUUID()); await this.save(record); return this.public(record);
    }));
  }
  private revision(record: Stored, revision: string) {
    if (record.revision !== revision) throw new DomainError(409, "RETENTION_REVISION_CONFLICT", "保留策略已变化，请刷新后重新确认");
  }
  run(serverId: string, request: BackupRetentionRunRequest): Promise<Policy> {
    return this.serialize(() => this.operations.runExclusive(serverId, async () => {
      if (request.intent !== "apply-backup-retention") throw new DomainError(400, "VALIDATION_ERROR", "需要明确保留策略执行意图");
      const record = await this.load(serverId); this.revision(record, request.revision); await this.apply(record); return this.public(record);
    }));
  }
  start(): void {
    if (this.#closed || this.#unsubscribe) return;
    this.#unsubscribe = this.operations.subscribe((operation) => {
      if (this.#closed || operation.kind !== "backup" || operation.state !== "succeeded" || !operation.result?.resourceId) return;
      // The exclusive lease is acquired only after the operation executor releases its active slot.
      setImmediate(() => { if (this.#closed) return;
        void this.serialize(() => this.operations.runExclusive(operation.serverId, async () => {
          const record = await this.load(operation.serverId);
          if (!(await this.backups.list(operation.serverId)).some((backup) => backup.id === operation.result!.resourceId && !backup.pinned && ["manual", "auto"].includes(backup.kind))) return;
          await this.apply(record);
        })).catch(() => { /* Preserve data; explicit GET/run expose policy and runtime errors. */ });
      });
    });
  }
  async close(): Promise<void> { this.#closed = true; this.#unsubscribe?.(); await this.#tail; }
  private async runtime(record: Stored) {
    if (this.#closed || record.rootIdentity !== await backupDirectoryIdentity(this.adapter(record.serverId).plan.rootPath)) throw unsafe();
    const state = await this.adapter(record.serverId).getStatus();
    if (state.state !== "stopped" || state.ownership !== "none" || state.recoveryRequired || this.operations.getServerState(record.serverId).recoveryRequired) {
      throw new DomainError(409, "RETENTION_RUNTIME_UNSAFE", "保留清理仅在实例已确认停止且无恢复锁时执行");
    }
  }
  private async receipts(serverId: string) {
    const root = await this.directory(), server = path.join(root, serverId);
    await mkdir(server, { recursive: true, mode: 0o700 }); await plainRestoreDirectory(server); await syncRestoreDirectory(root);
    return server;
  }
  private async unresolvedReceipts(record: Stored): Promise<BackupRetentionResult["retained"]> {
    const root = await this.receipts(record.serverId), names = await readdir(root);
    if (names.length > 10_000) throw unsafe();
    const retained: BackupRetentionResult["retained"] = [];
    for (const name of names) {
      const id = /^[a-f0-9-]{36}\.json$/u.test(name) ? name.slice(0, -5) : `unknown-${hash(name).slice(0, 24)}`;
      let resolved = false;
      try {
        const file = path.join(root, name), stat = await lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw unsafe();
        const value = JSON.parse(await readBoundedRegularFile(file, 4096, "备份清理记录"));
        if (!value || value.schemaVersion !== 1 || value.id !== id || value.serverId !== record.serverId || value.rootIdentity !== record.rootIdentity ||
          !/^[a-f0-9]{64}$/u.test(value.directoryIdentity) || !/^[a-f0-9]{64}$/u.test(value.checksumSha256) ||
          !Number.isFinite(Date.parse(value.createdAt)) || !["deleting", "deleted"].includes(value.state) ||
          Object.keys(value).some((key) => !["schemaVersion", "id", "serverId", "rootIdentity", "directoryIdentity", "checksumSha256", "state", "createdAt", "completedAt"].includes(key))) throw unsafe();
        if (value.state === "deleted" && Number.isFinite(Date.parse(value.completedAt))) {
          try { await lstat(path.join(this.managerRoot, "backups", record.serverId, id)); }
          catch (error) { if (missingFile(error)) resolved = true; else throw error; }
        }
      } catch { /* Unknown receipts are inspection evidence; never traverse or repair their paths. */ }
      if (!resolved) retained.push({ id, reason: "cleanup-receipt-inspection-required" });
      if (retained.length > 1000) throw unsafe();
    }
    return retained;
  }
  private async protection(serverId: string, backup: BackupInfo, directory: string, ownsReceipt = false): Promise<string | null> {
    if (backup.pinned || backup.kind === "snapshot" || backup.scope !== "world-set") return "pinned-or-private-snapshot";
    const scan = await this.journal.scan();
    if (scan.issues.length || scan.recoveryServerIds.size) return "journal-inspection-required";
    const own = scan.records.filter((r) => r.intent.serverId === serverId && r.intent.kind === "backup" && r.intent.resourceId === backup.id);
    if (own.length !== 1 || own[0]!.state !== "committed" || this.operations.get(own[0]!.intent.operationId)?.state !== "succeeded") return "unverified-backup-outcome";
    const overlaps = (relative: string) => {
      const target = path.resolve(this.managerRoot, relative);
      const within = (candidate: string, parent: string) => { const rel = path.relative(parent, candidate); return rel === "" || (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel)); };
      return within(target, directory) || within(directory, target);
    };
    for (const record of scan.records) {
      if (record === own[0]) continue;
      const intent = record.intent;
      if (intent.resourceId === backup.id || intent.restore?.backupId === backup.id || intent.restore?.guardBackupId === backup.id ||
        intent.worldChange?.guardBackupId === backup.id || intent.worldImport?.guardBackupId === backup.id || intent.worldArchive?.guardBackupId === backup.id ||
        intent.paths.some((p) => p.namespace !== "server" && overlaps(p.relativePath)) ||
        record.checkpoints.some((p) => p.details?.resourceId === backup.id || (p.details?.relativePath && overlaps(p.details.relativePath)))) return "transaction-referenced";
    }
    if (ownsReceipt) return null;
    try { await lstat(path.join(await this.receipts(serverId), `${backup.id}.json`)); return "cleanup-receipt-retained"; }
    catch (error) { if (!missingFile(error)) throw error; }
    return null;
  }
  private async owned(record: Stored, backup: BackupInfo, directory: string) {
    for (const component of [this.managerRoot, path.join(this.managerRoot, "backups"), path.dirname(directory), directory]) await plainRestoreDirectory(component);
    const identity = await backupDirectoryIdentity(directory);
    const ownerFile = path.join(directory, "owner.json"), metadata = await lstat(ownerFile);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) throw unsafe();
    const owner = JSON.parse(await readBoundedRegularFile(ownerFile, 4096, "备份所有权"));
    if (!owner || owner.schemaVersion !== 1 || owner.id !== backup.id || owner.serverId !== record.serverId || owner.rootIdentity !== record.rootIdentity ||
      owner.directoryIdentity !== identity || owner.createdAt !== backup.createdAt ||
      Object.keys(owner).some((key) => !["schemaVersion", "id", "serverId", "rootIdentity", "directoryIdentity", "createdAt"].includes(key))) throw unsafe();
    const { manifest } = await this.backups.exportSource(record.serverId, backup.id);
    if (manifest.pinned || manifest.kind === "snapshot" || manifest.checksumSha256 !== backup.checksumSha256 || manifest.createdAt !== backup.createdAt || manifest.includedRoots.length !== 1) throw unsafe();
    const world = manifest.includedRoots[0]!;
    if (!safeRestorePath(world) || world.includes("/")) throw unsafe();
    const entries = (await readdir(directory)).sort(); if (entries.join("|") !== "manifest.json|owner.json|payload") throw unsafe();
    const payload = path.join(directory, "payload"); await plainRestoreDirectory(payload);
    if ((await readdir(payload)).join("|") !== world || !manifest.files.every((file) => file.path.startsWith(world + "/"))) throw unsafe();
    await verifyRestoreTree(path.join(payload, world), manifest.files.map((file) => ({ ...file, path: file.path.slice(world.length + 1) })));
    return identity;
  }
  private async inventory(directory: string): Promise<Entry[]> {
    const entries: Entry[] = [];
    const visit = async (current: string, prefix: string) => {
      await plainRestoreDirectory(current);
      for (const name of await readdir(current)) {
        const relative = prefix + name; if (!safeRestorePath(relative) || entries.length >= 200_000) throw unsafe();
        const file = path.join(directory, ...relative.split("/")), stat = await lstat(file);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))) throw unsafe();
        entries.push({ relative, identity: stat.isDirectory() ? await backupDirectoryIdentity(file) : fileIdentity(stat), directory: stat.isDirectory() });
        if (stat.isDirectory()) await visit(file, relative + "/");
      }
    };
    await visit(directory, ""); return entries;
  }
  private async remove(record: Stored, backup: BackupInfo, directory: string) {
    await this.runtime(record);
    const identity = await this.owned(record, backup, directory), entries = await this.inventory(directory);
    await this.inject?.("before-intent");
    await this.runtime(record);
    if (identity !== await this.owned(record, backup, directory) || await this.protection(record.serverId, backup, directory)) throw unsafe();
    const receiptFile = path.join(await this.receipts(record.serverId), `${backup.id}.json`);
    const receipt = { schemaVersion: 1, serverId: record.serverId, id: backup.id, rootIdentity: record.rootIdentity, directoryIdentity: identity,
      checksumSha256: backup.checksumSha256, state: "deleting", createdAt: this.clock.now().toISOString() };
    await writeRestoreJson(receiptFile, receipt);
    await this.inject?.("after-intent");
    if (identity !== await this.owned(record, backup, directory) || await this.protection(record.serverId, backup, directory, true)) throw unsafe();
    // No recursive removal; each known entry and its ancestor identities are checked again.
    const files = entries.filter((entry) => !entry.directory).sort((a, b) => Number(["owner.json", "manifest.json"].includes(a.relative)) - Number(["owner.json", "manifest.json"].includes(b.relative)));
    for (const entry of [...files, ...entries.filter((entry) => entry.directory).sort((a, b) => b.relative.split("/").length - a.relative.split("/").length)]) {
      await this.runtime(record);
      if (await backupDirectoryIdentity(directory) !== identity) throw unsafe();
      const file = path.join(directory, ...entry.relative.split("/"));
      let parent = path.dirname(file);
      while (parent !== directory) {
        const ancestor = entries.find((e) => e.directory && e.relative === path.relative(directory, parent).split(path.sep).join("/"));
        if (!ancestor || ancestor.identity !== await backupDirectoryIdentity(parent)) throw unsafe(); parent = path.dirname(parent);
      }
      const stat = await lstat(file);
      if (stat.isSymbolicLink() || (entry.directory ? !stat.isDirectory() || await backupDirectoryIdentity(file) !== entry.identity : !stat.isFile() || stat.nlink !== 1 || fileIdentity(stat) !== entry.identity)) throw unsafe();
      if (entry.directory) await rmdir(file); else await unlink(file);
      await this.inject?.("after-entry");
    }
    if (identity !== await backupDirectoryIdentity(directory)) throw unsafe();
    await rmdir(directory); await syncRestoreDirectory(path.dirname(directory));
    await writeRestoreJson(receiptFile, { ...receipt, state: "deleted", completedAt: this.clock.now().toISOString() });
  }
  private async apply(record: Stored) {
    if (!record.settings.enabled) return;
    try { await this.runtime(record); }
    catch (error) {
      record.lastRun = { completedAt: this.clock.now().toISOString(), state: "blocked", code: error instanceof DomainError ? error.code : "RETENTION_STATE_UNSAFE", removed: [], retained: [] };
      await this.save(record); return;
    }
    const items = await this.backups.list(record.serverId); if (items.length > 1000) throw unsafe();
    const eligible = items.filter((backup) => !backup.pinned && ["manual", "auto"].includes(backup.kind) && backup.scope === "world-set");
    const keptCount = new Set(eligible.slice(0, record.settings.retainCount).map((backup) => backup.id));
    const unresolved = await this.unresolvedReceipts(record);
    const result: BackupRetentionResult = { completedAt: this.clock.now().toISOString(), state: unresolved.length ? "partial" : "completed",
      code: unresolved.length ? "RETENTION_INSPECTION_REQUIRED" : null, removed: [], retained: unresolved };
    for (const backup of items) {
      const created = Date.parse(backup.createdAt), directory = path.join(this.managerRoot, "backups", record.serverId, backup.id);
      let reason: string | null = keptCount.has(backup.id) || !Number.isFinite(created) || created > this.clock.now().getTime() || created >= this.clock.now().getTime() - record.settings.retainDays * day ? "count-or-age-protected" : null;
      try {
        reason ??= await this.protection(record.serverId, backup, directory);
        if (!reason) { await this.remove(record, backup, directory); result.removed.push(backup.id); }
      } catch { reason = "inspection-or-partial-cleanup-required"; result.state = "partial"; result.code = "RETENTION_INSPECTION_REQUIRED"; }
      if (reason && !result.retained.some((entry) => entry.id === backup.id)) result.retained.push({ id: backup.id, reason });
      if (result.retained.length > 1000) throw unsafe();
    }
    result.completedAt = this.clock.now().toISOString(); record.lastRun = result; await this.save(record);
  }
}
