import { closeSync, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync, type BigIntStats } from "node:fs";
import { rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const fail = () => new Error("maturity-final-file-fence-unverified");
const normalized = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
const identity = (stat: BigIntStats) => createHash("sha256").update(`${stat.dev}\0${stat.ino}\0${stat.birthtimeNs}`).digest("hex");
const version = (a: BigIntStats, b: BigIntStats) => a.isFile() && b.isFile() && !b.isSymbolicLink() && b.nlink === 1n &&
  a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

/** Narrow project IO seam; caller has already verified same-device containment.
 * No command shell, retries, deletion, fallback copy or rollback. */
export async function renameMaturityCatalog(source: string, target: string): Promise<void> { await rename(source, target); }
export function assertMaturitySameDevice(source: bigint, target: bigint): void { if (source !== target) throw fail(); }

/** Bounded synchronous closing fence, no await between these checks and CAS.
 * Hold handles through all control/directory checks and recheck content versions.
 * This does not claim OS-level isolation from an administrator bypassing locks. */
export function validateMaturityFenceSync(controls: readonly { file: string; limit: number; checksum: string; objectIdentity: string }[],
  directories: readonly { directory: string; identity: string }[], catalog: string, absent: readonly string[]) {
  if (controls.length < 2 || controls.length > 3 || directories.length !== 4 || absent.length < 1 || absent.length > 2) throw fail();
  const held: { fd: number; file: string; stat: BigIntStats }[] = [];
  try {
    for (const control of controls) {
      if (!Number.isSafeInteger(control.limit) || control.limit < 1 || control.limit > 1024 * 1024) throw fail();
      const before = lstatSync(control.file, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(control.limit) ||
          normalized(realpathSync(control.file)) !== normalized(path.resolve(control.file))) throw fail();
      const fd = openSync(control.file, "r"); held.push({ fd, file: control.file, stat: before });
      if (!version(before, fstatSync(fd, { bigint: true }))) throw fail();
      const bytes = Buffer.alloc(Number(before.size));
      try {
        let offset = 0;
        while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length - offset, offset); if (!count) throw fail(); offset += count; }
        if (createHash("sha256").update(bytes).digest("hex") !== control.checksum || identity(before) !== control.objectIdentity) throw fail();
      } finally { bytes.fill(0); }
    }
    for (const item of held) assertMaturitySameDevice(held[0]!.stat.dev, item.stat.dev);
    for (const entry of directories) {
      const stat = lstatSync(entry.directory, { bigint: true }), canonical = realpathSync(entry.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || normalized(canonical) !== normalized(path.resolve(entry.directory)) ||
          createHash("sha256").update(`${normalized(canonical)}\0${stat.dev}\0${stat.ino}\0${stat.birthtimeNs}`).digest("hex") !== entry.identity) throw fail();
    }
    const dir = opendirSync(catalog); let count = 0;
    try { for (;;) { const item = dir.readSync(); if (!item) break;
      if (++count > 1 || item.name !== "state.json" || !item.isFile() || item.isSymbolicLink()) throw fail(); }
      if (count !== 1) throw fail();
    } finally { dir.closeSync(); }
    for (const file of absent) {
      try { lstatSync(file); throw fail(); } catch (error) {
        if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
      }
    }
    for (const item of held) if (!version(item.stat, fstatSync(item.fd, { bigint: true })) ||
      !version(item.stat, lstatSync(item.file, { bigint: true }))) throw fail();
  } finally {
    let failure: unknown;
    for (const item of held) { try { closeSync(item.fd); } catch (error) { failure ??= error; } }
    if (failure) throw failure;
  }
}
