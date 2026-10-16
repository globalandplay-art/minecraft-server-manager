import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

export const WHITELIST_BYTES = 256 * 1024;
export const WHITELIST_MEMBERS = 1000;
const NAME = /^[A-Za-z0-9_]{3,16}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const unsafe = () => new Error("WHITELIST_READ_UNSAFE");
const normal = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;

/** Stored membership only; no profile lookup, inferred UUID, file creation or live state claim. */
export async function readStoredWhitelist(root: string): Promise<{ name: string; uuid: string }[]> {
  const directory = await lstat(root, { bigint: true });
  if (!directory.isDirectory() || directory.isSymbolicLink() || normal(await realpath(root)) !== normal(path.resolve(root))) throw unsafe();
  const file = path.join(root, "whitelist.json"), before = await lstat(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size < 0n || before.size > BigInt(WHITELIST_BYTES) ||
    normal(await realpath(file)) !== normal(path.resolve(file))) throw unsafe();
  const same = (after: typeof before) => after.isFile() && !after.isSymbolicLink() && after.nlink === 1n &&
    after.dev === before.dev && after.ino === before.ino && after.size === before.size &&
    after.birthtimeNs === before.birthtimeNs && after.mtimeNs === before.mtimeNs && after.ctimeNs === before.ctimeNs;
  const handle = await open(file, "r"); let bytes: Buffer | undefined;
  try {
    try {
      if (!same(await handle.stat({ bigint: true }))) throw unsafe();
      bytes = Buffer.alloc(Number(before.size)); let offset = 0;
      while (offset < bytes.length) {
        const read = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!read.bytesRead) throw unsafe(); offset += read.bytesRead;
      }
      if (!same(await handle.stat({ bigint: true })) || !same(await lstat(file, { bigint: true }))) throw unsafe();
      const after = await lstat(root, { bigint: true });
      if (!after.isDirectory() || after.isSymbolicLink() || after.dev !== directory.dev || after.ino !== directory.ino ||
        after.birthtimeNs !== directory.birthtimeNs || normal(await realpath(root)) !== normal(path.resolve(root))) throw unsafe();
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      if (text.startsWith("\ufeff") || text.includes("\0")) throw unsafe();
      const value: unknown = JSON.parse(text);
      if (!Array.isArray(value) || value.length > WHITELIST_MEMBERS) throw unsafe();
      const names = new Set<string>(), ids = new Set<string>();
      return value.map((member: unknown) => {
        if (!member || typeof member !== "object" || Array.isArray(member) || Object.keys(member).sort().join(",") !== "name,uuid") throw unsafe();
        const row = member as Record<string, unknown>;
        if (typeof row.name !== "string" || !NAME.test(row.name) || typeof row.uuid !== "string" || !UUID.test(row.uuid)) throw unsafe();
        const name = row.name.toLowerCase(), uuid = row.uuid.toLowerCase();
        if (names.has(name) || ids.has(uuid)) throw unsafe(); names.add(name); ids.add(uuid);
        return { name: row.name, uuid };
      });
    } finally { await handle.close(); }
  } finally { bytes?.fill(0); }
}
