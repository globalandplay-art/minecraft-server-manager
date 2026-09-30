import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, open, opendir, realpath, rename, statfs } from "node:fs/promises";
import path from "node:path";

import { backupInfoSchema, type BackupCreateRequest, type BackupInfo, type BackupScope, type Operation } from "@mcsm/contracts";
import { Value } from "@sinclair/typebox/value";
import { isLocalAdapter, type LocalMinecraftServerAdapter } from "../adapters/contract.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Clock } from "../clock.js";
import type { RuntimeOperationContext } from "../infra/runtime-contract.js";
import { parseProperties, readBoundedRegularFile, SERVER_PROPERTIES_LIMIT } from "../config/properties.js";
import { DomainError } from "./domain-errors.js";
import type { OperationService } from "./operation-service.js";
import { ServerNotFoundError } from "./server-service.js";
import type { TransactionJournalStore } from "./transaction-journal.js";
import { inspectVanillaWorld } from "./world-inventory-service.js";

const MAX_FILES = 100_000;
const MAX_BYTES = 250 * 1024 ** 3;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
type FileEntry = { path: string; sizeBytes: number; sha256: string };
type Manifest = BackupInfo & { schemaVersion: 1; files: FileEntry[] };

function safeSegment(value: string): boolean {
  return value.length > 0 && value.length <= 255 && value !== "." && value !== ".." &&
    !/[\\/:\u0000-\u001f\u007f]/u.test(value) && !/[. ]$/u.test(value) && !RESERVED.test(value);
}
function missing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function unsafe(reason: string): DomainError {
  return new DomainError(409, "BACKUP_LAYOUT_UNSAFE", "备份文件布局不安全，已停止操作", reason);
}

async function plainDirectory(directory: string): Promise<void> {
  const info = await lstat(directory);
  const canonical = await realpath(directory);
  const expected = path.resolve(directory);
  const normalized = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  if (!info.isDirectory() || info.isSymbolicLink() || normalized(canonical) !== normalized(expected)) {
    throw unsafe("linked-directory");
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try { await handle.sync(); }
  catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (!(process.platform === "win32" && ["EACCES", "EISDIR", "EPERM"].includes(String(code)))) throw error;
  } finally { await handle.close(); }
}

async function syncDirectoryChain(directory: string, stopAt: string): Promise<void> {
  const normalize = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  let current = path.resolve(directory);
  const boundary = normalize(stopAt);
  while (true) {
    await syncDirectory(current);
    if (normalize(current) === boundary) return;
    const parent = path.dirname(current);
    if (parent === current) throw unsafe("directory-sync-boundary");
    current = parent;
  }
}

async function estimateRoots(serverRoot: string, roots: string[]): Promise<number> {
  let count = 0;
  let total = 0;
  const visit = async (source: string, relative: string): Promise<void> => {
    if (relative.length > 4096 || relative.split("/").length > 64 || !relative.split("/").every(safeSegment)) throw unsafe("unsafe-relative-path");
    const info = await lstat(source);
    if (info.isSymbolicLink()) throw unsafe("linked-entry");
    if (info.isDirectory()) {
      await plainDirectory(source);
      const dir = await opendir(source);
      for await (const child of dir) {
        if (!safeSegment(child.name)) throw unsafe("unsafe-filename");
        await visit(path.join(source, child.name), `${relative}/${child.name}`);
      }
      return;
    }
    if (!info.isFile()) throw unsafe("special-file");
    count += 1;
    total += info.size;
    if (count > MAX_FILES || !Number.isSafeInteger(total) || total > MAX_BYTES) {
      throw new DomainError(413, "BACKUP_TOO_LARGE", "备份超过本地大小或文件数量限制", "backup-limit");
    }
  };
  for (const root of roots) await visit(path.join(serverRoot, root), root);
  if (count === 0) throw new DomainError(409, "BACKUP_EMPTY", "没有可备份的文件", "backup-empty");
  return total;
}

