import { link, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { backupDirectoryIdentity } from "../src/services/backup-identity.js";
import { CrashEvidenceReader } from "../src/services/crash-evidence-reader.js";
import { PropertiesReader } from "../src/services/properties-reader.js";

async function fixture(action: (root: string, parent: string, identity: string) => Promise<void>) {
  const parent = await mkdtemp(join(tmpdir(), "mcsm-crash-")); const root = join(parent, "server");
  try {
    await mkdir(root); await writeFile(join(root, "server.properties"), "rcon.password=private-rcon-secret\n");
    await action(root, parent, await backupDirectoryIdentity(root));
  } finally { await rm(parent, { recursive: true, force: true }); }
}
describe("registered fixed crash evidence paths", () => {
  it("reads a healthy empty instance without inventing a crash", async () => fixture(async (root, _parent, identity) => {
    expect(await new CrashEvidenceReader().read("server", root, identity)).toMatchObject({ sources: [], findings: [], conclusion: "no-rule-match" });
  }));
  it("reads fixed log and crash reports, redacts properties secrets and never returns filenames/paths", async () => fixture(async (root, _parent, identity) => {
    await mkdir(join(root, "logs")); await mkdir(join(root, "crash-reports"));
    await writeFile(join(root, "logs", "latest.log"), "OutOfMemoryError private-rcon-secret\n");
    await writeFile(join(root, "crash-reports", "crash-2026-10-08_01.02.03-server.txt"), "UnsupportedClassVersionError /private/server.jar\n");
    const result = await new CrashEvidenceReader().read("server", root, identity);
    expect(result.findings).toHaveLength(2); expect(result.sources).toHaveLength(2);
    const output = JSON.stringify(result);
    for (const value of [root, "private-rcon-secret", "server.jar", "01.02.03"]) expect(output).not.toContain(value);
  }));
  it("rejects a replaced registered root", async () => fixture(async (root, parent, identity) => {
    await rename(root, join(parent, "old")); await mkdir(root);
    await expect(new CrashEvidenceReader().read("server", root, identity)).rejects.toMatchObject({ code: "CRASH_EVIDENCE_UNSAFE" });
  }));
  it("rejects a junction log directory rather than reading outside the root", async () => fixture(async (root, parent, identity) => {
    const outside = join(parent, "outside"); await mkdir(outside);
    await writeFile(join(outside, "latest.log"), "OutOfMemoryError outside-secret");
    await symlink(outside, join(root, "logs"), "junction");
    await expect(new CrashEvidenceReader().read("server", root, identity)).rejects.toMatchObject({ code: "CRASH_EVIDENCE_UNSAFE" });
  }));
  it("rejects hardlinked evidence", async () => fixture(async (root, parent, identity) => {
    await mkdir(join(root, "logs")); await writeFile(join(parent, "secret.txt"), "OutOfMemoryError");
    await link(join(parent, "secret.txt"), join(root, "logs", "latest.log"));
    await expect(new CrashEvidenceReader().read("server", root, identity)).rejects.toMatchObject({ code: "CRASH_EVIDENCE_UNSAFE" });
  }));
  it("bounds report count and marks invalid UTF8 as incomplete", async () => fixture(async (root, _parent, identity) => {
    await mkdir(join(root, "crash-reports")); await mkdir(join(root, "logs"));
    await writeFile(join(root, "logs", "latest.log"), Buffer.from([0xff]));
    for (let n = 0; n < 5; n++) await writeFile(join(root, "crash-reports", `crash-2026-10-08_01.02.0${n}-server.txt`), "OutOfMemoryError");
    const result = await new CrashEvidenceReader().read("server", root, identity);
    expect(result.incomplete).toBe(true); expect(result.sources).toHaveLength(3);
    expect(result.findings[0]?.evidence).toHaveLength(2);
  }));
  it("never exposes a secret prefix from the truncated final crash-report line", async () => fixture(async (root, _parent, identity) => {
    await mkdir(join(root, "crash-reports"));
    const prefix = "OutOfMemoryError private-rcon-";
    const padding = "x".repeat(65536 - Buffer.byteLength(prefix) - 1) + "\n";
    await writeFile(join(root, "crash-reports", "crash-2026-10-08_01.02.03-server.txt"), padding + prefix + "secret\n");
    const result = await new CrashEvidenceReader().read("server", root, identity);
    expect(result.incomplete).toBe(true); expect(result.findings).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("private-rcon-");
  }));
  it("rejects a final properties snapshot with equal bytes but a different root identity", async () => fixture(async (root, _parent, identity) => {
    const original = PropertiesReader.prototype.snapshot; let calls = 0;
    const spy = vi.spyOn(PropertiesReader.prototype, "snapshot").mockImplementation(async function(this: PropertiesReader, serverId, directory) {
      const snapshot = await original.call(this, serverId, directory);
      return { ...snapshot, rootIdentity: ++calls === 2 ? "replacement-root" : snapshot.rootIdentity };
    });
    try { await expect(new CrashEvidenceReader().read("server", root, identity)).rejects.toMatchObject({ code: "CRASH_EVIDENCE_UNSAFE" }); }
    finally { spy.mockRestore(); }
  }));
  it("suppresses multiline secret fragments across actual head and tail read boundaries", async () => fixture(async (root, _parent, identity) => {
    const first = "known-rcon-part-0123456789", second = "remaining-secret-part";
    await writeFile(join(root, "server.properties"), `rcon.password=${first}\\n${second}\n`);
    await mkdir(join(root, "crash-reports")); await mkdir(join(root, "logs"));
    const boundary = `OutOfMemoryError ${first}\nremaining-`;
    const padding = "x".repeat(65536 - Buffer.byteLength(boundary) - 1) + "\n";
    await writeFile(join(root, "crash-reports", "crash-2026-10-08_01.02.03-server.txt"), padding + boundary + "secret-part\n");
    await writeFile(join(root, "logs", "latest.log"), "x".repeat(65536) + `\n${second} OutOfMemoryError\n`);
    const result = await new CrashEvidenceReader().read("server", root, identity);
    expect(result.findings).toEqual([]); expect(result.conclusion).toBe("insufficient-evidence");
    expect(result.sources).toHaveLength(2); expect(result.sources.every((source) => source.truncated)).toBe(true);
    for (const value of [first, second, "remaining-"]) expect(JSON.stringify(result)).not.toContain(value);
  }));
});
