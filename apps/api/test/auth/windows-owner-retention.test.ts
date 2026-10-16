import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ManagerLifetimeLock } from "../../src/auth/manager-lifetime-lock.js";
import { wrapWithNativeOwnerRetention, type NativeOwnerRetentionProof } from "../../src/auth/windows-owner-retention.js";

const native = vi.hoisted(() => vi.fn());
vi.mock("../../src/auth/windows-native.js", async (original) => ({
  ...await original<typeof import("../../src/auth/windows-native.js")>(), runWindowsNativeScript: native
}));
const proof: NativeOwnerRetentionProof = { root: "C:\\isolated-fixture", nodePid: 123,
  directoryHandle: "100", fileHandle: "104", directoryIdentity: "A".repeat(40), fileIdentity: "B".repeat(40), processIdentity: "C".repeat(16) };
const roots: string[] = [];
afterEach(async () => { native.mockReset(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function ownerFixture() {
  const root = await mkdtemp(join(tmpdir(), "mcsm-retention-policy-")); roots.push(root);
  native.mockResolvedValueOnce({ identity: proof.processIdentity }).mockResolvedValueOnce({
    handles: `${proof.directoryHandle},${proof.fileHandle},${proof.directoryIdentity},${proof.fileIdentity},${proof.processIdentity}`
  }).mockResolvedValue({ released: true });
  return { root, owner: await ManagerLifetimeLock.acquire(root) };
}

it("places native duplication and full validation before the fixed inspector, without reopening or remote-closing handles", () => {
  const script = wrapWithNativeOwnerRetention("# FIXED_TEST_INSPECTOR", proof);
  expect(script.indexOf("[WhitelistOwnerRetention]::Retain(")).toBeLessThan(script.indexOf("# FIXED_TEST_INSPECTOR"));
  expect(script).toContain("OpenProcess(0x101040,false,pid)");
  expect(script).toContain("ProcessIdentity(process)==processIdentity");
  expect(script).toContain("DuplicateHandle(process,new IntPtr(file),GetCurrentProcess(),out localFile,0,false,2)");
  expect(script).toContain("if(!retained) { CloseLocal(localFile); CloseLocal(localDirectory); }");
  expect(script).not.toMatch(/CreateFile|TerminateProcess|JobObject|DUPLICATE_CLOSE_SOURCE|\.Dispose\(/u);
  expect(script).not.toContain(proof.root);
});
it.each([
  { nodePid: 0 }, { nodePid: Number.NaN }, { nodePid: 0x80000000 }, { fileHandle: "1);BAD" },
  { directoryHandle: "0" }, { processIdentity: "x" }, { directoryIdentity: "'" }, { fileIdentity: "x" }, { root: "x\0y" }
])("rejects malformed native proof with a fixed error", (patch) => {
  expect(() => wrapWithNativeOwnerRetention("# FIXED_TEST_INSPECTOR", { ...proof, ...patch })).toThrow("AUTH_PRIVATE_UNSAFE");
});
it.skipIf(process.platform !== "win32")("issues the opaque wrapper only under the exact live mutation lease", async () => {
  const { owner, root } = await ownerFixture();
  expect(JSON.stringify(owner)).toBe("{}");
  expect(() => owner.nativeAclChildWrapper(root)).toThrow("AUTH_PRIVATE_UNSAFE");
  const release = owner.beginOfflineMutation(root);
  expect(() => owner.nativeAclChildWrapper(join(root, "wrong"))).toThrow("AUTH_PRIVATE_UNSAFE");
  const wrap = owner.nativeAclChildWrapper(root);
  expect(JSON.stringify(wrap)).toBeUndefined(); expect(wrap("# FIXED_TEST_INSPECTOR")).toContain("WhitelistOwnerRetention");
  await expect(owner.release()).rejects.toMatchObject({ code: "AUTH_BUSY" });
  expect(() => owner.beginOfflineMutation(root)).toThrow("AUTH_BUSY");
  release(); expect(() => wrap("# FIXED_TEST_INSPECTOR")).toThrow("AUTH_PRIVATE_UNSAFE");
  const next = owner.beginOfflineMutation(root);
  expect(() => wrap("# FIXED_TEST_INSPECTOR")).toThrow("AUTH_PRIVATE_UNSAFE");
  const current = owner.nativeAclChildWrapper(root); expect(current("# FIXED_TEST_INSPECTOR")).toContain("WhitelistOwnerRetention");
  next(); await owner.release(); expect(() => current("# FIXED_TEST_INSPECTOR")).toThrow("AUTH_PRIVATE_UNSAFE");
  expect(() => owner.nativeAclChildWrapper(root)).toThrow("AUTH_PRIVATE_UNSAFE");
});
