import { lstat, open, opendir } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import { PropertiesReader } from "./properties-reader.js";
import { editablePropertyEntries } from "./properties-grammar.js";
import { isSensitiveKey } from "../infra/runtime/redactor.js";
import { analyzeCrashEvidence, type CrashEvidence } from "./crash-analysis-core.js";

const LIMIT = 64 * 1024;
const unsafe = () => new DomainError(409, "CRASH_EVIDENCE_UNSAFE", "日志证据无法安全读取，请检查注册实例文件状态", "evidence-identity-unverified");
const missing = (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
const sameFile = (a: Awaited<ReturnType<typeof lstat>>, b: Awaited<ReturnType<typeof lstat>>) =>
  a.isFile() && b.isFile() && !a.isSymbolicLink() && !b.isSymbolicLink() && a.nlink === 1 && b.nlink === 1 &&
  a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

/** Internal only: callers must derive root/identity from the registered adapter, never HTTP input. */
export class CrashEvidenceReader {
  async read(serverId: string, root: string, expectedRootIdentity: string) {
    try {
      if (await backupDirectoryIdentity(root) !== expectedRootIdentity) throw unsafe();
      const properties = await new PropertiesReader().snapshot(serverId, root);
      if (properties.rootIdentity !== expectedRootIdentity) throw unsafe();
      const secrets = editablePropertyEntries(properties.bytes.toString("utf8")).filter(([key]) => isSensitiveKey(key)).map(([, value]) => value);
      const inputs: CrashEvidence[] = []; let incomplete = false;
      const readFile = async (directory: string, name: string, id: string, source: CrashEvidence["source"], tail: boolean) => {
        let directoryIdentity;
        try { directoryIdentity = await backupDirectoryIdentity(directory); }
        catch (error) { if (missing(error)) return; throw error; }
        const file = path.join(directory, name); let before;
        try { before = await lstat(file); } catch (error) { if (missing(error)) return; throw error; }
        if (!sameFile(before, before)) throw unsafe();
        const handle = await open(file, "r").catch(() => { throw unsafe(); }); let bytes;
        try {
          if (!sameFile(before, await handle.stat())) throw unsafe();
          const offset = tail ? Math.max(0, before.size - LIMIT) : 0;
          bytes = Buffer.alloc(Math.min(before.size, LIMIT));
          const result = await handle.read(bytes, 0, bytes.length, offset);
          if (result.bytesRead !== bytes.length || !sameFile(before, await handle.stat()) || !sameFile(before, await lstat(file))) throw unsafe();
          if (offset > 0) { const newline = bytes.indexOf(10); bytes = newline < 0 ? Buffer.alloc(0) : bytes.subarray(newline + 1); }
          if (!tail && before.size > LIMIT) { const newline = bytes.lastIndexOf(10); bytes = newline < 0 ? Buffer.alloc(0) : bytes.subarray(0, newline + 1); }
        } finally { await handle.close(); }
        if (await backupDirectoryIdentity(directory) !== directoryIdentity) throw unsafe();
        let text: string;
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
        catch { incomplete = true; return; }
        inputs.push({ id, source, text, truncated: before.size > LIMIT });
      };
      const logs = path.join(root, "logs");
      await readFile(logs, "latest.log", "latest-log", "latest-log", true);
      const crashes = path.join(root, "crash-reports");
      let crashIdentity;
      try { crashIdentity = await backupDirectoryIdentity(crashes); }
      catch (error) { if (!missing(error)) throw error; }
      if (crashIdentity) {
        const names: string[] = []; let count = 0;
        for await (const entry of await opendir(crashes)) {
          if (++count > 64) { incomplete = true; break; }
          if (/^crash-\d{4}-\d{2}-\d{2}_\d{2}\.\d{2}\.\d{2}-server\.txt$/u.test(entry.name)) names.push(entry.name);
        }
        if (names.length > 3) incomplete = true;
        for (const [index, name] of names.sort().reverse().slice(0, 3).entries()) await readFile(crashes, name, `crash-${index + 1}`, "crash-report", false);
        if (await backupDirectoryIdentity(crashes) !== crashIdentity) throw unsafe();
      }
      if (await backupDirectoryIdentity(root) !== expectedRootIdentity) throw unsafe();
      const finalProperties = await new PropertiesReader().snapshot(serverId, root);
      if (finalProperties.rootIdentity !== expectedRootIdentity || finalProperties.checksum !== properties.checksum) throw unsafe();
      const analysis = analyzeCrashEvidence(inputs, secrets);
      const partial = incomplete || analysis.incomplete;
      return { ...analysis, incomplete: partial,
        conclusion: analysis.findings.length === 0 && partial ? "insufficient-evidence" as const : analysis.conclusion,
        sources: inputs.map(({ id, source, truncated }) => ({ id, source, truncated })),
        limitations: ["bounded-local-evidence" as const, "possible-not-certain" as const, "excerpt-line-not-file-line" as const, "no-automatic-repair" as const] };
    } catch { throw unsafe(); }
  }
}
