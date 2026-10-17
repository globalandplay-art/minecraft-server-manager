import { expect, it, vi } from "vitest";
import { PRIVATE_PUBLICATION_NATIVE } from "../src/auth/private-publication-scripts.js";
import { nativePathData } from "../src/auth/windows-native.js";
import { WindowsPrivateAclVerifier } from "../src/auth/windows-private-acl.js";
import { wrapWithNativeOwnerRetention } from "../src/auth/windows-owner-retention.js";
import { buildWhitelistGuardGroup, buildWhitelistGuardWideGroup, verifyWhitelistGuardGroupResult, whitelistGuardGroupCommandBound,
  WHITELIST_GUARD_GROUP_OUTPUT_BOUND, WHITELIST_GUARD_WIDE_GROUP_OUTPUT_BOUND } from "../src/services/whitelist-guard-group-scripts.js";

const root = "C:\\isolated-group-fixture", id = "12345678-1234-4234-8234-123456789abc";
const executable = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const user = "S-1-5-21-1-2-3-1001";
const snapshot = (userSid = user) => ({ userSid, ownerSid: userSid, protected: true,
  aces: [userSid, "S-1-5-18", "S-1-5-32-544"].map((sid) => ({ sid, kind: "allow", mask: 0x1f01ff, flags: 0 })) });
const wrap = (script: string, managerRoot = root) => wrapWithNativeOwnerRetention(script, { root: managerRoot,
  nodePid: 2147483647, directoryHandle: "9".repeat(19), fileHandle: "9".repeat(19), processIdentity: "A".repeat(16),
  directoryIdentity: "B".repeat(40), fileIdentity: "C".repeat(40) });

