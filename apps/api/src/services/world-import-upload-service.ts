import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, realpath, rename, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type { WorldImportUploadResponse, WorldImportUploadsResponse, WorldImportDiscardRequest } from "@mcsm/contracts";
import { readBoundedRegularFile } from "../config/properties.js";
import { isLocalAdapter } from "../adapters/contract.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import { DomainError } from "./domain-errors.js";
import type { OperationService } from "./operation-service.js";
import { ServerNotFoundError } from "./server-service.js";
import { plainRestoreDirectory, restoreCapacity, restoreFilesChecksum, syncRestoreDirectory, writeRestoreJson, missingFile, inventoryRestoreTree } from "./restore-files.js";
import { stageWorldImportArchive, WORLD_IMPORT_ARCHIVE_LIMITS, allowedWorldImportFile } from "./world-import-archive.js";
import { readWorldVersion } from "./world-inventory-service.js";
import type { TransactionJournalStore } from "./transaction-journal.js";

// Reserve the full worst-case upload/extraction budget for each retained directory,
// including interrupted and rejected uploads. Never silently evict possible evidence.
export const WORLD_IMPORT_UPLOAD_SLOTS = 3;
const reservation = WORLD_IMPORT_ARCHIVE_LIMITS.zipBytes + WORLD_IMPORT_ARCHIVE_LIMITS.expandedBytes;
const unsafe = () => new DomainError(409, "IMPORT_STAGING_UNSAFE", "导入暂存区需要人工检查", "unsafe-import-staging");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
async function directoryIdentity(directory: string): Promise<string> {
  await plainRestoreDirectory(directory);
  const canonical = await realpath(directory), info = await lstat(directory, { bigint: true });
  return hash(`${process.platform === "win32" ? canonical.toLowerCase() : canonical}\0${info.dev}\0${info.ino}\0${info.birthtimeNs}`);
}

/** Upload-only boundary. Does not switch worlds, stop Java or authorize import. */
export class WorldImportUploadService {
  #busy = false;
  constructor(private readonly registry: AdapterRegistry, private readonly operations: OperationService,
    private readonly managerRoot: string, private readonly inject?: (point: string) => Promise<void>, private readonly journal?: Pick<TransactionJournalStore,"scan">) {}

