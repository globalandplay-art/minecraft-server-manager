import { randomUUID } from "node:crypto";
import { lstat, readdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WhitelistCommandStore } from "../../src/services/whitelist-command-store.js";
import { whitelistCommandHash } from "../../src/services/whitelist-command-record.js";
import { WindowsPrivateAclVerifier } from "../../src/auth/windows-private-acl.js";
import { AuthCoreError } from "../../src/auth/password.js";

async function main() {
  if (process.argv.slice(2).join(" ") !== "--confirm-preserved-readonly") throw new Error("DIAGNOSTIC_ARGUMENTS");
  const start = performance.now(), end = start + 50_000;
  // One already identified failed test root ONLY. Never a real Manager/credential/server root.
  const root = join(await realpath(tmpdir()), "mcsm-physical-capacity-ikoP6r");
  if (await realpath(root) !== root || !(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) throw new Error("DIAGNOSTIC_ROOT");
  const directory = join(root, "whitelist-commands");
  if (await realpath(directory) !== directory || (await lstat(directory)).isSymbolicLink()) throw new Error("DIAGNOSTIC_ROOT");
  const beforeRoot = await lstat(root, { bigint: true }), beforeDirectory = await lstat(directory, { bigint: true });
  const names = await readdir(root), records = await readdir(directory);
  if (names.length !== 5001 || records.length !== 4999 || names.filter((name) => name.startsWith("whitelist-command-")).length !== 4999) throw new Error("DIAGNOSTIC_LAYOUT");
  let deadlineExceeded = false, publications = 0, mutation = false, settled = false, failure: string | null = null;
  let queries = 0, targets = 0, workTimer: ReturnType<typeof setTimeout> | undefined;
  const categories: Record<string, { queries: number; targets: number; firstObservedMs: number; lastObservedMs: number }> = {};
  const milestones: { queries: number; elapsedMs: number }[] = [];
  const fence = () => { if (performance.now() >= end) { deadlineExceeded = true; throw new Error("DIAGNOSTIC_DEADLINE"); } };
  class FakeAcl extends WindowsPrivateAclVerifier {
    override async verifyMany(files: readonly string[]) {
      fence(); let category: string;
      if (files.length === 2 && files[0] === directory && dirname(files[1]!) === directory) category = "record-file";
      else if (files.length === 1 && files[0] === directory) category = "directory-only";
      else if (files.length === 1 && dirname(files[0]!) === root && basename(files[0]!) === "whitelist-commands.receipt.json") category = "namespace-file";
      else if (files.length === 1 && dirname(files[0]!) === root && /^whitelist-command-[a-f0-9-]{36}\.receipt\.json$/u.test(basename(files[0]!))) category = "anchor-file";
      else throw new Error("DIAGNOSTIC_TARGET_SHAPE");
      const elapsedMs = Math.floor(performance.now() - start), row = categories[category] ??= { queries: 0, targets: 0, firstObservedMs: elapsedMs, lastObservedMs: elapsedMs };
      row.queries++; row.targets += files.length; row.lastObservedMs = elapsedMs; queries++; targets += files.length;
      if ([1, 1000, 5000, 10000, 15000, 19999].includes(queries)) milestones.push({ queries, elapsedMs });
      return files.map(() => "synthetic-acl");
    }
  }
  const owner = { assertHeld: (p: string) => { if (p !== root) throw new AuthCoreError("AUTH_PRIVATE_UNSAFE"); },
    rootIdentity: () => whitelistCommandHash(root), beginOfflineMutation: () => {
      if (mutation) throw new AuthCoreError("AUTH_BUSY"); mutation = true; return () => { mutation = false; };
    } };
  const forbidPublication = async () => { publications++; throw new Error("READONLY_DIAGNOSTIC_PUBLICATION_FORBIDDEN"); };
  fence(); const openStartedMs = performance.now() - start;
  const task = WhitelistCommandStore.open(root, owner, new FakeAcl(), { createDirectory: forbidPublication, writeNew: forbidPublication, publishNew: forbidPublication })
    .finally(() => { settled = true; });
  try {
    await Promise.race([task, new Promise<never>((_, reject) => {
      workTimer = setTimeout(() => { deadlineExceeded = true; reject(new Error("DIAGNOSTIC_DEADLINE")); }, Math.max(1, end - performance.now()));
    })]); fence();
  } catch {
    failure = deadlineExceeded ? "DIAGNOSTIC_DEADLINE" : publications > 0
      ? "READONLY_DIAGNOSTIC_PUBLICATION_FORBIDDEN" : "STORE_OPEN_REJECTED";
  } finally { if (workTimer) clearTimeout(workTimer); void task.catch(() => undefined); }
  const openObservedMs = performance.now() - start - openStartedMs, cleanupEnd = performance.now() + 5000;
  while (!settled && performance.now() < cleanupEnd) await new Promise<void>((resolve) => setTimeout(resolve, 10));
  let cleanupBlocked = !settled || mutation || performance.now() >= cleanupEnd;
  let metadataUnchanged = false;
  if (!cleanupBlocked) {
    let metadataTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (performance.now() >= cleanupEnd) throw new Error("DIAGNOSTIC_METADATA");
      metadataUnchanged = await Promise.race([(async () => {
        const afterRoot = await lstat(root, { bigint: true }), afterDirectory = await lstat(directory, { bigint: true });
        return beforeRoot.dev === afterRoot.dev && beforeRoot.ino === afterRoot.ino && beforeRoot.mtimeNs === afterRoot.mtimeNs &&
          beforeDirectory.dev === afterDirectory.dev && beforeDirectory.ino === afterDirectory.ino && beforeDirectory.mtimeNs === afterDirectory.mtimeNs &&
          (await readdir(root)).sort().join("|") === names.sort().join("|") && (await readdir(directory)).sort().join("|") === records.sort().join("|");
      })(), new Promise<never>((_, reject) => { metadataTimer = setTimeout(() => reject(new Error("DIAGNOSTIC_METADATA")), Math.max(1, cleanupEnd - performance.now())); })]);
      if (performance.now() >= cleanupEnd) throw new Error("DIAGNOSTIC_METADATA");
    } catch { cleanupBlocked = true; failure ??= "DIAGNOSTIC_METADATA_UNCONFIRMED"; }
    finally { if (metadataTimer) clearTimeout(metadataTimer); }
  }
  cleanupBlocked ||= performance.now() >= cleanupEnd;
  const prefix = "lc2-preserved-command-open-" + randomUUID();
  const report = { prefix, scope: "PRESERVED_FAKE_ACL_FRESH_STORE_OPEN_ONLY", result: cleanupBlocked ? "CLEANUP_BLOCKED" : failure ? "FAIL" :
    queries === 19999 && targets === 29997 && publications === 0 && metadataUnchanged ? "PASS" : "EVIDENCE_MISMATCH",
    failure, deadlineExceeded, actualActionSettled: settled, publications, metadataUnchanged, queries, targets, categories, milestones,
    openObservedMs: Math.floor(openObservedMs), elapsedMs: Math.floor(performance.now() - start), rootPreserved: true };
  await writeFile(fileURLToPath(new URL("../../../../test-results/" + prefix + ".json", import.meta.url)), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report)); process.exitCode = report.result === "PASS" ? 0 : 1;
}
try { await main(); }
catch { console.error("READONLY_COMMAND_DIAGNOSTIC_UNEXPECTED_OR_EVIDENCE_FAILED"); process.exitCode = 1; }
