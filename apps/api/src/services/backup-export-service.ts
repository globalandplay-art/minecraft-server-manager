import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir, realpath, rename, statfs, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";

import type { BackupExportResponse, Operation } from "@mcsm/contracts";
import type { RuntimeOperationContext } from "../infra/runtime-contract.js";
import type { BackupManifest, BackupService } from "./backup-service.js";
import { DomainError } from "./domain-errors.js";
import type { OperationService } from "./operation-service.js";

// A deliberately bounded, stored ZIP profile: no ZIP64, encryption or nested archives.
const MAX_BYTES = 2 * 1024 ** 3;
const MAX_FILES = 60_000;
const MAX_TEXT_BYTES = 2 * 1024 ** 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const SHA = /^[0-9a-f]{64}$/u;
const forbidden = /^(?:server\.properties|ops\.json|whitelist(?:\.json)?|permissions(?:\..*)?|plugins|mods|config)$/iu;
type ReadyArtifact = { schemaVersion: 1; backupId: string; manifestChecksum: string; sizeBytes: number; checksumSha256: string };
type ExportStatus = BackupExportResponse["data"];

function blocked(reason: string, code = "EXPORT_LAYOUT_UNSAFE"): DomainError {
  return new DomainError(409, code, code === "SENSITIVE_ARCHIVE"
    ? "导出被阻止：检测到敏感信息。" : "此备份无法安全导出，请检查备份完整性与世界文件布局。", reason);
}
function normalized(value: string): string {
  return process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
}
function segment(value: string): boolean {
  return value.length > 0 && value.length <= 128 && value !== "." && value !== ".." &&
    !/[\\/:<>"|?*\u0000-\u001f\u007f]/u.test(value) && !/[. ]$/u.test(value) && !RESERVED.test(value);
}
async function directory(value: string): Promise<void> {
  const info = await lstat(value);
  if (!info.isDirectory() || info.isSymbolicLink() || normalized(await realpath(value)) !== normalized(value)) throw blocked("linked-directory");
}
async function regular(root: string, relative: string): Promise<FileHandle> {
  const parts = relative.split("/");
  if (!parts.every(segment) || relative.length > 4096 || parts.length > 64) throw blocked("unsafe-path");
  await directory(root);
  let current = root;
  for (const part of parts.slice(0, -1)) { current = path.join(current, part); await directory(current); }
  const file = path.join(root, ...parts);
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || normalized(await realpath(file)) !== normalized(file)) throw blocked("unsafe-file");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const after = await handle.stat();
    if (!after.isFile() || after.nlink !== 1 || after.dev !== before.dev || after.ino !== before.ino) throw blocked("file-replaced");
    await directory(root);
    return handle;
  } catch (error) { await handle.close(); throw error; }
}
async function* chunks(handle: FileHandle) {
  let position = 0;
  while (true) {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) return;
    position += bytesRead;
    yield buffer.subarray(0, bytesRead);
  }
}
async function syncDirectory(value: string): Promise<void> {
  const handle = await open(value, "r");
  try { await handle.sync(); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!(process.platform === "win32" && ["EACCES", "EISDIR", "EPERM"].includes(code ?? ""))) throw error;
  } finally { await handle.close(); }
}

