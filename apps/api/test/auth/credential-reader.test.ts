import { mkdtemp, mkdir, writeFile, rm, link, rename } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { CredentialReader } from "../../src/auth/credential-reader.js";
import { WindowsPrivateAclVerifier, validatePrivateAcl } from "../../src/auth/windows-private-acl.js";
import { SCRYPT_PROFILE } from "../../src/auth/password.js";

const sid = "S-1-5-21-1-2-3-1001";
const snapshot = () => ({ userSid: sid, ownerSid: sid, protected: true,
  aces: [{ sid, kind: "allow", mask: 0x1f01ff, flags: 0 }] });
const record = () => ({ version: 1, username: "admin", revision: "12345678-1234-4234-8234-123456789abc",
  salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE });
const unsafe = { code: "AUTH_PRIVATE_UNSAFE" };

describe("private ACL fail-closed boundary", () => {
  it("accepts only protected current-user ownership/full rights and freezes SID", async () => {
    expect(validatePrivateAcl(snapshot())).toBe(sid);
    let current = snapshot(); const verifier = new WindowsPrivateAclVerifier(async () => current);
    expect(await verifier.verify("unused")).toHaveLength(64);
    current = { ...current, userSid: "S-1-5-21-1-2-3-1002", ownerSid: "S-1-5-21-1-2-3-1002" };
    await expect(verifier.verify("unused")).rejects.toMatchObject(unsafe);
  });
  it.each([
    { protected: false }, { ownerSid: "S-1-5-18" }, { aces: [] },
    { aces: [{ sid: "S-1-1-0", kind: "allow", mask: 1, flags: 0 }] },
    { aces: [{ sid, kind: "deny", mask: 1, flags: 0 }] },
    { aces: [{ sid, kind: "allow", mask: 1, flags: 0 }] },
    { aces: [{ sid, kind: "allow", mask: 0x1f01ff, flags: 16 }] },
    { aces: [{ sid, kind: "allow", mask: 0x1f01ff, flags: 4294967296 }] },
    { aces: [{ sid, kind: "callback", mask: 0x1f01ff, flags: 0 }] }
  ])("rejects unsafe or ambiguous snapshot %j", (change) => {
    expect(() => validatePrivateAcl({ ...snapshot(), ...change })).toThrow("AUTH_PRIVATE_UNSAFE");
  });
  it("sanitizes inspector failure without leaking private path", async () => {
    const verifier = new WindowsPrivateAclVerifier(async () => { throw new Error("secret-path"); });
    await expect(verifier.verify("private-path")).rejects.toThrow("AUTH_PRIVATE_UNSAFE");
  });
  it("keeps bounded batch results in path order, validates every snapshot and refuses duplicate paths", async () => {
    const calls: string[] = [];
    const verifier = new WindowsPrivateAclVerifier(async (file) => {
      calls.push(file); const value = snapshot();
      if (file === "file") value.aces.push({ sid: "S-1-5-18", kind: "allow", mask: 0x1f01ff, flags: 0 });
      return value;
    });
    const hashes = await verifier.verifyMany(["directory", "file"]);
    expect(calls).toEqual(["directory", "file"]); expect(hashes).toHaveLength(2); expect(hashes[0]).not.toBe(hashes[1]);
    await expect(verifier.verifyMany(["file", "file"])).rejects.toMatchObject(unsafe);
    await expect(verifier.verifyMany(Array.from({ length: 9 }, (_, index) => String(index)))).rejects.toMatchObject(unsafe);
    await expect(new WindowsPrivateAclVerifier(async (file) => file === "directory" ? snapshot() : undefined).verifyMany(["directory", "file"])).rejects.toMatchObject(unsafe);
  });
  it("compares actual descriptor values without relying on JSON key order", async () => {
    let reorder = false;
    const verifier = new WindowsPrivateAclVerifier(async () => reorder ? { aces: snapshot().aces, protected: true, ownerSid: sid, userSid: sid } : snapshot());
    const initial = await verifier.verify("file"); reorder = true;
    expect(await verifier.verify("file")).toBe(initial);
  });
});

describe("bounded read-only credentials", () => {
  async function fixture(run: (root: string, file: string) => Promise<void>) {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcsm-auth-reader-"));
    try {
      await mkdir(path.join(root, "auth")); const file = path.join(root, "auth", "credential.json");
      await writeFile(file, JSON.stringify(record())); await run(root, file);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
  const acl = () => new WindowsPrivateAclVerifier(async () => snapshot());
  it("reads approved private record without writing bytes", async () => {
    await fixture(async (root) => {
      const reader = await CredentialReader.open(root, acl());
      expect(await reader.read()).toEqual(record());
      expect(JSON.stringify(reader)).toBe("{}");
    });
  });
  it.each(["oversized", "invalid-json", "invalid-utf8", "unknown-profile", "hardlink"])("rejects %s", async (kind) => {
    await fixture(async (root, file) => {
      const reader = await CredentialReader.open(root, acl());
      if (kind === "oversized") await writeFile(file, "x".repeat(4097));
      if (kind === "invalid-json") await writeFile(file, "not-json");
      if (kind === "invalid-utf8") await writeFile(file, Buffer.from([0xff]));
      if (kind === "unknown-profile") await writeFile(file, JSON.stringify({ ...record(), version: 2 }));
      if (kind === "hardlink") await link(file, path.join(root, "alias"));
      await expect(reader.read()).rejects.toMatchObject(unsafe);
    });
  });
  it("rejects replaced auth directory and retains both directories", async () => {
    await fixture(async (root) => {
      const reader = await CredentialReader.open(root, acl());
      await rename(path.join(root, "auth"), path.join(root, "old-auth"));
      await mkdir(path.join(root, "auth"));
      await writeFile(path.join(root, "auth", "credential.json"), JSON.stringify(record()));
      await expect(reader.read()).rejects.toMatchObject(unsafe);
    });
  });
  it("rejects ACL drift during a read", async () => {
    await fixture(async (root) => {
      let count = 0;
      const verifier = new WindowsPrivateAclVerifier(async () => {
        count++;
        return { ...snapshot(), aces: [{ ...snapshot().aces[0]!, flags: count >= 4 ? 1 : 0 }] };
      });
      const reader = await CredentialReader.open(root, verifier);
      await expect(reader.read()).rejects.toMatchObject(unsafe);
    });
  });
});