  /** Shared upload/discard/import lease; callers separately reserve the instance. */
  async withLease<T>(action: () => Promise<T>): Promise<T> {
    if (this.#busy) throw new DomainError(409, "OPERATION_CONFLICT", "暂存区正在使用，请稍后重试", "import-upload-active");
    this.#busy = true;
    try { return await action(); } finally { this.#busy = false; }
  }

  private async consumed(directory: string): Promise<boolean> {
    try { await lstat(path.join(directory, "consumed.json")); return true; }
    catch (error) { if (missingFile(error)) return false; throw error; }
  }
  private async journalOwner(serverId: string,id: string): Promise<string | undefined> {
    const scan = await this.journal?.scan();
    if (scan?.issues.some((issue) => issue.serverId === serverId)) throw unsafe();
    const references = scan?.records.filter((record) => record.intent.serverId === serverId && record.intent.worldImport?.uploadId === id) ?? [];
    if (references.length > 1) throw unsafe();
    return references[0]?.intent.operationId;
  }

  /** Must be called while holding withLease. Rechecks physical content, version and both identities. */
  async validatedSource(serverId: string, id: string, expectedRevision?: string, operationId?: string) {
    const adapter = this.registry.getLocal(serverId), root = await this.root();
    if (!adapter) throw new ServerNotFoundError();
    if (!root) throw new DomainError(404, "RESOURCE_NOT_FOUND", "暂存记录不存在", "upload-not-found");
    let record;
    try { record = await this.artifact(root,id); } catch (error) {
      if (missingFile(error)) throw new DomainError(404,"RESOURCE_NOT_FOUND","暂存记录不存在","upload-not-found");
      throw error;
    }
    if (record.owner.serverId !== serverId) throw new DomainError(404,"RESOURCE_NOT_FOUND","暂存记录不存在","upload-not-found");
    if (record.owner.rootIdentity !== await directoryIdentity(adapter.plan.rootPath) || record.owner.directoryIdentity !== record.identity) throw unsafe();
    const referencedOperation = await this.journalOwner(serverId,id);
    if (referencedOperation && referencedOperation !== operationId) throw unsafe();
    if (await this.consumed(record.directory)) {
      const consumed = JSON.parse(await this.ownerText(path.join(record.directory,"consumed.json")));
      if (!operationId || consumed.operationId !== operationId || consumed.serverId !== serverId || consumed.uploadId !== id) throw unsafe();
    }
    const marker = path.join(record.directory,"validated.json");
    if ((await lstat(marker)).nlink !== 1) throw unsafe();
    const validated = JSON.parse(await readBoundedRegularFile(marker,4 * 1024 ** 2,"上传校验记录"));
    const files = await inventoryRestoreTree(path.join(record.directory,"world"));
    const checksumSha256 = restoreFilesChecksum(files), sizeBytes = files.reduce((sum,f) => sum + f.sizeBytes,0);
    const minecraftVersion = (await adapter.getServerInfo()).minecraftVersion;
    if (!minecraftVersion || validated.schemaVersion !== 1 || validated.id !== id || validated.serverId !== serverId ||
      validated.minecraftVersion !== minecraftVersion || validated.checksumSha256 !== checksumSha256 || validated.sizeBytes !== sizeBytes ||
      files.length > WORLD_IMPORT_ARCHIVE_LIMITS.entries || sizeBytes > WORLD_IMPORT_ARCHIVE_LIMITS.expandedBytes || files.some((f) => !allowedWorldImportFile(f.path) || f.sizeBytes > WORLD_IMPORT_ARCHIVE_LIMITS.fileBytes || f.path.split("/").length > WORLD_IMPORT_ARCHIVE_LIMITS.depth) ||
      await readWorldVersion(path.join(record.directory,"world")) !== minecraftVersion ||
      !Array.isArray(validated.files) || restoreFilesChecksum(validated.files) !== checksumSha256) throw unsafe();
    const revision = hash(`${record.revision}\0${checksumSha256}\0${minecraftVersion}`);
    if (expectedRevision && revision !== expectedRevision) throw unsafe();
    return { directory: record.directory, revision, files, checksumSha256, sizeBytes, minecraftVersion };
  }

  async claim(serverId: string, id: string, revision: string, operationId: string): Promise<void> {
    const source = await this.validatedSource(serverId,id,revision,operationId);
    await writeRestoreJson(path.join(source.directory,"consumed.json"), { schemaVersion:1,serverId,uploadId:id,operationId });
  }

  private receiptPath(id: string): string {
    if (!uuid.test(id)) throw unsafe();
    return path.join(this.managerRoot, "world-import-discard-owners", id + ".json");
  }

  private async ownerText(file: string): Promise<string> {
    await plainRestoreDirectory(path.dirname(file));
    if ((await lstat(file)).nlink !== 1) throw unsafe();
    return readBoundedRegularFile(file, 16 * 1024, "上传归属");
  }

  private async preserveDiscardOwner(id: string, ownerText: string): Promise<void> {
    const file = this.receiptPath(id), root = path.dirname(file);
    await plainRestoreDirectory(this.managerRoot);
    await mkdir(root, { recursive: true, mode: 0o700 }); await plainRestoreDirectory(root);
    try {
      if (await this.ownerText(file) !== ownerText) throw unsafe();
      // Windows FlushFileBuffers needs a write-capable handle. r+ preserves bytes.
      const handle = await open(file, "r+");
      try { await this.inject?.("discard-owner-before-sync"); await handle.sync(); } finally { await handle.close(); }
      await syncRestoreDirectory(root);
    } catch (error) {
      if (!missingFile(error)) throw error;
      const temporary = file + "." + randomUUID() + ".tmp";
      const handle = await open(temporary, "wx", 0o600);
      try {
        await this.inject?.("discard-owner-before-write");
        await handle.writeFile(ownerText, "utf8");
        await this.inject?.("discard-owner-before-sync");
        await handle.sync();
      } finally { await handle.close(); }
      await rename(temporary, file);
      await syncRestoreDirectory(root);
    }
  }

  private async root(): Promise<string | null> {
    await plainRestoreDirectory(this.managerRoot);
    const root = path.join(this.managerRoot, "world-imports");
    try { await plainRestoreDirectory(root); } catch (error) { if (missingFile(error)) return null; throw error; }
    return root;
  }

  private async artifact(root: string, id: string) {
    if (!uuid.test(id)) throw unsafe();
    const directory = path.join(root, id);
    await plainRestoreDirectory(directory);
    const ownerFile = path.join(directory, "owner.json");
    let ownerText: string;
    try { ownerText = await this.ownerText(ownerFile); }
    catch (error) {
      if (!missingFile(error)) throw error;
      // A completed tree cleanup can lose its in-tree owner before final rmdir.
      // Only a durable, identity-bound discard receipt can authorize a retry.
      try { ownerText = await this.ownerText(this.receiptPath(id)); } catch { throw unsafe(); }
    }
    let owner: { id: string; serverId: string; serverRoot: string; rootIdentity?: string; directoryIdentity?: string };
    try { owner = JSON.parse(ownerText); } catch { throw unsafe(); }
    if (!owner || owner.id !== id || typeof owner.serverId !== "string" || typeof owner.serverRoot !== "string") throw unsafe();
    const identity = await directoryIdentity(directory);
    return { directory, owner, ownerText, revision: hash(`${ownerText}\0${identity}`), identity };
  }

  async list(serverId: string): Promise<WorldImportUploadsResponse["data"]> {
    if (this.#busy) throw new DomainError(409, "OPERATION_CONFLICT", "暂存区正在写入，请稍后刷新", "import-upload-active");
    const adapter = this.registry.getLocal(serverId);
    if (!adapter) throw new ServerNotFoundError();
    const root = await this.root();
    if (!root) return { items: [], occupiedSlots: 0, limit: 3 };
    const ids = await readdir(root);
    if (ids.length > WORLD_IMPORT_UPLOAD_SLOTS) throw unsafe();
    const items: WorldImportUploadsResponse["data"]["items"] = [];
    for (const id of ids.sort()) {
      const record = await this.artifact(root, id);
      if (record.owner.serverId !== serverId) continue;
      const verified = record.owner.rootIdentity === await directoryIdentity(adapter.plan.rootPath) && record.owner.directoryIdentity === record.identity;
      let validated = false;
      try {
        const info = await lstat(path.join(record.directory, "validated.json"));
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw unsafe();
        validated = true; // Completion marker only; not import authorization or a hash recheck.
      } catch (error) { if (!missingFile(error)) throw error; }
      const markerExists = await this.consumed(record.directory);
      let importOperationId = await this.journalOwner(serverId,id);
      const consumed = markerExists || Boolean(importOperationId);
      if (markerExists) {
        const marker = JSON.parse(await this.ownerText(path.join(record.directory,"consumed.json")));
        if (marker.serverId !== serverId || marker.uploadId !== id || !uuid.test(String(marker.operationId))) throw unsafe();
        if (importOperationId && importOperationId !== marker.operationId) throw unsafe();
        importOperationId = marker.operationId;
      }
      items.push({ id, state: !verified ? "identity-unverified" : consumed ? "consumed" : validated ? "validated" : "incomplete", discardAllowed: verified && !consumed, revision: record.revision, ...(importOperationId ? { importOperationId } : {}) });
    }
    return { items, occupiedSlots: ids.length, limit: 3 };
  }

  async discard(serverId: string, id: string, body: WorldImportDiscardRequest): Promise<void> {
    if (!uuid.test(id) || body.confirmUploadId !== id || !/^[0-9a-f]{64}$/u.test(body.revision)) {
      throw new DomainError(400, "VALIDATION_ERROR", "丢弃确认无效", "invalid-import-discard");
    }
    if (this.#busy) throw new DomainError(409, "OPERATION_CONFLICT", "正在接收或校验上传，暂不能丢弃", "import-upload-active");
    this.#busy = true;
    try {
      await this.operations.runExclusive(serverId, async () => {
        const adapter = this.registry.getLocal(serverId);
        if (!adapter) throw new ServerNotFoundError();
        const root = await this.root();
        if (!root) throw new DomainError(404, "RESOURCE_NOT_FOUND", "暂存记录不存在", "upload-not-found");
        let record;
        try { record = await this.artifact(root, id); } catch (error) {
          if (missingFile(error)) throw new DomainError(404, "RESOURCE_NOT_FOUND", "暂存记录不存在", "upload-not-found");
          throw error;
        }
        if (record.owner.serverId !== serverId) throw new DomainError(404, "RESOURCE_NOT_FOUND", "暂存记录不存在", "upload-not-found");
        if (record.owner.rootIdentity !== await directoryIdentity(adapter.plan.rootPath) || record.owner.directoryIdentity !== record.identity || record.revision !== body.revision) throw unsafe();
        if (await this.consumed(record.directory) || await this.journalOwner(serverId,id)) throw unsafe();
        // Enumerate and validate everything before the first unlink. Never recursively
        // delete or follow a junction. owner.json is last so partial cleanup remains owned.
        const files: string[] = [], directories: string[] = [];
        let entries = 0;
        const visit = async (directory: string, depth: number) => {
          if (depth > 34) throw unsafe();
          await plainRestoreDirectory(directory);
          for (const name of await readdir(directory)) {
            if (++entries > 50_000 || [".", ".."].includes(name) || /[\\/:\u0000]/u.test(name)) throw unsafe();
            const child = path.join(directory, name), info = await lstat(child);
            if (info.isSymbolicLink()) throw unsafe();
            if (info.isDirectory()) { await visit(child, depth + 1); directories.push(child); }
            else if (info.isFile() && info.nlink === 1) files.push(child);
            else throw unsafe();
          }
        };
        await visit(record.directory, 0);
        if ((await this.artifact(root, id)).revision !== body.revision) throw unsafe();
        if (record.owner.rootIdentity !== await directoryIdentity(adapter.plan.rootPath)) throw unsafe();
        await this.preserveDiscardOwner(id, record.ownerText);
        const ownerFile = path.join(record.directory, "owner.json");
        files.sort((a,b) => a === ownerFile ? 1 : b === ownerFile ? -1 : a.localeCompare(b));
        for (const file of files.filter((file) => file !== ownerFile)) {
          await plainRestoreDirectory(path.dirname(file));
          const info = await lstat(file);
          if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw unsafe();
          await unlink(file);
        }
        for (const directory of directories) { await plainRestoreDirectory(directory); await rmdir(directory); }
        await plainRestoreDirectory(root);
        if (await directoryIdentity(record.directory) !== record.identity) throw unsafe();
        try { await unlink(ownerFile); } catch (error) { if (!missingFile(error)) throw error; }
        await this.inject?.("before-final-rmdir");
        await rmdir(record.directory);
        await syncRestoreDirectory(root);
        // A leftover receipt has no slot and cannot authorize deletion of a
        // replacement directory: its birth/device/inode identity must match.
        await plainRestoreDirectory(path.dirname(this.receiptPath(id)));
        await unlink(this.receiptPath(id));
        await syncRestoreDirectory(path.dirname(this.receiptPath(id)));
      });
    } finally { this.#busy = false; }
  }

  async upload(serverId: string, filename: string, stream: Readable): Promise<WorldImportUploadResponse["data"]> {
    if (!/^[^\\/:<>"|?*\u0000-\u001f\u007f]{1,124}\.zip$/iu.test(filename) || /[. ]$/u.test(filename) || filename.trim() !== filename) {
      throw new DomainError(400, "VALIDATION_ERROR", "请选择不含路径的 .zip 文件", "invalid-import-filename");
    }
    // Serialize global slot admission across servers before creating any directory.
    if (this.#busy) throw new DomainError(409, "OPERATION_CONFLICT", "已有世界上传正在校验，请稍后重试", "import-upload-active");
    this.#busy = true;
    try {
      return await this.operations.runExclusive(serverId, async () => {
        const adapter = this.registry.get(serverId);
        if (!adapter) throw new ServerNotFoundError();
        if (!isLocalAdapter(adapter) || adapter.plan.serverInfo.type !== "vanilla") {
          throw new DomainError(501, "CAPABILITY_UNSUPPORTED", "世界导入目前只支持本地 Vanilla", "unsupported-world-import");
        }
        const status = await adapter.getStatus();
        if (status.recoveryRequired) throw new DomainError(409, "RECOVERY_REQUIRED", "实例需要先完成恢复检查", "recovery-required");
        if (!((status.state === "stopped" && status.ownership === "none") || (status.state === "running" && status.ownership === "managed"))) {
          throw new DomainError(409, "SERVER_STATE_CONFLICT", "无法确认实例状态，拒绝上传", "unmanaged-or-unknown-state");
        }
        await plainRestoreDirectory(adapter.plan.rootPath);
        const version = (await adapter.getServerInfo()).minecraftVersion;
        if (!version) throw new DomainError(409, "WORLD_VERSION_UNAVAILABLE", "服务端版本未确认", "unknown-target-version");
        await plainRestoreDirectory(this.managerRoot);
        const root = path.join(this.managerRoot, "world-imports");
        await mkdir(root, { recursive: true, mode: 0o700 });
        await plainRestoreDirectory(root);
        const entries = await readdir(root);
        for (const entry of entries) {
          if (!/^[0-9a-f-]{36}$/u.test(entry)) throw unsafe();
          await plainRestoreDirectory(path.join(root, entry));
        }
        if (entries.length >= WORLD_IMPORT_UPLOAD_SLOTS) {
          throw new DomainError(507, "IMPORT_STAGING_QUOTA", "世界暂存配额已满，请先人工检查保留的上传", "import-slot-limit");
        }
        await restoreCapacity(root, reservation);
        const id = randomUUID(), directory = path.join(root, id);
        await mkdir(directory, { mode: 0o700 });
        await plainRestoreDirectory(directory);
        // Store ownership before receiving bytes; interrupted artifacts stay private.
        await writeRestoreJson(path.join(directory, "owner.json"), {
          schemaVersion: 1, id, serverId, serverRoot: await realpath(adapter.plan.rootPath),
          rootIdentity: await directoryIdentity(adapter.plan.rootPath), directoryIdentity: await directoryIdentity(directory),
          minecraftVersion: version, state: "receiving"
        });
        const file = await open(path.join(directory, "upload.zip"), "wx", 0o600);
        let bytes = 0;
        const timer = setTimeout(() => stream.destroy(new DomainError(408, "IMPORT_UPLOAD_TIMEOUT", "世界上传超时", "import-timeout")), 60_000);
        timer.unref();
        try {
          for await (const chunk of stream) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > WORLD_IMPORT_ARCHIVE_LIMITS.zipBytes) throw new DomainError(413, "UPLOAD_TOO_LARGE", "世界 ZIP 不能超过 128 MiB", "import-upload-limit");
            await file.writeFile(buffer);
          }
          if (!bytes) throw new DomainError(400, "VALIDATION_ERROR", "世界 ZIP 不能为空", "empty-import-upload");
          await file.sync();
        } finally { clearTimeout(timer); await file.close(); }
        const staged = await stageWorldImportArchive(path.join(directory, "upload.zip"), path.join(directory, "world"), version);
        const checksumSha256 = restoreFilesChecksum(staged.files);
        await writeRestoreJson(path.join(directory, "validated.json"), {
          schemaVersion: 1, id, serverId, minecraftVersion: version, files: staged.files,
          checksumSha256, sizeBytes: staged.sizeBytes, uploadBytes: bytes
        });
        // Reject a replaced private directory before handing back its opaque ID.
        await plainRestoreDirectory(directory);
        if (!(await lstat(path.join(directory, "validated.json"))).isFile()) throw unsafe();
        return { id, serverId, minecraftVersion: version, fileCount: staged.files.length,
          sizeBytes: staged.sizeBytes, checksumSha256, state: "validated", executionAvailable: false };
      });
    } finally { this.#busy = false; }
  }
}