async function requireCapacity(directory: string, total: number, availableBytes: (directory: string) => Promise<number>): Promise<void> {
  const freeBytes = await availableBytes(directory);
  const reserveBytes = Math.max(128 * 1024 ** 2, Math.ceil(total * 0.05));
  if (!Number.isSafeInteger(freeBytes) || total + reserveBytes > freeBytes) {
    throw new DomainError(507, "BACKUP_STORAGE_LOW", "可用磁盘空间不足，未开始复制", "insufficient-backup-space");
  }
}

export class BackupService {
  constructor(
    private readonly registry: AdapterRegistry,
    private readonly operations: OperationService,
    private readonly journal: TransactionJournalStore,
    private readonly managerRoot: string,
    private readonly clock: Clock,
    private readonly availableBytes: (directory: string) => Promise<number> = async (directory) => {
      const volume = await statfs(directory);
      return Number(volume.bavail) * Number(volume.bsize);
    }
  ) {}

  async list(serverId: string): Promise<BackupInfo[]> {
    this.#adapter(serverId);
    const root = path.join(this.managerRoot, "backups", serverId);
    try { await plainDirectory(root); }
    catch (error) { if (missing(error)) return []; throw error; }
    const items: BackupInfo[] = [];
    for await (const entry of await opendir(root)) {
      if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/iu.test(entry.name)) continue;
      try { await plainDirectory(path.join(root, entry.name)); } catch { continue; }
      const file = path.join(root, entry.name, "manifest.json");
      try {
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_MANIFEST_BYTES) continue;
        const handle = await open(file, "r");
        let value: unknown;
        try { value = JSON.parse(await handle.readFile("utf8")); } finally { await handle.close(); }
        if (this.#valid(value, serverId, entry.name)) {
          const publicManifest = { ...value } as Partial<Manifest>;
          delete publicManifest.schemaVersion;
          delete publicManifest.files;
          items.push(publicManifest as BackupInfo);
        }
      } catch { /* Incomplete or invalid backups are not listed. */ }
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(serverId: string, body: BackupCreateRequest, idempotencyKey: string): Promise<Operation> {
    const adapter = this.#adapter(serverId);
    return this.operations.requestBackup(serverId, idempotencyKey, JSON.stringify(body),
      (context) => this.#create(context, adapter, body),
      async () => {
        if (adapter.plan.serverInfo.type !== "vanilla") {
          throw new DomainError(501, "CAPABILITY_UNSUPPORTED", "当前服务端类型暂不支持备份", "unsupported-server-type");
        }
        if (!(await adapter.getCapabilities()).backup) {
          throw new DomainError(501, "CAPABILITY_UNSUPPORTED", "此实例未声明备份能力", "backup-capability-unavailable");
        }
        const state = await adapter.getStatus();
        if (state.state === "unknown" || state.ownership === "external" || state.recoveryRequired) {
          throw new DomainError(409, "ACTION_UNAVAILABLE", "当前实例状态不能安全备份", "server-state-unsafe");
        }
        if (state.state === "running" && (!body.allowStop || state.ownership !== "managed")) {
          throw new DomainError(409, "SERVER_MUST_BE_STOPPED", "运行中的实例需要明确允许管理器停服", "allow-stop-required");
        }
      });
  }

