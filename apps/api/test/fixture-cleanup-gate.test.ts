import { expect, it, vi } from "vitest";
import { FixtureCleanupGate } from "./helpers/fixture-cleanup-gate.js";
it("retains a fixture while its body continues even if operations appear idle", async () => {
  const gate = new FixtureCleanupGate(); let release!: () => void;
  const body = gate.body(() => new Promise<void>((resolve) => { release = resolve; }));
  expect(await gate.closeAndWait(0)).toBe(false);
  const action = vi.fn(async () => {});
  await expect(gate.request(action)).rejects.toThrow("FIXTURE_CLOSING"); expect(action).not.toHaveBeenCalled();
  release(); await body; expect(await gate.closeAndWait(0)).toBe(true);
});
it("waits for owned pending work and active operation without affecting another gate", async () => {
  const gate = new FixtureCleanupGate(); const other = new FixtureCleanupGate();
  let release!: () => void; let idle = false; gate.setIdle(() => idle);
  const pending = gate.request(() => new Promise<void>((resolve) => { release = resolve; }));
  await gate.body(async () => {}); await other.body(async () => {});
  expect(await gate.closeAndWait(0)).toBe(false); expect(await other.closeAndWait(0)).toBe(true);
  release(); await pending; expect(await gate.closeAndWait(0)).toBe(false);
  idle = true; expect(await gate.closeAndWait(0)).toBe(true);
});
it("preserves the original body error and permits cleanup after settlement", async () => {
  const gate = new FixtureCleanupGate(); const error = new Error("original-test-failure");
  await expect(gate.body(async () => { throw error; })).rejects.toBe(error);
  expect(await gate.closeAndWait(0)).toBe(true);
});
