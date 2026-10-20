import { expect, it } from "vitest";
import { buildWhitelistHistorySeed } from "./fixtures/whitelist-history-seed.js";
import { PRIVATE_PUBLICATION_NATIVE } from "../src/auth/private-publication-scripts.js";
import { whitelistGuardGroupCommandBound } from "../src/services/whitelist-guard-group-scripts.js";
import { wrapWithNativeOwnerRetention } from "../src/auth/windows-owner-retention.js";
import { runWindowsNativeScript } from "../src/auth/windows-native.js";

const root = "C:\\isolated\\mcsm-history-open-12345678-1234-4234-8234-123456789abc\\manager";
const ids = Array.from({ length: 32 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
it("bounds original native setup to32 UUIDs/96 empty entries and keeps ACK separate from ACL evidence", () => {
  const plan = buildWhitelistHistorySeed(root, ids);
  expect(Object.isFrozen(plan)).toBe(true); expect(plan.entries).toBe(96);
  expect(plan.script).toContain(PRIVATE_PUBLICATION_NATIVE);
  const action = plan.script.slice(plan.script.indexOf("$namespace="));
  expect(action).not.toMatch(/Publish|Remove|Set-Acl|WriteAll|Start-Process|snapshot/u);
  expect(action.match(/\[AuthPrivateNative\]::Create/gu)).toHaveLength(3);
  const frozen = plan.script; ids[0] = "changed";
  expect(plan.script).toBe(frozen);
});
it("uses one original namespace Create without allowing arbitrary paths", () => {
  const plan = buildWhitelistHistorySeed(root, null);
  expect(plan.entries).toBe(1); expect(plan.script).toContain("[AuthPrivateNative]::Create($namespace,$true)");
});
it.each([[], Array(33).fill("00000000-0000-4000-8000-000000000000"), ["../../user"], ["0"], ["00000000-0000-4000-8000-000000000000", "00000000-0000-4000-8000-000000000000"]].map((values) => ({ values })))("rejects invalid or duplicate seed IDs", ({ values }) => {
  expect(() => buildWhitelistHistorySeed(root, values)).toThrow("HISTORY_SEED_INPUT_UNSAFE");
});
it.each(["C:\\user\\manager", root + "\\..", root + ":stream", root.replace("C:", "\\\\host\\share"), root.replace("manager", "world"), root.replace("isolated", "trailing.")])("rejects unsafe seed root%s", (value) => {
  expect(() => buildWhitelistHistorySeed(value, null)).toThrow("HISTORY_SEED_INPUT_UNSAFE");
});
it("requires a complete wrapped command to fit existing Windows limit; never truncates", () => {
  const plan = buildWhitelistHistorySeed(root, Array.from({ length: 32 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`));
  const proof = { root, nodePid: 123, processIdentity: "0".repeat(16), directoryHandle: "12", fileHandle: "16",
    directoryIdentity: "0".repeat(40), fileIdentity: "1".repeat(40) };
  const wrapped = wrapWithNativeOwnerRetention(plan.script, proof);
  expect(whitelistGuardGroupCommandBound(wrapped, "C:\\Windows\\powershell.exe")).toBeLessThanOrEqual(32767);
  expect(() => whitelistGuardGroupCommandBound("x".repeat(20000) + wrapped, "C:\\Windows\\powershell.exe")).toThrow();
});
it("rejects sparse arrays and validates the single captured value of accessor-backed input", () => {
  expect(() => buildWhitelistHistorySeed(root, Array<string>(1))).toThrow("HISTORY_SEED_INPUT_UNSAFE");
  let reads = 0;
  const values = ["00000000-0000-4000-8000-000000000000"];
  Object.defineProperty(values, 0, { get: () => ++reads === 1 ? "../../user" : "00000000-0000-4000-8000-000000000000" });
  expect(() => buildWhitelistHistorySeed(root, values)).toThrow("HISTORY_SEED_INPUT_UNSAFE");
  expect(reads).toBe(1);
});
it.skipIf(process.platform !== "win32")("evaluates the exact fixed32-ID decode statement in native PowerShell without any filesystem action", async () => {
  const values = Array.from({ length: 32 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
  const plan = buildWhitelistHistorySeed(root, values), line = plan.script.split(/\r?\n/u).find((row) => row.startsWith("$ids="));
  expect(line).toBeDefined(); expect(line).toMatch(/^\$ids=ConvertFrom-Json -InputObject \(/u);
  const result = await runWindowsNativeScript(`$ErrorActionPreference='Stop'\n$ProgressPreference='SilentlyContinue'\n${line}\n@{count=@($ids).Count;ids=@($ids)} | ConvertTo-Json -Compress`);
  expect(result).toEqual({ count: 32, ids: values });
});
