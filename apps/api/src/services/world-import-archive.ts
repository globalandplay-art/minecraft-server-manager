import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw } from "node:zlib";
import yauzl, { type Entry } from "yauzl";
import { DomainError } from "./domain-errors.js";
import { inventoryRestoreTree, plainRestoreDirectory, syncRestoreDirectory, type RestoreFile } from "./restore-files.js";
import { readWorldVersion } from "./world-inventory-service.js";

export const WORLD_IMPORT_ARCHIVE_LIMITS = Object.freeze({
  zipBytes: 128 * 1024 ** 2, expandedBytes: 512 * 1024 ** 2,
  entries: 10_000, fileBytes: 128 * 1024 ** 2, ratio: 100, depth: 32
});
export type StagedWorldImport = { minecraftVersion: string; files: RestoreFile[]; sizeBytes: number };
type ValidatedEntry = { entry: Entry; relative: string; directory: boolean; dataStart: number; end: number };
const unsafe = (reason: string) => new DomainError(409, "IMPORT_ARCHIVE_UNSAFE", "世界 ZIP 未通过安全检查", reason);
const tooLarge = () => new DomainError(413, "IMPORT_ARCHIVE_TOO_LARGE", "世界 ZIP 超过导入资源限制", "import-archive-limit");
const canonical = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
const fold = (value: string) => value.normalize("NFC").toLowerCase();
const reserved = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu;
function safePath(value: string): boolean {
  const parts = value.split("/");
  return value.length > 0 && value.length <= 4096 && parts.length <= WORLD_IMPORT_ARCHIVE_LIMITS.depth && parts.every((part) =>
    part.length > 0 && part.length <= 255 && ![".", ".."].includes(part) &&
    !/[\\:<>"|?*\u0000-\u001f\u007f]/u.test(part) && !/[. ]$/u.test(part) && !reserved.test(part));
}
// Mirrors the secure export's positive Vanilla storage profile. No configs, archives or executables.
export function allowedWorldImportFile(relative: string): boolean {
  let rest = relative;
  let dimension = false;
  if (/^DIM(?:-1|1)\//u.test(rest)) { rest = rest.replace(/^DIM(?:-1|1)\//u, ""); dimension = true; }
  else if (/^dimensions\/[a-z0-9_.-]+\/[a-z0-9_.-]+\//u.test(rest)) {
    rest = rest.split("/").slice(3).join("/"); dimension = true;
  }
  return (!dimension && /^(?:level\.dat(?:_old)?|session\.lock|icon\.png)$/u.test(rest)) ||
    /^(?:region|entities|poi)\/r\.-?\d+\.-?\d+\.(?:mca|mcc)$/u.test(rest) ||
    (!dimension && /^(?:playerdata|players\/data)\/[0-9a-f-]{36}\.dat(?:_old)?$/iu.test(rest)) ||
    (!dimension && /^(?:advancements|stats)\/[0-9a-f-]{36}\.json$/iu.test(rest)) ||
    /^data\/[a-zA-Z0-9_.-]+\.(?:dat|json)$/u.test(rest) ||
    /^data\/minecraft\/[a-zA-Z0-9_.-]+\.dat$/u.test(rest);
}
function allowedDirectory(relative: string): boolean {
  if (["region", "entities", "poi", "data", "data/minecraft", "playerdata", "players", "players/data", "advancements", "stats", "DIM-1", "DIM1", "dimensions"].includes(relative)) return true;
  if (/^dimensions\/[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)?$/u.test(relative)) return true;
  return /^(?:DIM(?:-1|1)|dimensions\/[a-z0-9_.-]+\/[a-z0-9_.-]+)\/(?:region|entities|poi|data(?:\/minecraft)?)$/u.test(relative);
}
async function readAt(handle: FileHandle, position: number, size: number): Promise<Buffer> {
  if (!Number.isSafeInteger(position) || position < 0 || size < 0 || size > 131_072) throw unsafe("invalid-zip-offset");
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(buffer, offset, size - offset, position + offset);
    if (!bytesRead) throw unsafe("truncated-zip");
    offset += bytesRead;
  }
  return buffer;
}
function validateExtra(extra: Buffer): void {
  let offset = 0;
  const seen = new Set<number>();
  while (offset < extra.length) {
    if (offset + 4 > extra.length) throw unsafe("invalid-extra-field");
    const id = extra.readUInt16LE(offset), size = extra.readUInt16LE(offset + 2);
    // Unknown Unix/ASi fields can encode hard links or devices; fail closed.
    if (![0x5455, 0x7875].includes(id) || seen.has(id) || offset + 4 + size > extra.length) throw unsafe("unsupported-extra-field");
    seen.add(id); offset += 4 + size;
  }
}
async function directoryEnd(handle: FileHandle, size: number) {
  if (size < 22) throw unsafe("invalid-zip");
  const start = Math.max(0, size - 65_557), tail = await readAt(handle, start, size - start);
  let offset = tail.length - 22;
  while (offset >= 0 && !(tail.readUInt32LE(offset) === 0x06054b50 && offset + 22 + tail.readUInt16LE(offset + 20) === tail.length)) offset--;
  if (offset < 0) throw unsafe("missing-zip-directory");
  const end = tail.subarray(offset);
  const count = end.readUInt16LE(10), bytes = end.readUInt32LE(12), central = end.readUInt32LE(16);
  if (end.readUInt16LE(4) !== 0 || end.readUInt16LE(6) !== 0 || end.readUInt16LE(8) !== count ||
    count === 0xffff || bytes === 0xffffffff || central === 0xffffffff || central + bytes !== start + offset) throw unsafe("multidisk-or-zip64");
  if (count === 0) throw unsafe("empty-zip");
  if (count > WORLD_IMPORT_ARCHIVE_LIMITS.entries) throw tooLarge();
  return { count, central, bytes };
}
async function validateEntry(handle: FileHandle, entry: Entry, cursor: number, centralEnd: number, dataEnd: number): Promise<ValidatedEntry> {
  const header = await readAt(handle, cursor, 46);
  if (header.readUInt32LE(0) !== 0x02014b50 || header.readUInt16LE(34) !== 0 ||
    cursor + 46 + entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength > centralEnd) throw unsafe("invalid-central-entry");
  const directory = entry.fileName.endsWith("/");
  const relative = directory ? entry.fileName.slice(0, -1) : entry.fileName;
  if (!safePath(relative)) throw unsafe("unsafe-entry-path");
  if (entry.generalPurposeBitFlag & ~0x080e || ![0, 8].includes(entry.compressionMethod) ||
    (entry.compressionMethod === 0 && (entry.generalPurposeBitFlag & 6) !== 0) || entry.versionNeededToExtract > 20) throw unsafe("unsupported-zip-feature");
  if (entry.generalPurposeBitFlag & 0x0800) {
    let decoded: string;
    try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(entry.fileNameRaw); } catch { throw unsafe("invalid-name-encoding"); }
    if (decoded !== entry.fileName) throw unsafe("ambiguous-name-encoding");
  }
  const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
  const unix = entry.versionMadeBy >>> 8 === 3;
  if ((mode !== 0 && mode !== (directory ? 0x4000 : 0x8000)) || (unix && mode === 0) ||
    (!directory && (entry.externalFileAttributes & 0x10) !== 0) || (entry.externalFileAttributes & 0x08) !== 0) throw unsafe("nonregular-entry");
  validateExtra(entry.extraFieldRaw);
  if (entry.uncompressedSize > WORLD_IMPORT_ARCHIVE_LIMITS.fileBytes ||
    entry.uncompressedSize > entry.compressedSize * WORLD_IMPORT_ARCHIVE_LIMITS.ratio) throw tooLarge();
  if (directory && (entry.uncompressedSize !== 0 || entry.compressedSize !== 0 || entry.crc32 !== 0 || entry.compressionMethod !== 0)) throw unsafe("directory-with-payload");
  const local = await readAt(handle, entry.relativeOffsetOfLocalHeader, 30);
  if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(4) !== entry.versionNeededToExtract ||
    local.readUInt16LE(6) !== entry.generalPurposeBitFlag || local.readUInt16LE(8) !== entry.compressionMethod ||
    local.readUInt16LE(10) !== entry.lastModFileTime || local.readUInt16LE(12) !== entry.lastModFileDate || local.readUInt16LE(26) !== entry.fileNameLength) throw unsafe("local-header-mismatch");
  const extraSize = local.readUInt16LE(28);
  const fields = await readAt(handle, entry.relativeOffsetOfLocalHeader + 30, entry.fileNameLength + extraSize);
  if (!fields.subarray(0, entry.fileNameLength).equals(entry.fileNameRaw)) throw unsafe("local-name-mismatch");
  validateExtra(fields.subarray(entry.fileNameLength));
  const descriptor = (entry.generalPurposeBitFlag & 8) !== 0;
  for (const [offset, expected] of [[14, entry.crc32], [18, entry.compressedSize], [22, entry.uncompressedSize]]) {
    const actual = local.readUInt32LE(offset!);
    if (actual !== expected && !(descriptor && actual === 0)) throw unsafe("local-size-mismatch");
  }
  const dataStart = entry.relativeOffsetOfLocalHeader + 30 + fields.length;
  let end = dataStart + entry.compressedSize;
  if (end > dataEnd) throw unsafe("entry-outside-payload");
  if (descriptor) {
    if (end + 12 > dataEnd) throw unsafe("truncated-data-descriptor");
    const first = await readAt(handle, end, 4);
    const signed = first.readUInt32LE(0) === 0x08074b50;
    const values = await readAt(handle, end + (signed ? 4 : 0), 12);
    if (values.readUInt32LE(0) !== entry.crc32 || values.readUInt32LE(4) !== entry.compressedSize || values.readUInt32LE(8) !== entry.uncompressedSize) throw unsafe("data-descriptor-mismatch");
    end += signed ? 16 : 12;
    if (end > dataEnd) throw unsafe("entry-outside-payload");
  }
  return { entry, relative, directory, dataStart, end };
}
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index; for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  return crc >>> 0;
});
function crcUpdate(crc: number, chunk: Buffer): number {
  for (const byte of chunk) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!;
  return crc;
}
async function* compressedChunks(handle: FileHandle, start: number, size: number) {
  for (let offset = 0; offset < size;) {
    const chunk = await readAt(handle, start + offset, Math.min(64 * 1024, size - offset));
    offset += chunk.length; yield chunk;
  }
}