  #adapter(serverId: string): LocalMinecraftServerAdapter {
    const adapter = this.registry.get(serverId);
    if (!adapter) throw new ServerNotFoundError();
    if (!isLocalAdapter(adapter)) throw new DomainError(501, "FEATURE_NOT_IMPLEMENTED", "Mock 模式不提供备份", "mock-mode");
    return adapter;
  }

  async #create(context: RuntimeOperationContext, adapter: LocalMinecraftServerAdapter, request: BackupCreateRequest): Promise<void> {
    const beganAt = Date.now();
    const serverRoot = adapter.plan.rootPath;
    await plainDirectory(serverRoot);
    await mkdir(this.managerRoot, { recursive: true, mode: 0o700 });
    const managerCanonical = await realpath(this.managerRoot);
    const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
    if (normalize(managerCanonical) !== normalize(path.resolve(this.managerRoot))) throw unsafe("manager-root-linked");
    const backupsRoot = path.join(this.managerRoot, "backups");
    await mkdir(backupsRoot, { recursive: true, mode: 0o700 });
    await plainDirectory(backupsRoot);
    const serverBackupRoot = path.join(this.managerRoot, "backups", adapter.serverId);
    await mkdir(serverBackupRoot, { recursive: true, mode: 0o700 });
    await plainDirectory(serverBackupRoot);
    await syncDirectoryChain(serverBackupRoot, this.managerRoot);
    await syncDirectory(path.dirname(this.managerRoot));

    const backupId = randomUUID();
    const stagingName = backupId + ".staging";
    const staging = path.join(serverBackupRoot, stagingName);
    const completed = path.join(serverBackupRoot, backupId);
    const original = await adapter.getStatus();
    const wasRunning = original.state === "running";
    const roots = await this.#roots(adapter, request.scope);
    await requireCapacity(serverBackupRoot, await estimateRoots(serverRoot, roots), this.availableBytes);
    const journal = await this.journal.createIntent({
      operationId: context.operationId,
      serverId: adapter.serverId,
      kind: "backup",
      scope: request.scope,
      resourceId: backupId,
      allowStop: request.allowStop,
      originalState: wasRunning ? "running" : "stopped",
      paths: [
        { role: "source", relativePath: roots[0]! },
        { role: "staging", relativePath: path.posix.join("backups", adapter.serverId, stagingName) },
        { role: "target", relativePath: path.posix.join("backups", adapter.serverId, backupId) }
      ],
      createdAt: this.clock.now().toISOString()
    });
    await mkdir(staging, { mode: 0o700 });
    await syncDirectory(serverBackupRoot);
    let stopConfirmed = !wasRunning;
    let restartAttempted = false;
    try {
      await requireCapacity(serverBackupRoot, await estimateRoots(serverRoot, roots), this.availableBytes);
      if (wasRunning) {
        await context.onStep("stopping");
        await adapter.stop(context);
        const afterStop = await adapter.getStatus();
        if (afterStop.state !== "stopped" || afterStop.ownership === "external") {
          throw new DomainError(409, "RECOVERY_REQUIRED", "无法确认服务端已停止", "stop-not-confirmed", true);
        }
        stopConfirmed = true;
      }
      if (!stopConfirmed) throw new Error("Server stop was not confirmed");
      await context.onStep("copying-snapshot");
      const files: FileEntry[] = [];
      let total = 0;
      const sources: Array<{ source: string; relative: string; sizeBytes: number; mtimeMs: number }> = [];
      const collectOne = async (source: string, relative: string) => {
        if (relative.length > 4096 || relative.split("/").length > 64 || !relative.split("/").every(safeSegment)) throw unsafe("unsafe-relative-path");
        const sourceInfo = await lstat(source);
        if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) throw unsafe("unsafe-file");
        total += sourceInfo.size;
        if (!Number.isSafeInteger(total) || total > MAX_BYTES || sources.length >= MAX_FILES) {
          throw new DomainError(413, "BACKUP_TOO_LARGE", "备份超过本地大小或文件数量限制", "backup-limit");
        }
        sources.push({ source, relative, sizeBytes: sourceInfo.size, mtimeMs: sourceInfo.mtimeMs });
      };
      const walk = async (directoryPath: string, relativeRoot: string) => {
        await plainDirectory(directoryPath);
        const directory = await opendir(directoryPath);
        for await (const entry of directory) {
          if (!safeSegment(entry.name)) throw unsafe("unsafe-filename");
          const source = path.join(directoryPath, entry.name);
          const relative = relativeRoot + "/" + entry.name;
          const info = await lstat(source);
          if (info.isSymbolicLink()) throw unsafe("linked-entry");
          if (info.isDirectory()) await walk(source, relative);
          else if (info.isFile()) await collectOne(source, relative);
          else throw unsafe("special-file");
        }
      };
      for (const relative of roots) {
        const source = path.join(serverRoot, relative);
        const info = await lstat(source);
        if (info.isSymbolicLink()) throw unsafe("linked-root");
        if (info.isDirectory()) await walk(source, relative);
        else if (info.isFile()) await collectOne(source, relative);
        else throw unsafe("invalid-root");
      }
      const volume = await statfs(serverBackupRoot);
      const freeBytes = Number(volume.bavail) * Number(volume.bsize);
      const reserveBytes = Math.max(128 * 1024 ** 2, Math.ceil(total * 0.05));
      if (!Number.isSafeInteger(freeBytes) || total + reserveBytes > freeBytes) {
        throw new DomainError(507, "BACKUP_STORAGE_LOW", "可用磁盘空间不足，未开始复制", "insufficient-backup-space");
      }
      const payload = path.join(staging, "payload");
      await mkdir(payload, { mode: 0o700 });
      await syncDirectory(staging);
      const touchedDirectories = new Set<string>([payload]);
      for (const item of sources) {
        const { source, relative } = item;
        const destination = path.join(payload, ...relative.split("/"));
        await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        let ancestor = path.dirname(destination);
        while (ancestor === staging || ancestor.startsWith(staging + path.sep)) {
          touchedDirectories.add(ancestor);
          if (ancestor === staging) break;
          ancestor = path.dirname(ancestor);
        }
        await copyFile(source, destination);
        const output = await open(destination, "r+");
        try { await output.sync(); } finally { await output.close(); }
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(destination)) hash.update(chunk as Buffer);
        const copied = await lstat(destination);
        const sourceAfterCopy = await lstat(source);
        if (copied.size !== item.sizeBytes || sourceAfterCopy.size !== item.sizeBytes ||
          sourceAfterCopy.mtimeMs !== item.mtimeMs) throw new Error("Source changed while copying");
        files.push({ path: relative, sizeBytes: copied.size, sha256: hash.digest("hex") });
      }
      for (const directory of [...touchedDirectories].sort((a, b) => b.length - a.length)) await syncDirectory(directory);
      if (files.length === 0) throw new DomainError(409, "BACKUP_EMPTY", "没有可备份的文件", "backup-empty");
      files.sort((a, b) => a.path.localeCompare(b.path));
      const checksumSha256 = createHash("sha256").update(files.map((file) =>
        file.path + "\0" + file.sizeBytes + "\0" + file.sha256).join("\n")).digest("hex");
      const info: BackupInfo = {
        id: backupId,
        serverId: adapter.serverId,
        scope: request.scope,
        kind: request.scope === "server-snapshot" ? "snapshot" : "manual",
        label: request.label ?? null,
        state: "complete",
        pinned: request.scope === "server-snapshot",
        createdAt: this.clock.now().toISOString(),
        minecraftVersion: (await inspectVanillaWorld(adapter.serverId, serverRoot, this.clock.now().toISOString()))
          .find((world) => world.active)?.minecraftVersion.value ?? null,
        serverType: adapter.plan.serverInfo.type,
        includedRoots: roots,
        fileCount: files.length,
        sizeBytes: total,
        checksumSha256,
        wasRunning,
        restarted: false,
        downtimeMs: null
      };
      const manifest: Manifest = { schemaVersion: 1, ...info, files };
      await this.#writeManifest(path.join(staging, "manifest.json"), manifest);
      await this.journal.appendCheckpoint(adapter.serverId, journal.transactionId, {
        name: "payload-verified", recordedAt: this.clock.now().toISOString(), details: { checksumSha256 }
      });
      await rename(staging, completed);
      await syncDirectory(serverBackupRoot);
      await context.onStep("backup-complete");
      let restarted = false;
      if (wasRunning) {
        await context.onStep("restarting");
        await adapter.revalidateBeforeStart();
        restartAttempted = true;
        await adapter.start(context);
        const afterStart = await adapter.getStatus();
        if (afterStart.state !== "running" || afterStart.ownership !== "managed") {
          throw new DomainError(409, "RECOVERY_REQUIRED", "备份已完成，但服务端重启未确认", "restart-not-confirmed", true);
        }
        restarted = true;
      }
      const finalInfo = { ...info, restarted, downtimeMs: wasRunning ? Math.max(0, Date.now() - beganAt) : null };
      await this.#writeManifest(path.join(completed, "manifest.json"), { schemaVersion: 1, ...finalInfo, files });
      await syncDirectory(completed);
      await syncDirectory(serverBackupRoot);
      await this.journal.appendCheckpoint(adapter.serverId, journal.transactionId, {
        name: "server-restored", recordedAt: this.clock.now().toISOString()
      });
      await this.journal.setState(adapter.serverId, journal.transactionId, "committed", this.clock.now().toISOString());
    } catch {
      if (wasRunning && stopConfirmed && !restartAttempted) {
        try {
          await adapter.revalidateBeforeStart();
          restartAttempted = true;
          await adapter.start(context);
          const afterStart = await adapter.getStatus();
          if (afterStart.state !== "running" || afterStart.ownership !== "managed") throw new Error("restart-not-confirmed");
        } catch { /* Preserve the original failure and keep the instance gated for manual inspection. */ }
      }
      try { await this.journal.setState(adapter.serverId, journal.transactionId, "recovery-required", this.clock.now().toISOString()); }
      catch { /* The operation layer raises its own recovery gate if journal persistence failed. */ }
      throw new DomainError(409, "RECOVERY_REQUIRED", "备份没有完整结束，实例需要人工检查", "backup-transaction-incomplete", true);
    }
  }

  async #roots(adapter: LocalMinecraftServerAdapter, scope: BackupScope): Promise<string[]> {
    const properties = parseProperties(await readBoundedRegularFile(
      path.join(adapter.plan.rootPath, "server.properties"), SERVER_PROPERTIES_LIMIT, "server.properties"
    ));
    const world = properties.get("level-name") ?? "world";
    if (!safeSegment(world)) throw unsafe("invalid-level-name");
    if (scope === "world-set") return [world];
    const jarRelative = path.relative(adapter.plan.rootPath, adapter.plan.jarPath).split(path.sep).join("/");
    if (!jarRelative.split("/").every(safeSegment)) throw unsafe("jar-outside-server-root");
    const roots = [world, jarRelative, "server.properties", "eula.txt"];
    for (const candidate of ["mods", "plugins", "config"]) {
      try { await lstat(path.join(adapter.plan.rootPath, candidate)); roots.push(candidate); }
      catch (error) { if (!missing(error)) throw error; }
    }
    return [...new Set(roots)];
  }

  async #writeManifest(file: string, manifest: Manifest): Promise<void> {
    const contents = JSON.stringify(manifest) + "\n";
    if (Buffer.byteLength(contents, "utf8") > MAX_MANIFEST_BYTES) {
      throw new DomainError(413, "BACKUP_TOO_LARGE", "备份清单超过大小限制", "manifest-limit");
    }
    const temporary = file + "." + randomUUID() + ".tmp";
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(contents, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, file);
    await syncDirectory(path.dirname(file));
  }

  #valid(value: unknown, serverId: string, backupId: string): value is Manifest {
    if (typeof value !== "object" || value === null) return false;
    const manifest = value as Partial<Manifest>;
    if (manifest.schemaVersion !== 1 || manifest.id !== backupId || manifest.serverId !== serverId ||
      manifest.state !== "complete" || !Array.isArray(manifest.files) || manifest.files.length !== manifest.fileCount ||
      !manifest.files.every((file) => file && typeof file.path === "string" && file.path.split("/").every(safeSegment) &&
        Number.isSafeInteger(file.sizeBytes) && file.sizeBytes >= 0 && /^[0-9a-f]{64}$/u.test(file.sha256))) return false;
    const files = manifest.files;
    const publicManifest = { ...manifest } as Partial<Manifest>;
    delete publicManifest.schemaVersion;
    delete publicManifest.files;
    if (!Value.Check(backupInfoSchema, publicManifest)) return false;
    const paths = new Set(files.map((file) => file.path));
    if (paths.size !== files.length || files.reduce((sum, file) => sum + file.sizeBytes, 0) !== manifest.sizeBytes) return false;
    const checksum = createHash("sha256").update(files.map((file) =>
      file.path + "\0" + file.sizeBytes + "\0" + file.sha256).join("\n")).digest("hex");
    return checksum === manifest.checksumSha256;
  }
}
