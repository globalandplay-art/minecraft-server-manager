import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rm, link, rename, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { encodeAuditEvent, PrivateAuthAudit } from "../../src/auth/audit.js";
import { WindowsPrivateAclVerifier } from "../../src/auth/windows-private-acl.js";

const sid = "S-1-5-21-1-2-3-1001";
const snapshot = () => ({ userSid: sid, ownerSid: sid, protected: true, aces: [{ sid, kind: "allow", mask: 0x1f01ff, flags: 0 }] });
const event = () => ({ event: "login-success" as const, requestId: randomUUID() });
async function fixture(run: (root: string, directory: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-private-audit-")); const directory = path.join(root, "auth");
  try { await mkdir(directory); for (let i = 0; i < 3; i++) await writeFile(path.join(directory, `audit.${i}.jsonl`), ""); await run(root, directory); }
  finally { await rm(root, { recursive: true, force: true }); }
}
const acl = () => new WindowsPrivateAclVerifier(async () => snapshot());
describe("bounded private audit ring", () => {
  it("copies only approved event/UUID fields with timestamp/sequence and refuses raw command/path identifiers", () => {
    const encoded = encodeAuditEvent({ ...event(), secret: "password=top-secret" } as ReturnType<typeof event>);
    expect(encoded.length).toBeLessThanOrEqual(1024); expect(encoded.toString()).not.toContain("top-secret");
    expect(() => encodeAuditEvent({ event: "login-success", requestId: "/private-path" })).toThrow("AUTH_PRIVATE_UNSAFE");
    expect(() => encodeAuditEvent(event(), Number.MAX_SAFE_INTEGER + 1)).toThrow("AUTH_PRIVATE_UNSAFE");
  });
  it("serializes appends and resumes newest slot/counter after restart", async () => fixture(async (root, directory) => {
    await writeFile(path.join(directory, "audit.0.jsonl"), encodeAuditEvent(event(), 1));
    await writeFile(path.join(directory, "audit.1.jsonl"), encodeAuditEvent(event(), 20));
    let audit = await PrivateAuthAudit.open(root, acl());
    await Promise.all([audit.record(event()), audit.record(event())]); await audit.close();
    const lines = (await readFile(path.join(directory, "audit.1.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line).sequence);
    expect(lines).toEqual([20, 21, 22]);
    audit = await PrivateAuthAudit.open(root, acl()); await audit.record(event()); await audit.close();
    expect((await readFile(path.join(directory, "audit.1.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line).sequence)).toEqual([20, 21, 22, 23]);
  }));
  it("rotates by truncating the oldest next slot only after the 10MiB bound and retains exactly three slots", async () => fixture(async (root, directory) => {
    const chunks: Buffer[] = []; let length = 0; let sequence = 1;
    while (true) { const bytes = encodeAuditEvent(event(), sequence++); if (length + bytes.length > 10 * 1024 ** 2) break; chunks.push(bytes); length += bytes.length; }
    await writeFile(path.join(directory, "audit.2.jsonl"), Buffer.concat(chunks));
    await writeFile(path.join(directory, "audit.0.jsonl"), encodeAuditEvent(event(), 1));
    const audit = await PrivateAuthAudit.open(root, acl());
    try { await audit.record(event()); await audit.record(event()); }
    finally { await audit.close(); }
    expect((await stat(path.join(directory, "audit.2.jsonl"))).size).toBe(length);
    const rotated = (await readFile(path.join(directory, "audit.0.jsonl"), "utf8")).trim().split("\n");
    expect(rotated.length).toBe(2); expect(JSON.parse(rotated[0]!).sequence).toBe(sequence - 1);
  }));
  it.each(["hardlink", "replacement", "invalid-json", "oversized", "unsafe-acl"])("fails closed for %s at startup without deleting files", async (kind) => fixture(async (root, directory) => {
    const file = path.join(directory, "audit.0.jsonl");
    if (kind === "hardlink") await link(file, path.join(directory, "alias"));
    if (kind === "replacement") { await rename(file, path.join(directory, "prior")); await mkdir(file); }
    if (kind === "invalid-json") await writeFile(file, "private-secret\n");
    if (kind === "oversized") await writeFile(file, Buffer.alloc(10 * 1024 ** 2 + 1));
    const verifier = kind === "unsafe-acl" ? new WindowsPrivateAclVerifier(async () => ({ ...snapshot(), protected: false })) : acl();
    await expect(PrivateAuthAudit.open(root, verifier)).rejects.toMatchObject({ code: "AUTH_PRIVATE_UNSAFE" });
    expect(await stat(file)).toBeDefined();
  }));
  it("detects identity/ACL drift and becomes sticky unavailable without reopening or repairing", async () => fixture(async (root, directory) => {
    let unsafe = false; const verifier = new WindowsPrivateAclVerifier(async () => ({ ...snapshot(), protected: !unsafe }));
    const audit = await PrivateAuthAudit.open(root, verifier);
    try {
      unsafe = true; await expect(audit.record(event())).rejects.toMatchObject({ code: "AUTH_PRIVATE_UNSAFE" });
      expect(audit.ready()).toBe(false); unsafe = false;
      await expect(audit.record(event())).rejects.toMatchObject({ code: "AUTH_PRIVATE_UNSAFE" });
      expect((await stat(path.join(directory, "audit.0.jsonl"))).size).toBe(0);
    } finally { await audit.close(); }
  }));
  it("bounds pending queue at 64 and never silently discards failed events", async () => fixture(async (root) => {
    const audit = await PrivateAuthAudit.open(root, acl());
    const results = await Promise.allSettled(Array.from({ length: 65 }, () => audit.record(event())));
    expect(results.every((result) => result.status === "rejected")).toBe(true); expect(audit.ready()).toBe(false); await audit.close();
  }));
});