/** Internal helper: both paths are generated/private manager paths, never client-selected paths.
 * Failure leaves the generated staging tree for the owning transaction's guarded cleanup.
 */
export async function stageWorldImportArchive(archivePath: string, stagingPath: string, targetMinecraftVersion: string): Promise<StagedWorldImport> {
  await plainRestoreDirectory(path.dirname(stagingPath));
  const info = await lstat(archivePath);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || canonical(await realpath(archivePath)) !== canonical(archivePath)) throw unsafe("unsafe-archive-file");
  if (info.size > WORLD_IMPORT_ARCHIVE_LIMITS.zipBytes) throw tooLarge();
  const input = await open(archivePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await input.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== info.ino || opened.dev !== info.dev || opened.size !== info.size) throw unsafe("archive-replaced");
    const directory = await directoryEnd(input, opened.size);
    // FileHandle owns this descriptor; yauzl must not close it, including error paths.
    const zip = await yauzl.fromFdPromise(input.fd, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true });
    const entries: ValidatedEntry[] = [];
    let cursor = directory.central, expanded = 0, compressed = 0;
    for await (const entry of zip.eachEntry()) {
      if (entries.length >= WORLD_IMPORT_ARCHIVE_LIMITS.entries) throw tooLarge();
      const validated = await validateEntry(input, entry, cursor, directory.central + directory.bytes, directory.central);
      entries.push(validated);
      cursor += 46 + entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength;
      expanded += entry.uncompressedSize; compressed += entry.compressedSize;
      if (expanded > WORLD_IMPORT_ARCHIVE_LIMITS.expandedBytes || expanded > compressed * WORLD_IMPORT_ARCHIVE_LIMITS.ratio) throw tooLarge();
    }
    if (cursor !== directory.central + directory.bytes || entries.length !== directory.count) throw unsafe("central-directory-mismatch");
    let previousEnd = 0;
    for (const item of [...entries].sort((a, b) => a.entry.relativeOffsetOfLocalHeader - b.entry.relativeOffsetOfLocalHeader)) {
      if (item.entry.relativeOffsetOfLocalHeader < previousEnd) throw unsafe("overlapping-entries");
      previousEnd = item.end;
    }
    const rootLevel = entries.some((item) => !item.directory && item.relative === "level.dat");
    let prefix = "";
    if (!rootLevel) {
      const tops = new Set(entries.map((item) => item.relative.split("/")[0]!));
      if (tops.size !== 1) throw unsafe("multiple-world-roots");
      prefix = [...tops][0]! + "/";
      if (!entries.some((item) => !item.directory && item.relative === prefix + "level.dat")) throw unsafe("missing-level-data");
    }
    // Reject unknown layouts before materializing prefixes. The allowlist bounds
    // accepted storage to six segments (seven including an optional wrapper).
    // Otherwise 10,000 long, 32-deep names could amplify into 320,000 strings.
    for (const item of entries) {
      if (prefix && item.directory && item.relative === prefix.slice(0, -1)) continue;
      if (prefix && !item.relative.startsWith(prefix)) throw unsafe("extra-root-entry");
      const relative = item.relative.slice(prefix.length);
      if (!(item.directory ? allowedDirectory(relative) : allowedWorldImportFile(relative))) throw unsafe("file-not-allowlisted");
    }
    const rawPaths = new Set<string>(), treePaths = new Map<string, { path: string; directory: boolean }>();
    for (const item of entries) {
      const key = fold(item.relative);
      if (rawPaths.has(key)) throw unsafe("duplicate-entry"); rawPaths.add(key);
      const parts = item.relative.split("/");
      for (let depth = 1; depth <= parts.length; depth++) {
        const relative = parts.slice(0, depth).join("/"), directory = depth < parts.length || item.directory;
        const existing = treePaths.get(fold(relative));
        if (existing && (existing.path !== relative || existing.directory !== directory)) throw unsafe("ambiguous-entry-tree");
        treePaths.set(fold(relative), { path: relative, directory });
      }
    }
    for (const item of entries) {
      if (prefix && item.directory && item.relative === prefix.slice(0, -1)) { item.relative = ""; continue; }
      item.relative = item.relative.slice(prefix.length);
    }
    await mkdir(stagingPath, { mode: 0o700 }); // Deliberately exclusive, never reuse an existing tree.
    await plainRestoreDirectory(stagingPath);
    const dirs = new Set([stagingPath]);
    let actualExpanded = 0;
    for (const item of entries) {
      if (!item.relative) continue;
      const parts = item.relative.split("/");
      let parent = stagingPath;
      for (const part of parts.slice(0, item.directory ? parts.length : -1)) {
        parent = path.join(parent, part);
        if (!dirs.has(parent)) { await mkdir(parent, { mode: 0o700 }); await plainRestoreDirectory(parent); dirs.add(parent); }
      }
      if (item.directory) continue;
      await plainRestoreDirectory(parent);
      const output = await open(path.join(stagingPath, ...parts), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      let actual = 0, crc = 0xffffffff;
      const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        actual += chunk.length; actualExpanded += chunk.length;
        if (actual > item.entry.uncompressedSize || actual > WORLD_IMPORT_ARCHIVE_LIMITS.fileBytes || actualExpanded > WORLD_IMPORT_ARCHIVE_LIMITS.expandedBytes) { callback(tooLarge()); return; }
        crc = crcUpdate(crc, chunk); callback(null, chunk);
      } });
      const compressedStream = Readable.from(compressedChunks(input, item.dataStart, item.entry.compressedSize));
      const inflater = item.entry.compressionMethod === 8 ? createInflateRaw() : undefined;
      try {
        const sink = new Writable({ write(chunk: Buffer, _encoding, callback) { void output.writeFile(chunk).then(() => callback(), callback); } });
        if (inflater) await pipeline(compressedStream, inflater, bounded, sink);
        else await pipeline(compressedStream, bounded, sink);
        if (actual !== item.entry.uncompressedSize || ((crc ^ 0xffffffff) >>> 0) !== item.entry.crc32 || (inflater && inflater.bytesWritten !== item.entry.compressedSize)) throw unsafe("entry-content-mismatch");
        const after = await output.stat();
        if (!after.isFile() || after.nlink !== 1 || after.size !== actual) throw unsafe("unsafe-staged-file");
        await output.sync();
      } finally { compressedStream.destroy(); await output.close(); }
    }
    if (actualExpanded !== expanded) throw unsafe("expanded-size-mismatch");
    const after = await input.stat();
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw unsafe("archive-changed");
    const minecraftVersion = await readWorldVersion(stagingPath);
    if (minecraftVersion === null || minecraftVersion !== targetMinecraftVersion) throw new DomainError(409, "IMPORT_VERSION_UNSUPPORTED", "仅支持与服务端版本完全一致的世界", "import-version-mismatch");
    const files = await inventoryRestoreTree(stagingPath);
    if (files.length !== entries.filter((item) => !item.directory).length || files.reduce((sum, file) => sum + file.sizeBytes, 0) !== actualExpanded) throw unsafe("staged-tree-mismatch");
    for (const dir of [...dirs].sort((a, b) => b.length - a.length)) await syncRestoreDirectory(dir);
    await syncRestoreDirectory(path.dirname(stagingPath));
    return { minecraftVersion, files, sizeBytes: actualExpanded };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw unsafe("invalid-zip-or-staging");
  } finally { await input.close(); }
}
