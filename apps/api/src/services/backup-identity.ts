import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { plainRestoreDirectory } from "./restore-files.js";

export async function backupDirectoryIdentity(directory: string): Promise<string> {
  await plainRestoreDirectory(directory);
  const info = await lstat(directory, { bigint: true });
  const canonical = await realpath(directory);
  return createHash("sha256").update(`${process.platform === "win32" ? canonical.toLowerCase() : canonical}\0${info.dev}\0${info.ino}\0${info.birthtimeNs}`).digest("hex");
}

/** Object identity across an owned same-volume rename; containment is checked separately. */
export async function directoryObjectIdentity(directory: string): Promise<string> {
  await plainRestoreDirectory(directory);
  const info = await lstat(directory, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("unsafe-directory-object");
  return createHash("sha256").update(`directory-object-v1\0${info.dev}\0${info.ino}\0${info.birthtimeNs}`).digest("hex");
}