/** Positive allowlist for Vanilla world storage. Unknown extensions/layouts fail closed. */
function allowed(relative: string, roots: string[]): boolean {
  const parts = relative.split("/");
  if (!parts.every(segment) || !roots.includes(parts[0]!) || parts.some((part) => forbidden.test(part))) return false;
  let rest = parts.slice(1).join("/");
  if (/^DIM(?:-1|1)\//u.test(rest)) rest = rest.replace(/^DIM(?:-1|1)\//u, "");
  else if (rest.startsWith("dimensions/")) {
    // Vanilla custom dimension storage: dimensions/<namespace>/<dimension>/...
    if (parts.length < 5) return false;
    rest = parts.slice(4).join("/");
  }
  return /^(?:level\.dat(?:_old)?|session\.lock|icon\.png)$/u.test(rest) ||
    /^(?:region|entities|poi)\/r\.-?\d+\.-?\d+\.(?:mca|mcc)$/u.test(rest) ||
    /^playerdata\/[0-9a-f-]{36}\.dat(?:_old)?$/iu.test(rest) ||
    /^players\/data\/[0-9a-f-]{36}\.dat(?:_old)?$/iu.test(rest) ||
    /^(?:advancements|stats)\/[0-9a-f-]{36}\.json$/iu.test(rest) ||
    /^data\/[a-zA-Z0-9_.-]+\.(?:dat|json)$/u.test(rest) ||
    // Vanilla 26.3 writes namespaced saved data in the world and dimension roots.
    /^data\/minecraft\/[a-zA-Z0-9_.-]+\.dat$/u.test(rest);
}
function validateManifest(manifest: BackupManifest): void {
  if (manifest.files.length > MAX_FILES || manifest.sizeBytes > MAX_BYTES) {
    throw new DomainError(413, "EXPORT_TOO_LARGE", "初版导出最多支持 2 GiB 世界数据和 60,000 个文件。", "export-size-limit");
  }
  if (manifest.serverType !== "vanilla" || manifest.includedRoots.length !== 1 || !manifest.includedRoots.every(segment)) {
    throw blocked("unsupported-export-layout");
  }
  const folded = new Set<string>();
  for (const file of manifest.files) {
    if (!allowed(file.path, manifest.includedRoots)) throw blocked("file-not-allowlisted");
    const key = file.path.normalize("NFC").toLowerCase();
    if (folded.has(key)) throw blocked("ambiguous-path");
    folded.add(key);
  }
  if (!manifest.files.some((file) => file.path === manifest.includedRoots[0] + "/level.dat")) throw blocked("missing-level-data");
}
async function validateTree(root: string, manifest: BackupManifest): Promise<void> {
  const expected = new Set(manifest.files.map((file) => file.path));
  const directories = new Set<string>();
  for (const file of manifest.files) {
    const parts = file.path.split("/");
    for (let length = 1; length < parts.length; length++) directories.add(parts.slice(0, length).join("/"));
  }
  const visit = async (dir: string, prefix: string): Promise<void> => {
    await directory(dir);
    for await (const entry of await opendir(dir)) {
      if (!segment(entry.name)) throw blocked("unsafe-entry");
      const relative = prefix ? prefix + "/" + entry.name : entry.name;
      const full = path.join(dir, entry.name);
      const info = await lstat(full);
      if (info.isSymbolicLink()) throw blocked("linked-entry");
      if (info.isDirectory()) {
        if (!directories.has(relative)) {
          // Empty world directories have no bytes to export; no traversal into them.
          if (!manifest.includedRoots.some((world) => relative === world || relative.startsWith(world + "/"))) throw blocked("extra-root");
          for await (const _entry of await opendir(full)) { void _entry; throw blocked("unlisted-directory-content"); }
        } else await visit(full, relative);
      } else if (!info.isFile() || !expected.delete(relative)) throw blocked("unlisted-payload-entry");
    }
  };
  await visit(root, "");
  if (expected.size !== 0) throw blocked("missing-payload-entry");
}
function scanText(data: Buffer): void {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); }
  catch { throw blocked("invalid-text-encoding", "SENSITIVE_ARCHIVE"); }
  // Decode JSON escapes before matching so escaped key names cannot evade scanning.
  const scan = (value: unknown): boolean => {
    if (typeof value === "string") return /(?:rcon[._-]?password|password|secret|token|api[._-]?key)\s*["']?\s*[:=]/iu.test(value);
    if (Array.isArray(value)) return value.some(scan);
    if (value && typeof value === "object") return Object.entries(value).some(([key, child]) =>
      /(?:rcon[._-]?password|password|secret|token|api[._-]?key)/iu.test(key) || scan(child));
    return false;
  };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw blocked("invalid-json", "SENSITIVE_ARCHIVE"); }
  if (scan(parsed)) throw blocked("sensitive-content", "SENSITIVE_ARCHIVE");
}
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function localHeader(name: Buffer): Buffer {
  const data = Buffer.alloc(30);
  data.writeUInt32LE(0x04034b50); data.writeUInt16LE(20, 4); data.writeUInt16LE(0x0808, 6);
  data.writeUInt16LE(33, 12); data.writeUInt16LE(name.length, 26);
  return data;
}
function descriptor(crc: number, size: number): Buffer {
  const data = Buffer.alloc(16); data.writeUInt32LE(0x08074b50); data.writeUInt32LE(crc, 4);
  data.writeUInt32LE(size, 8); data.writeUInt32LE(size, 12); return data;
}
function centralHeader(name: Buffer, crc: number, size: number, offset: number): Buffer {
  const data = Buffer.alloc(46);
  data.writeUInt32LE(0x02014b50); data.writeUInt16LE(20, 4); data.writeUInt16LE(20, 6);
  data.writeUInt16LE(0x0808, 8); data.writeUInt16LE(33, 14); data.writeUInt32LE(crc, 16);
  data.writeUInt32LE(size, 20); data.writeUInt32LE(size, 24); data.writeUInt16LE(name.length, 28);
  data.writeUInt32LE(offset, 42); return data;
}
function endRecord(count: number, centralSize: number, centralOffset: number): Buffer {
  const data = Buffer.alloc(22); data.writeUInt32LE(0x06054b50); data.writeUInt16LE(count, 8); data.writeUInt16LE(count, 10);
  data.writeUInt32LE(centralSize, 12); data.writeUInt32LE(centralOffset, 16); return data;
}

