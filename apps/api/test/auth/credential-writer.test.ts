import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CredentialReader } from "../../src/auth/credential-reader.js";
import { CredentialWriter } from "../../src/auth/credential-writer.js";
import { ManagerLifetimeLock } from "../../src/auth/manager-lifetime-lock.js";
import { PasswordVerifier } from "../../src/auth/password.js";
import { WindowsPrivateAclVerifier } from "../../src/auth/windows-private-acl.js";
import * as publication from "../../src/auth/private-publication.js";
import { addEveryoneReadForTest } from "./fixtures/native-acl-negative.js";

async function fixture(action: (root: string, lock: ManagerLifetimeLock) => Promise<void>) {
  const parent = await mkdtemp(join(tmpdir(), "mcsm-private-writer-")); const root = join(parent, "manager"); await mkdir(root);
  const lock = await ManagerLifetimeLock.acquire(root);
  try { await action(root, lock); }
  finally { vi.restoreAllMocks(); await lock.release(); await rm(parent, { recursive: true, force: true }); }
}
const PASSWORD = "test password with spaces ";
describe.skipIf(process.platform !== "win32")("native offline credential publication", () => {
  it("creates protected native ACL objects, publishes init and preserves exact verified reset backup", async () => fixture(async (root, lock) => {
    const writer = new CredentialWriter(root, lock); const initial = await writer.publish("init", "admin", PASSWORD);
    const reader = await CredentialReader.open(root); const first = await reader.read();
    expect(first.revision).toBe(initial.revision); expect(JSON.stringify(writer)).toBe("{}");
    expect(await new PasswordVerifier(first).verify("admin", PASSWORD)).toEqual(initial);
    const before = await readFile(join(root, "auth", "credential.json"));
    await expect(writer.publish("init", "admin", PASSWORD)).rejects.toMatchObject({ code: "AUTH_PRIVATE_UNSAFE" });
    await expect(writer.publish("reset", "admin", PASSWORD, "12345678-1234-4234-8234-123456789abc")).rejects.toMatchObject({ code: "AUTH_PRIVATE_UNSAFE" });
    const reset = await writer.publish("reset", "admin", PASSWORD + "new", initial.revision);
    expect(reset.revision).not.toBe(initial.revision);
    expect(await readFile(join(root, "auth", `credential.backup.${initial.revision}.json`))).toEqual(before);
    expect((await reader.read()).revision).toBe(reset.revision);
    const acl = new WindowsPrivateAclVerifier();
    for (const file of await readdir(join(root, "auth"))) expect(await acl.verify(join(root, "auth", file))).toMatch(/^[0-9a-f]{64}$/u);
    expect(await acl.verify(join(root, "auth"))).toMatch(/^[0-9a-f]{64}$/u);
    // Actual native broad Allow on a fresh synthetic fixture must fail despite a protected DACL.
    const file = join(root, "auth", "credential.json");
    await addEveryoneReadForTest(file);
    await expect(new WindowsPrivateAclVerifier().verify(file)).rejects.toMatchObject({ code: "AUTH_PRIVATE_UNSAFE" });
  }), 180_000);
  it.each(["before-publish", "after-publish"])("fails closed after %s interruption and explicit recovery verifies commit", async (point) => fixture(async (root, lock) => {
    const writer = new CredentialWriter(root, lock); const first = await writer.publish("init", "admin", PASSWORD);
    const original = publication.publishPrivateStage;
    vi.spyOn(publication, "publishPrivateStage").mockImplementationOnce(async (...args) => {
      if (point === "after-publish") await original(...args);
      throw new Error("injected-publication-interruption");
    });
    await expect(writer.publish("reset", "admin", PASSWORD + "new", first.revision)).rejects.toThrow("injected-publication-interruption");
    const reader = await CredentialReader.open(root);
    await expect(reader.read()).rejects.toMatchObject({ code: "AUTH_PRIVATE_UNSAFE" });
    expect(await readFile(join(root, "auth", `credential.backup.${first.revision}.json`))).toBeDefined();
    const result = await new CredentialWriter(root, lock).recover();
    expect(result.outcome).toBe("committed"); expect(result.revision).not.toBe(first.revision);
    expect((await reader.read()).revision).toBe(result.revision);
    await expect(readFile(join(root, "auth", "credential.pending.json"))).rejects.toMatchObject({ code: "ENOENT" });
  }), 180_000);
  it("blocks all in-process writer/recovery competitors sharing the owner lock", async () => fixture(async (root, lock) => {
    const first = new CredentialWriter(root, lock); const second = new CredentialWriter(root, lock);
    const pending = first.publish("init", "admin", PASSWORD);
    await expect(second.publish("init", "admin", PASSWORD)).rejects.toMatchObject({ code: "AUTH_BUSY" });
    await expect(second.recover()).rejects.toMatchObject({ code: "AUTH_BUSY" });
    await expect(lock.release()).rejects.toMatchObject({ code: "AUTH_BUSY" });
    await pending; expect((await (await CredentialReader.open(root)).read()).username).toBe("admin");
  }), 120_000);
  it("preserves exact prior credential when interruption follows the journal but no stage exists", async () => fixture(async (root, lock) => {
    const writer = new CredentialWriter(root, lock); const first = await writer.publish("init", "admin", PASSWORD);
    const originalBytes = await readFile(join(root, "auth", "credential.json"));
    const original = publication.writePrivateNew;
    vi.spyOn(publication, "writePrivateNew").mockImplementation(async (file, ...rest) => {
      if (file.endsWith("credential.staged.json")) throw new Error("injected-stage-absent");
      return original(file, ...rest);
    });
    await expect(writer.publish("reset", "admin", PASSWORD + "new", first.revision)).rejects.toThrow("injected-stage-absent");
    await expect((await CredentialReader.open(root)).read()).rejects.toMatchObject({ code: "AUTH_PRIVATE_UNSAFE" });
    expect(await writer.recover()).toEqual({ revision: first.revision, outcome: "prior-preserved" });
    expect(await readFile(join(root, "auth", "credential.json"))).toEqual(originalBytes);
    await expect(readFile(join(root, "auth", "credential.pending.json"))).rejects.toMatchObject({ code: "ENOENT" });
  }), 180_000);
  it("rejects inherited/unprotected ACLs and retains malformed journal failure evidence", async () => fixture(async (root, lock) => {
    await mkdir(join(root, "auth")); await writeFile(join(root, "auth", "credential.pending.json"), "{}");
    await expect(new WindowsPrivateAclVerifier().verify(join(root, "auth"))).rejects.toMatchObject({ code: "AUTH_PRIVATE_UNSAFE" });
    await expect(new CredentialWriter(root, lock).recover()).rejects.toMatchObject({ code: "AUTH_PRIVATE_UNSAFE" });
    expect(await readFile(join(root, "auth", "credential.pending.json"), "utf8")).toBe("{}");
  }), 60_000);
  it("configured credentials block legacy Manager startup before listening and release startup exclusion", async () => {
    const parent = await mkdtemp(join(tmpdir(), "mcsm-auth-main-")); const root = join(parent, "manager"); await mkdir(root);
    try {
      await mkdir(join(root, "auth")); await writeFile(join(root, "auth", "credential.pending.json"), "{}");
      const child = spawn(process.execPath, ["--import", "tsx", resolve("src/main.ts")], { windowsHide: true, env: { ...process.env, MCSM_MODE: "mock", MCSM_MANAGER_ROOT: root }, stdio: ["ignore", "pipe", "pipe"] });
      let output = ""; child.stderr.on("data", (value: Buffer) => { output += value.toString("utf8"); });
      expect((await once(child, "exit"))[0]).toBe(1); expect(output).toContain("AUTH_HTTP_INTEGRATION_PENDING"); expect(output).not.toContain(root);
      const lock = await ManagerLifetimeLock.acquire(root); await lock.release();
    } finally { await rm(parent, { recursive: true, force: true }); }
  }, 60_000);
});
