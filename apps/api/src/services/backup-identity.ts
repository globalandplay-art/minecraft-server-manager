import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { plainRestoreDirectory } from "./restore-files.js";

export async function backupDirectoryIdentity(directory: string): Promise<string> {
  await plainRestoreDirectory(directory);
  const info = await lstat(directory, { bigint: true });
  const canonical = await realpath(directory);
  return createHash("sha256").update(`${process.platform === "win32" ? canonical.toLowerCase() : canonical}\0${info.dev}\0${info.ino}\0${info.birthtimeNs}`).digest("hex");
}
