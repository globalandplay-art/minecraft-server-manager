import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { backupDirectoryIdentity } from "./backup-identity.js";

const invalid = () => new Error("WHITELIST_LOG_WINDOW_UNAVAILABLE");
/** A bounded read of one already-open log descriptor for this operation only.
 * Rotation, truncation, partial lines, links or >64KiB of new logs are UNKNOWN.
 * No log contents, IPs or errors are retained or returned to HTTP. */
export async function openWhitelistLogWindow(root: string, rootIdentity: string) {
  if (await backupDirectoryIdentity(root) !== rootIdentity) throw invalid();
  const directory = path.join(root, "logs"), directoryIdentity = await backupDirectoryIdentity(directory);
  const file = path.join(directory, "latest.log"), before = await lstat(file, { bigint: true });
  const sameFile = (value: typeof before) => value.isFile() && !value.isSymbolicLink() && value.nlink === 1n &&
    value.dev === before.dev && value.ino === before.ino && value.birthtimeNs === before.birthtimeNs;
  if (!sameFile(before) || before.size > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid();
  const handle = await open(file, "r");
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameFile(opened) || opened.size !== before.size || opened.mtimeNs !== before.mtimeNs) throw invalid();
    if (before.size) {
      const last = Buffer.alloc(1); const read = await handle.read(last, 0, 1, Number(before.size - 1n));
      if (read.bytesRead !== 1 || last[0] !== 10) throw invalid();
    }
    if (!sameFile(await lstat(file, { bigint: true })) || await backupDirectoryIdentity(root) !== rootIdentity ||
      await backupDirectoryIdentity(directory) !== directoryIdentity) throw invalid();
  } catch (error) { await handle.close(); throw error; }
  return {
    close: () => handle.close(),
    finish: async (): Promise<boolean> => {
      const end = await handle.stat({ bigint: true });
      const length = end.size - before.size;
      if (!sameFile(end) || length < 0n || length > 65536n) throw invalid();
      const bytes = Buffer.alloc(Number(length));
      try {
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, Number(before.size) + offset);
          if (!bytesRead) throw invalid(); offset += bytesRead;
        }
        const after = await handle.stat({ bigint: true });
        if (!sameFile(after) || after.size !== end.size || after.mtimeNs !== end.mtimeNs ||
          !sameFile(await lstat(file, { bigint: true })) || await backupDirectoryIdentity(root) !== rootIdentity ||
          await backupDirectoryIdentity(directory) !== directoryIdentity || (bytes.length && bytes.at(-1) !== 10)) throw invalid();
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return text.split(/\r?\n/u).some(line => /^\[\d{2}:\d{2}:\d{2}\] \[Server thread\/(?:WARN|ERROR)\]: Could not save the list after (?:adding|removing) a user\.$/u.test(line));
      } finally { bytes.fill(0); }
    }
  };
}
