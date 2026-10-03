import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, opendir, realpath, rename, statfs } from "node:fs/promises";
import path from "node:path";
import { DomainError } from "./domain-errors.js";

export type RestoreFile = { path: string; sizeBytes: number; sha256: string };
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
export const failLayout = () => new DomainError(409, "RESTORE_LAYOUT_UNSAFE", "恢复文件布局未通过安全检查", "unsafe-restore-layout");
export const missingFile = (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
export function safeRestorePath(relative: string): boolean {
  return relative.length > 0 && relative.length <= 4096 && relative.split("/").length <= 64 &&
    relative.split("/").every((part) => part.length > 0 && part.length <= 255 && ![".", ".."].includes(part) &&
      !/[\\:\u0000-\u001f\u007f]/u.test(part) && !/[. ]$/u.test(part) && !RESERVED.test(part));
}
const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
export async function plainRestoreDirectory(directory: string): Promise<void> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || normalize(await realpath(directory)) !== normalize(path.resolve(directory))) throw failLayout();
}
export async function syncRestoreDirectory(directory: string): Promise<void> {
  let handle;
  try { handle = await open(directory, "r"); await handle.sync(); }
  catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (!["EINVAL", "ENOTSUP"].includes(code) && !(process.platform === "win32" && ["EACCES", "EISDIR", "EPERM"].includes(code))) throw error;
  } finally { await handle?.close(); }
}
export async function makeRestoreDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await plainRestoreDirectory(directory);
  await syncRestoreDirectory(path.dirname(directory));
}
export async function restoreCapacity(directory: string, bytes: number): Promise<void> {
  const volume = await statfs(directory);
  const free = Number(volume.bavail) * Number(volume.bsize);
  if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(free) || free < bytes + Math.max(1024 ** 3, Math.ceil(bytes * .05))) {
    throw new DomainError(507, "RESTORE_STORAGE_LOW", "磁盘空间不足，未开始切换世界", "insufficient-restore-space");
  }
}
async function fileHash(file: string, expectedSize?: number): Promise<{ sizeBytes: number; sha256: string }> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (expectedSize !== undefined && info.size !== expectedSize)) throw failLayout();
  const handle = await open(file, "r");
  const hash = createHash("sha256");
  let sizeBytes = 0;
  try {
    const buffer = Buffer.alloc(128 * 1024);
    while (true) {
      const read = await handle.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      sizeBytes += read.bytesRead;
      if (sizeBytes > info.size) throw failLayout();
      hash.update(buffer.subarray(0, read.bytesRead));
    }
    if (sizeBytes !== info.size) throw failLayout();
    return { sizeBytes, sha256: hash.digest("hex") };
  } finally { await handle.close(); }
}
export function restoreFilesChecksum(files: readonly RestoreFile[]): string {
  return createHash("sha256").update(files.map((f) => `${f.path}\0${f.sizeBytes}\0${f.sha256}`).join("\n")).digest("hex");
}
export async function inventoryRestoreTree(root: string): Promise<RestoreFile[]> {
  await plainRestoreDirectory(root);
  const files: RestoreFile[] = [];
  const normalized = new Set<string>();
  let bytes = 0;
  let entries = 0;
  const visit = async (directory: string, prefix: string) => {
    await plainRestoreDirectory(directory);
    for await (const child of await opendir(directory)) {
      const relative = prefix + child.name;
      if (++entries > 200_000 || !safeRestorePath(relative) || normalized.has(relative.toLowerCase())) throw failLayout();
      normalized.add(relative.toLowerCase());
      const file = path.join(directory, child.name);
      const info = await lstat(file);
      if (info.isSymbolicLink()) throw failLayout();
      if (info.isDirectory()) await visit(file, relative + "/");
      else {
        if (!info.isFile() || info.nlink !== 1 || files.length >= 100_000) throw failLayout();
        bytes += info.size;
        if (!Number.isSafeInteger(bytes) || bytes > 250 * 1024 ** 3) throw failLayout();
        files.push({ path: relative, ...await fileHash(file, info.size) });
      }
    }
  };
  await visit(root, "");
  files.sort((a, b) => a.path.localeCompare(b.path));
  if (!files.some((f) => f.path === "level.dat")) throw failLayout();
  return files;
}
export async function verifyRestoreTree(root: string, expected: readonly RestoreFile[]): Promise<void> {
  const actual = await inventoryRestoreTree(root);
  const sorted = [...expected].sort((a, b) => a.path.localeCompare(b.path));
  if (actual.length !== sorted.length || restoreFilesChecksum(actual) !== restoreFilesChecksum(sorted)) throw failLayout();
}
export async function copyRestoreTree(source: string, destination: string, files: readonly RestoreFile[]): Promise<void> {
  await plainRestoreDirectory(source);
  await mkdir(destination, { mode: 0o700 });
  const dirs = new Set<string>([destination]);
  for (const file of files) {
    if (!safeRestorePath(file.path)) throw failLayout();
    const parts = file.path.split("/");
    let parent = destination;
    for (const part of parts.slice(0, -1)) {
      parent = path.join(parent, part);
      if (!dirs.has(parent)) { await makeRestoreDirectory(parent); dirs.add(parent); }
    }
    const sourceFile = path.join(source, ...parts);
    const info = await lstat(sourceFile);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== file.sizeBytes) throw failLayout();
    const input = await open(sourceFile, "r");
    let output;
    try {
      output = await open(path.join(destination, ...parts), "wx", 0o600);
      const buffer = Buffer.alloc(128 * 1024);
      const hash = createHash("sha256");
      let total = 0;
      while (true) {
        const read = await input.read(buffer, 0, buffer.length, null);
        if (!read.bytesRead) break;
        total += read.bytesRead;
        if (total > file.sizeBytes) throw failLayout();
        const chunk = buffer.subarray(0, read.bytesRead);
        hash.update(chunk);
        await output.writeFile(chunk);
      }
      if (total !== file.sizeBytes || hash.digest("hex") !== file.sha256) throw failLayout();
      await output.sync();
    } finally { await input.close(); await output?.close(); }
  }
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) await syncRestoreDirectory(dir);
  await syncRestoreDirectory(path.dirname(destination));
  await verifyRestoreTree(destination, files);
}
export async function writeRestoreJson(file: string, value: unknown): Promise<void> {
  const payload = JSON.stringify(value) + "\n";
  if (Buffer.byteLength(payload) > 64 * 1024 ** 2) throw failLayout();
  const temporary = file + "." + randomUUID() + ".tmp";
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(payload, "utf8"); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, file);
  await syncRestoreDirectory(path.dirname(file));
}
