import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { AuthCoreError, SCRYPT_PROFILE } from "../../src/auth/password.js";
import { HttpAuthentication } from "../../src/auth/http-auth.js";
const openReader = vi.hoisted(() => vi.fn());
const openAudit = vi.hoisted(() => vi.fn());
vi.mock("../../src/auth/credential-reader.js", () => ({ CredentialReader: { open: openReader } }));
vi.mock("../../src/auth/audit.js", () => ({ PrivateAuthAudit: { open: openAudit } }));
import { initializeHttpAuthentication } from "../../src/auth/bootstrap.js";
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-auth-bootstrap-"));
  try { await mkdir(path.join(root, "auth")); openReader.mockReset(); openAudit.mockReset(); await run(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}
describe("startup explicitly required auth profile", () => {
  it.each([undefined, "off"])("keeps no-credential legacy only for %s", async (setting) => fixture(async (root) => {
    expect(await initializeHttpAuthentication(root, setting)).toBeUndefined(); expect(openReader).not.toHaveBeenCalled(); expect(openAudit).not.toHaveBeenCalled();
  }));
  it.each([undefined, "off"])("credential present may never downgrade under %s", async (setting) => fixture(async (root) => {
    await writeFile(path.join(root, "auth", "credential.json"), "private bytes");
    await expect(initializeHttpAuthentication(root, setting)).rejects.toThrow("AUTH_HTTP_INTEGRATION_PENDING");
    expect(openReader).not.toHaveBeenCalled();
  }));
  it.each(["", "true", "remote", "REQUIRED"])("rejects unsupported profile %s before touching credentials", async (setting) => fixture(async (root) => {
    await expect(initializeHttpAuthentication(root, setting)).rejects.toThrow("AUTH_PROFILE_INVALID"); expect(openReader).not.toHaveBeenCalled();
  }));
  it.each(["credential.pending.json", "credential.staged.json"])("refuses interrupted publication %s even in required mode", async (file) => fixture(async (root) => {
    await writeFile(path.join(root, "auth", file), "private pending bytes");
    await expect(initializeHttpAuthentication(root, "required")).rejects.toThrow("AUTH_HTTP_INTEGRATION_PENDING"); expect(openReader).not.toHaveBeenCalled();
  }));
  it("missing/unsafe required credentials fail before audit/adapters/listener initialization", async () => fixture(async (root) => {
    openReader.mockRejectedValue(new AuthCoreError("AUTH_PRIVATE_UNSAFE"));
    await expect(initializeHttpAuthentication(root, "required")).rejects.toThrow("AUTH_PRIVATE_UNSAFE"); expect(openAudit).not.toHaveBeenCalled();
  }));
  it("fully verifies credential record and private audit before constructing required auth", async () => fixture(async (root) => {
    const read = vi.fn().mockResolvedValue({ version: 1, username: "admin", revision: randomUUID(), salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE });
    openReader.mockResolvedValue({ read }); openAudit.mockResolvedValue({ ready: () => true, record: async () => {}, close: async () => {} });
    const authentication = await initializeHttpAuthentication(root, "required");
    expect(authentication).toBeInstanceOf(HttpAuthentication); expect(read).toHaveBeenCalledTimes(1); expect(openReader).toHaveBeenCalledWith(root); expect(openAudit).toHaveBeenCalledWith(root);
    expect(JSON.stringify(authentication)).toBe("{}");
  }));
  it("unsafe/unavailable audit refuses required startup without falling back", async () => fixture(async (root) => {
    openReader.mockResolvedValue({ read: async () => ({ version: 1, username: "admin", revision: randomUUID(), salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }) });
    openAudit.mockRejectedValue(new AuthCoreError("AUTH_PRIVATE_UNSAFE"));
    await expect(initializeHttpAuthentication(root, "required")).rejects.toThrow("AUTH_PRIVATE_UNSAFE");
  }));
});
