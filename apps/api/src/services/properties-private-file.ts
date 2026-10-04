import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { SERVER_PROPERTIES_LIMIT } from "../config/properties.js";

export const propertiesChecksum = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Backend-only bytes. Never serialize this result into HTTP, logs or Operation.result. */
export async function readPrivatePropertiesFile(file: string, limit = SERVER_PROPERTIES_LIMIT) {
  const before = await lstat(file);
  const normalized = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > limit ||
    normalized(await realpath(file)) !== normalized(path.resolve(file))) throw new Error("unsafe-private-properties-file");
  const same = (after: typeof before) => after.isFile() && !after.isSymbolicLink() && after.nlink === 1 &&
    after.dev === before.dev && after.ino === before.ino && after.size === before.size &&
    after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs;
  const handle = await open(file, "r");
  let bytes: Buffer;
  try {
    if (!same(await handle.stat())) throw new Error("private-properties-file-changed");
    bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error("private-properties-file-short-read");
      offset += bytesRead;
    }
    if (!same(await handle.stat()) || !same(await lstat(file))) throw new Error("private-properties-file-changed");
  } finally { await handle.close(); }
  const identity = createHash("sha256").update(`${before.dev}\0${before.ino}\0${before.birthtimeMs}`).digest("hex");
  const physicalIdentity = createHash("sha256").update(`${before.dev}\0${before.ino}`).digest("hex");
  return { bytes, identity, physicalIdentity, checksum: propertiesChecksum(bytes) };
}