it.each(["create", "move"] as const)("constructs one immutable backend chunk group (%s), excluding manifest and caller paths", (kind) => {
  const input = [56, 57, 58, 59, 60, 61, 62, 63], plan = buildWhitelistGuardGroup(root, id, input, kind);
  input[0] = 0;
  expect(Object.isFrozen(plan)).toBe(true); expect(Object.isFrozen(plan.indices)).toBe(true); expect(plan.indices[0]).toBe(56);
  expect(plan.script.split(PRIVATE_PUBLICATION_NATIVE)).toHaveLength(2);
  expect(plan.script).toContain(nativePathData(`${root}\\whitelist-guards\\${id}`));
  expect(plan.script).not.toContain(root); expect(plan.script).not.toContain("manifest.json");
  expect(plan.script).not.toMatch(/Remove-Item|Copy-Item|Start-Process|Invoke-Expression|Publish\(\$stage/u);
  expect(plan.script).toContain(kind === "create" ? "[AuthPrivateNative]::Create($stage,$false)" : "[AuthPrivateNative]::PublishNew($stage,$target)");
  expect(plan.script.indexOf("foreach($index in $indices)")).toBeGreaterThan(plan.script.indexOf("Add-Type"));
});
it.each([
  { root: "\\\\host\\share" }, { root: "C:\\root\\..\\other" }, { root: "C:\\root\\name " },
  { root: "C:\\root:stream" }, { root: "C:\\root\\bad\0" }, { root: "C:/root" },
  { root: "C:\\" + "x".repeat(4096) }, { operationId: "../manifest.json" },
  { indices: [] }, { indices: Array.from({ length: 9 }, (_, i) => i) }, { indices: [0, 0] },
  { indices: [0, 2] }, { indices: [64] }, { indices: [-1] }, { indices: [0.5] }, { indices: [NaN] }
])("refuses malformed group input without native execution: %j", (change) => {
  expect(() => buildWhitelistGuardGroup(change.root ?? root, change.operationId ?? id, change.indices ?? [0], "create"))
    .toThrow("WHITELIST_GUARD_GROUP_UNSAFE");
});
it("encodes malicious-looking but valid data without placing executable text in the script", () => {
  const input = "C:\\fixture';throw 'INJECTED';#";
  const plan = buildWhitelistGuardGroup(input, id, [0], "create");
  expect(plan.script).not.toContain("INJECTED"); expect(plan.script).toContain(nativePathData(`${input}\\whitelist-guards\\${id}`));
});
it("requires complete ordered creation receipts before any SID-pinned verifier call", () => {
  const plan = buildWhitelistGuardGroup(root, id, [0, 1], "create"), acl = new WindowsPrivateAclVerifier();
  const verify = vi.fn((value: unknown) => acl.verifyNativeSnapshot(value));
  const receipts = { ok: true, entries: [0, 1].map((index) => ({ index, snapshot: snapshot() })) };
  const hashes = verifyWhitelistGuardGroupResult(plan, receipts, verify);
  expect(hashes).toHaveLength(2); expect(hashes[0]).toBe(hashes[1]); expect(Object.isFrozen(hashes)).toBe(true);
  expect(verify).toHaveBeenCalledTimes(2);
});
it.each(["partial", "duplicate", "order", "extra", "entry-extra", "unsafe-acl", "excess-ace", "sid-too-long", "mask", "flags"])("rejects the whole creation receipt for %s before a verifier call", (failure) => {
  const plan = buildWhitelistGuardGroup(root, id, [0, 1], "create"), verify = vi.fn(() => "a".repeat(64));
  const value = { ok: true, entries: [0, 1].map((index) => ({ index, snapshot: snapshot() })) };
  if (failure === "partial") value.entries.pop();
  if (failure === "duplicate") value.entries[1]!.index = 0;
  if (failure === "order") value.entries.reverse();
  if (failure === "extra") Object.assign(value, { debug: "private" });
  if (failure === "entry-extra") Object.assign(value.entries[1]!, { path: "private" });
  if (failure === "unsafe-acl") value.entries[1]!.snapshot.protected = false;
  if (failure === "excess-ace") value.entries[1]!.snapshot.aces.push({ ...value.entries[1]!.snapshot.aces[0]! });
  if (failure === "sid-too-long") value.entries[1]!.snapshot = snapshot("S-1-5-" + "9".repeat(179));
  if (failure === "mask") value.entries[1]!.snapshot.aces[0]!.mask = 1;
  if (failure === "flags") value.entries[1]!.snapshot.aces[0]!.flags = 3;
  expect(() => verifyWhitelistGuardGroupResult(plan, value, verify)).toThrow("WHITELIST_GUARD_GROUP_UNSAFE");
  expect(verify).not.toHaveBeenCalled();
});
it("pins SID across all group receipts and sanitizes verifier errors", () => {
  const plan = buildWhitelistGuardGroup(root, id, [0, 1], "create"), acl = new WindowsPrivateAclVerifier();
  expect(() => verifyWhitelistGuardGroupResult(plan, { ok: true, entries: [
    { index: 0, snapshot: snapshot() }, { index: 1, snapshot: snapshot("S-1-5-21-4-5-6-1001") }
  ] }, (value) => acl.verifyNativeSnapshot(value))).toThrow("WHITELIST_GUARD_GROUP_UNSAFE");
});
it("does not truncate or omit complete worst-sized creation snapshots", () => {
  const indices = Array.from({ length: 8 }, (_, i) => i), plan = buildWhitelistGuardGroup(root, id, indices, "create");
  const longest = "S-1-5-" + "9".repeat(178); expect(longest).toHaveLength(184);
  expect(Buffer.byteLength(JSON.stringify(snapshot(longest)))).toBeLessThan(1024);
  const value = { ok: true, entries: indices.map((index) => ({ index, snapshot: snapshot(longest) })) };
  expect(Buffer.byteLength(JSON.stringify(value)) + 5).toBeLessThanOrEqual(WHITELIST_GUARD_GROUP_OUTPUT_BOUND);
  expect(WHITELIST_GUARD_GROUP_OUTPUT_BOUND).toBeLessThan(16384);
  const acl = new WindowsPrivateAclVerifier(); expect(verifyWhitelistGuardGroupResult(plan, value, (s) => acl.verifyNativeSnapshot(s))).toHaveLength(8);
});
it("accounts for all64 valid general ACL ACEs by REFUSING group creation drift, never filtering them", () => {
  const plan = buildWhitelistGuardGroup(root, id, [0], "create"), value = snapshot();
  while (value.aces.length < 64) value.aces.push({ ...value.aces[0]! });
  // General ACL standards remain unchanged; this narrower creator receipt is deliberately stricter.
  expect(() => new WindowsPrivateAclVerifier().verifyNativeSnapshot(value)).not.toThrow();
  expect(() => verifyWhitelistGuardGroupResult(plan, { ok: true, entries: [{ index: 0, snapshot: value }] }, () => "a".repeat(64)))
    .toThrow("WHITELIST_GUARD_GROUP_UNSAFE");
});
it.each(["missing", "extra", "snapshot"])("requires exact complete no-replace move receipts: %s", (mode) => {
  const plan = buildWhitelistGuardGroup(root, id, [0, 1], "move"), verify = vi.fn(() => "a".repeat(64));
  const value = { ok: true, entries: [{ index: 0 }, { index: 1 }] };
  if (mode === "missing") value.entries.pop(); if (mode === "extra") value.entries.push({ index: 2 });
  if (mode === "snapshot") Object.assign(value.entries[0]!, { snapshot: snapshot() });
  expect(() => verifyWhitelistGuardGroupResult(plan, value, verify)).toThrow("WHITELIST_GUARD_GROUP_UNSAFE"); expect(verify).not.toHaveBeenCalled();
});
it("accepts complete move receipts without treating them as byte/identity verification", () => {
  const plan = buildWhitelistGuardGroup(root, id, [0, 1], "move"), verify = vi.fn(() => "a".repeat(64));
  expect(verifyWhitelistGuardGroupResult(plan, { ok: true, entries: [{ index: 0 }, { index: 1 }] }, verify)).toEqual([]);
  expect(verify).not.toHaveBeenCalled();
  expect(() => verifyWhitelistGuardGroupResult({ ...plan }, { ok: true, entries: [{ index: 0 }, { index: 1 }] }, verify))
    .toThrow("WHITELIST_GUARD_GROUP_UNSAFE");
});
it.each(["create", "move"] as const)("bounds the full owner-wrapped %s command including executable/flags/NUL", (kind) => {
  const plan = buildWhitelistGuardGroup(root, id, Array.from({ length: 8 }, (_, i) => i), kind), script = wrap(plan.script);
  const bound = whitelistGuardGroupCommandBound(script, executable);
  const actualSimple = executable.length + 2 + " -NoLogo -NoProfile -NonInteractive -EncodedCommand ".length + Buffer.from(script, "utf16le").toString("base64").length + 1;
  expect(bound).toBeGreaterThanOrEqual(actualSimple); expect(bound).toBeLessThanOrEqual(32767);
});
it("rejects overlong wrapped commands before any caller may spawn; group size is not reduced/retried", () => {
  const managerRoot = "C:\\" + "中".repeat(1000), plan = buildWhitelistGuardGroup(managerRoot, id, [0], "create");
  expect(() => whitelistGuardGroupCommandBound(wrap(plan.script, managerRoot), executable)).toThrow("WHITELIST_GUARD_GROUP_UNSAFE");
  expect(plan.indices).toEqual([0]);
  expect(() => whitelistGuardGroupCommandBound("x", "x\0y")).toThrow("WHITELIST_GUARD_GROUP_UNSAFE");
});
it.each([9, 12, 16])("bounds all complete wide%d creation snapshots without changing the original eight-item contract", (count) => {
  const indices = Array.from({ length: count }, (_, i) => 64 - count + i);
  expect(() => buildWhitelistGuardGroup(root, id, indices, "create")).toThrow("WHITELIST_GUARD_GROUP_UNSAFE");
  const plan = buildWhitelistGuardWideGroup(root, id, indices, "create"), longest = "S-1-5-" + "9".repeat(178);
  const result = { ok: true, entries: indices.map((index) => ({ index, snapshot: snapshot(longest) })) };
  const bytes = Buffer.byteLength(JSON.stringify(result)) + 5;
  expect(bytes).toBeLessThanOrEqual(WHITELIST_GUARD_WIDE_GROUP_OUTPUT_BOUND); expect(WHITELIST_GUARD_WIDE_GROUP_OUTPUT_BOUND).toBeLessThan(16384);
  if (count === 16) expect(bytes).toBe(12892);
  const acl = new WindowsPrivateAclVerifier(); expect(verifyWhitelistGuardGroupResult(plan, result, (s) => acl.verifyNativeSnapshot(s))).toHaveLength(count);
  expect(whitelistGuardGroupCommandBound(wrap(plan.script), executable)).toBeLessThanOrEqual(32767);
});
it("rejects wide17 and index overflow without reducing or retrying the group", () => {
  expect(() => buildWhitelistGuardWideGroup(root, id, Array.from({ length: 17 }, (_, i) => i), "create")).toThrow("WHITELIST_GUARD_GROUP_UNSAFE");
  expect(() => buildWhitelistGuardWideGroup(root, id, [63, 64], "move")).toThrow("WHITELIST_GUARD_GROUP_UNSAFE");
});