/** Verify the actual downloadable bytes, not just a forgeable cached metadata hash.
 * The fixed ZIP profile disallows comments, extra fields, prefixes and trailing bytes.
 */
async function verifyArchive(handle: FileHandle, manifest: BackupManifest, artifact: ReadyArtifact): Promise<void> {
  let position = 0;
  const archiveHash = createHash("sha256");
  const read = async (size: number): Promise<Buffer> => {
    const data = Buffer.alloc(size);
    let filled = 0;
    while (filled < size) {
      const { bytesRead } = await handle.read(data, filled, size - filled, position);
      if (bytesRead === 0) throw blocked("archive-truncated");
      filled += bytesRead; position += bytesRead;
    }
    archiveHash.update(data); return data;
  };
  const compare = async (expected: Buffer) => { if (!(await read(expected.length)).equals(expected)) throw blocked("archive-profile-changed"); };
  const central: Buffer[] = [];
  const before = await handle.stat();
  for (const entry of manifest.files) {
    const name = Buffer.from(entry.path, "utf8"); const offset = position;
    await compare(localHeader(name)); await compare(name);
    const text = /\.json$/iu.test(entry.path);
    if (text && entry.sizeBytes > MAX_TEXT_BYTES) throw blocked("text-scan-limit", "SENSITIVE_ARCHIVE");
    const textChunks: Buffer[] = []; const hash = createHash("sha256");
    let remaining = entry.sizeBytes; let crc = 0xffffffff;
    while (remaining > 0) {
      const data = await read(Math.min(64 * 1024, remaining)); remaining -= data.length;
      hash.update(data); if (text) textChunks.push(data);
      for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 255]! ^ (crc >>> 8)) >>> 0;
    }
    if (hash.digest("hex") !== entry.sha256) throw blocked("archive-payload-changed");
    if (text) scanText(Buffer.concat(textChunks));
    const checksum = (crc ^ 0xffffffff) >>> 0;
    await compare(descriptor(checksum, entry.sizeBytes));
    central.push(centralHeader(name, checksum, entry.sizeBytes, offset), name);
  }
  const centralOffset = position;
  for (const data of central) await compare(data);
  const centralSize = position - centralOffset;
  await compare(endRecord(manifest.files.length, centralSize, centralOffset));
  const after = await handle.stat();
  if (position !== artifact.sizeBytes || after.size !== position || archiveHash.digest("hex") !== artifact.checksumSha256 ||
    before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw blocked("artifact-changed");
}

