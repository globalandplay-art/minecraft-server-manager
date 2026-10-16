import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

const MAX_BYTES = 64 * 1024 ** 2;
const unsafe = () => new Error("unsafe-fabric-binding-file");

/** Exact, ephemeral Fabric execution binding only. Never replace persisted receipt identities. */
export async function readFabricBindingFile(file: string, limit = MAX_BYTES) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_BYTES) throw unsafe();
  const before = await lstat(file, { bigint: true });
  const normalized = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size < 0n || before.size > BigInt(limit) ||
    normalized(await realpath(file)) !== normalized(path.resolve(file))) throw unsafe();
  const same = (after: typeof before) => after.isFile() && !after.isSymbolicLink() && after.nlink === 1n &&
    after.dev === before.dev && after.ino === before.ino && after.size === before.size &&
    after.birthtimeNs === before.birthtimeNs && after.mtimeNs === before.mtimeNs && after.ctimeNs === before.ctimeNs;
  const handle = await open(file, "r");
  let bytes: Buffer | undefined;
  try {
    try {
      if (!same(await handle.stat({ bigint: true }))) throw unsafe();
      bytes = Buffer.alloc(Number(before.size));
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw unsafe();
        offset += bytesRead;
      }
      if (!same(await handle.stat({ bigint: true })) || !same(await lstat(file, { bigint: true }))) throw unsafe();
    } finally { await handle.close(); }
  } catch (error) { bytes?.fill(0); throw error; }
  if (!bytes) throw unsafe();
  const identity = createHash("sha256").update(`fabric-binding-file-v1\0${before.dev}\0${before.ino}\0${before.birthtimeNs}`).digest("hex");
  const physicalIdentity = createHash("sha256").update(`fabric-binding-physical-v1\0${before.dev}\0${before.ino}`).digest("hex");
  return { bytes, identity, physicalIdentity, checksum: createHash("sha256").update(bytes).digest("hex") };
}
