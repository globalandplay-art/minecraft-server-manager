import { expect, it } from "vitest";
import { GuardGroupRetentionFrames, pausedGuardCreateGroup } from "./fixtures/whitelist-group-retention.js";

const root = "C:\\isolated-fixture", guard = "12345678-1234-4234-8234-123456789abc";
const paused = Buffer.from('{"phase":"paused-after-first-create"}\r\n');
const final = Buffer.from(JSON.stringify({ ok: true, entries: Array.from({ length: 8 }, (_, index) => ({ index, snapshot: {} })) }) + "\r\n");
it("places a single controlled pause after a full first Create receipt in the original finite loop", () => {
  const { plan, script } = pausedGuardCreateGroup(root, guard);
  expect(plan.indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(script.split('WriteLine(\'{"phase":"paused-after-first-create"}\')')).toHaveLength(2);
  expect(script.indexOf("$receipts+=@{index=$index;snapshot=$snapshot}")).toBeLessThan(script.indexOf("if($index -eq 0)"));
  expect(script).toContain("Read-GroupRelease"); expect(script).toContain("12000");
  expect(script).not.toMatch(/Remove-Item|Copy-Item|Move-Item|Set-Acl/u);
});
it("accepts split strict frames but never reports a private receipt before completion", () => {
  const f = new GuardGroupRetentionFrames(); f.push(paused.subarray(0, 3)); expect(f.phase).toBe(0);
  f.push(paused.subarray(3)); expect(f.phase).toBe(1); expect(f.result).toBeUndefined();
  for (const byte of final) f.push(Buffer.from([byte])); f.finish();
  expect(f.fault).toBe(false); expect(f.phase).toBe(2); expect(f.result).toMatchObject({ ok: true });
});
it.each(["duplicate-pause", "out-of-order", "extra-key", "missing-row", "invalid-utf8", "extra-final", "tail", "overflow"])("rejects %s without a usable result", (mode) => {
  const f = new GuardGroupRetentionFrames();
  if (mode === "out-of-order") f.push(final); else f.push(paused);
  if (mode === "duplicate-pause") f.push(paused);
  if (mode === "extra-key") f.push(Buffer.from('{"ok":true,"entries":[],"debug":"private"}\n'));
  if (mode === "missing-row") f.push(Buffer.from('{"ok":true,"entries":[]}\n'));
  if (mode === "invalid-utf8") f.push(Buffer.from([0xc3, 0x28, 10]));
  if (mode === "extra-final") { f.push(final); f.push(final); }
  if (mode === "tail") { f.push(final); f.push(Buffer.from("x")); }
  if (mode === "overflow") f.push(Buffer.alloc(16384));
  f.finish(); expect(f.fault).toBe(true); expect(f.result).toBeUndefined();
});