export class BackupExportService {
  constructor(private readonly backups: BackupService, private readonly operations: OperationService) {}

  async request(serverId: string, backupId: string, key: string): Promise<Operation> {
    if (!UUID.test(backupId)) throw blocked("invalid-backup-id");
    return this.operations.requestBackup(serverId, key, JSON.stringify({ backupId }),
      async (context) => {
        try { await this.#build(serverId, backupId, context); }
        catch (error) {
          if (error instanceof DomainError) throw error;
          throw new DomainError(409, "EXPORT_FAILED", "导出未完成，可检查备份后重试。", "export-io-failure");
        }
      }, async () => { validateManifest((await this.backups.exportSource(serverId, backupId)).manifest); }, "backup-export");
  }

  async status(serverId: string, backupId: string): Promise<ExportStatus> {
    const { manifest, directory: root } = await this.backups.exportSource(serverId, backupId);
    validateManifest(manifest);
    const artifact = await this.#ready(root, manifest);
    if (!artifact) return { backupId, state: "available", sizeBytes: null, checksumSha256: null };
    const file = await regular(root, "world-set.zip");
    try {
      // Status polling must stay cheap. Full byte verification runs in the background
      // export operation and again before a download exposes any data.
      if ((await file.stat()).size !== artifact.sizeBytes) throw blocked("artifact-changed");
    } finally { await file.close(); }
    return { backupId, state: "ready", sizeBytes: artifact.sizeBytes, checksumSha256: artifact.checksumSha256 };
  }

  async download(serverId: string, backupId: string) {
    const { manifest, directory: root } = await this.backups.exportSource(serverId, backupId);
    validateManifest(manifest);
    const artifact = await this.#ready(root, manifest);
    if (!artifact) throw new DomainError(409, "EXPORT_NOT_READY", "请先生成并校验世界导出。", "export-not-ready");
    const file = await regular(root, "world-set.zip");
    try {
      await verifyArchive(file, manifest, artifact);
      return { stream: file.createReadStream({ start: 0, autoClose: true }), sizeBytes: artifact.sizeBytes,
        filename: `world-set-${backupId}.zip`, checksumSha256: artifact.checksumSha256 };
    } catch (error) { await file.close(); throw error; }
  }

  async #ready(root: string, manifest: BackupManifest): Promise<ReadyArtifact | null> {
    let handle: FileHandle;
    try { handle = await regular(root, "export.json"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    try {
      if ((await handle.stat()).size > 4096) throw blocked("invalid-artifact-record");
      const contents: Buffer[] = []; let size = 0;
      for await (const data of chunks(handle)) {
        size += data.length;
        if (size > 4096) throw blocked("invalid-artifact-record");
        contents.push(data);
      }
      const value = JSON.parse(Buffer.concat(contents).toString("utf8")) as Partial<ReadyArtifact>;
      if (value.schemaVersion !== 1 || value.backupId !== manifest.id || value.manifestChecksum !== manifest.checksumSha256 ||
        !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes! < 22 || value.sizeBytes! > MAX_BYTES + 64 * 1024 ** 2 ||
        typeof value.checksumSha256 !== "string" || !SHA.test(value.checksumSha256)) throw blocked("invalid-artifact-record");
      return value as ReadyArtifact;
    } finally { await handle.close(); }
  }

  async #build(serverId: string, backupId: string, context: RuntimeOperationContext): Promise<void> {
    await context.onStep("validating-manifest");
    const { manifest, directory: root } = await this.backups.exportSource(serverId, backupId);
    validateManifest(manifest);
    const cached = await this.#ready(root, manifest);
    if (cached) {
      const archive = await regular(root, "world-set.zip");
      try { await verifyArchive(archive, manifest, cached); } finally { await archive.close(); }
      return;
    }
    const payload = path.join(root, "payload");
    await validateTree(payload, manifest);
    const volume = await statfs(root);
    const estimate = manifest.sizeBytes + manifest.files.reduce((size, file) => size + 128 + Buffer.byteLength(file.path) * 2, 22);
    if (Number(volume.bavail) * Number(volume.bsize) < estimate + 128 * 1024 ** 2) {
      throw new DomainError(507, "BACKUP_STORAGE_LOW", "导出可用磁盘空间不足。", "export-space-low");
    }
    const temporaryName = randomUUID() + ".export.tmp";
    const temporary = path.join(root, temporaryName);
    const metadataTemporary = path.join(root, randomUUID() + ".export-json.tmp");
    await directory(root);
    const output = await open(temporary, "wx", 0o600);
    let position = 0;
    const archiveHash = createHash("sha256");
    const write = async (data: Buffer): Promise<void> => {
      archiveHash.update(data);
      let written = 0;
      while (written < data.length) {
        const result = await output.write(data, written, data.length - written, position);
        if (result.bytesWritten === 0) throw new Error("short-write");
        written += result.bytesWritten; position += result.bytesWritten;
      }
      if (position > MAX_BYTES + 64 * 1024 ** 2) throw blocked("archive-limit");
    };
    try {
      const central: Buffer[] = [];
      await context.onStep("scanning");
      for (const entry of manifest.files) {
        context.signal.throwIfAborted();
        const handle = await regular(payload, entry.path);
        try {
          const before = await handle.stat();
          if (before.size !== entry.sizeBytes) throw blocked("payload-size-changed");
          const text = /\.json$/iu.test(entry.path);
          if (text) {
            if (before.size > MAX_TEXT_BYTES) throw blocked("text-scan-limit", "SENSITIVE_ARCHIVE");
            const parts: Buffer[] = [];
            let scannedBytes = 0;
            for await (const data of chunks(handle)) {
              scannedBytes += data.length;
              if (scannedBytes > MAX_TEXT_BYTES) throw blocked("text-scan-limit", "SENSITIVE_ARCHIVE");
              parts.push(data);
            }
            scanText(Buffer.concat(parts));
          }
          const name = Buffer.from(entry.path, "utf8");
          const offset = position;
          await write(localHeader(name)); await write(name);
          let crc = 0xffffffff;
          let size = 0;
          const hash = createHash("sha256");
          for await (const data of chunks(handle)) {
            size += data.length;
            if (size > entry.sizeBytes) throw blocked("payload-grew");
            for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 255]! ^ (crc >>> 8)) >>> 0;
            hash.update(data); await write(data);
          }
          const after = await handle.stat();
          if (size !== entry.sizeBytes || hash.digest("hex") !== entry.sha256 ||
            before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw blocked("payload-checksum-changed");
          const checksum = (crc ^ 0xffffffff) >>> 0;
          await write(descriptor(checksum, size));
          central.push(centralHeader(name, checksum, size, offset), name);
        } finally { await handle.close(); }
      }
      await context.onStep("exporting");
      const centralOffset = position;
      for (const data of central) await write(data);
      await write(endRecord(manifest.files.length, position - centralOffset, centralOffset));
      await output.sync(); await output.close();
      await directory(root);
      await rename(temporary, path.join(root, "world-set.zip"));
      await syncDirectory(root);
      const artifact: ReadyArtifact = { schemaVersion: 1, backupId, manifestChecksum: manifest.checksumSha256,
        sizeBytes: position, checksumSha256: archiveHash.digest("hex") };
      const metadata = await open(metadataTemporary, "wx", 0o600);
      try { await metadata.writeFile(JSON.stringify(artifact)); await metadata.sync(); } finally { await metadata.close(); }
      await directory(root);
      await rename(metadataTemporary, path.join(root, "export.json"));
      await syncDirectory(root);
      await context.onStep("ready");
    } finally {
      await output.close().catch(() => {});
      // Only unlink this job's fixed staging files after rechecking the private boundary.
      await directory(root);
      for (const file of [temporary, metadataTemporary]) {
        await unlink(file).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      }
    }
  }
}
