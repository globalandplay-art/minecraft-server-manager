import { expect, it, vi } from "vitest";
import { NativeTiming } from "./fixtures/whitelist-native-timing.js";

it("forwards exact argument and original Promise/result identities without awaiting dispatch", async () => {
  const timing = new NativeTiming(), argument = {}, result = {};
  const primitive = vi.fn((value: object) => { expect(value).toBe(argument); return Promise.resolve(result); });
  let original: Promise<object> | undefined;
  const observed = timing.invoke("write-new", () => { original = primitive(argument); return original; });
  expect(primitive).toHaveBeenCalledTimes(1); expect(observed).toBe(original); expect(await observed).toBe(result);
});
it("preserves the same rejected Promise and error; logs no error object", async () => {
  const timing = new NativeTiming(), secret = new Error("PRIVATE_SENTINEL"), original = Promise.reject(secret);
  const observed = timing.invoke("acl-one", () => original);
  expect(observed).toBe(original); await expect(observed).rejects.toBe(secret);
  expect(JSON.stringify(timing.snapshot())).not.toContain("PRIVATE_SENTINEL");
  expect(timing.snapshot().totals.find((row) => row.kind === "acl-one")).toMatchObject({ completed: 1, rejected: 1 });
});
it("preserves synchronous primitive throws", () => {
  const timing = new NativeTiming(), error = new Error("PRIVATE_SENTINEL");
  expect(() => timing.invoke("publish-new", () => { throw error; })).toThrow(error);
  expect(timing.snapshot().totals.find((row) => row.kind === "publish-new")?.rejected).toBe(1);
});
it("isolates failed clock observation from native invocation and outcome", async () => {
  const timing = new NativeTiming(() => { throw new Error("OBSERVER_FAILED"); }), original = Promise.resolve(42);
  expect(timing.invoke("acl-many", () => original)).toBe(original); expect(await original).toBe(42);
});
it("retains async parent association while labelling inclusive durations non-additive", async () => {
  let now = 0; const timing = new NativeTiming(() => now);
  await timing.invoke("write-new", async () => {
    now = 2; await Promise.resolve();
    await timing.invoke("acl-one", async () => { now = 7; }); now = 10;
  });
  const snapshot = timing.snapshot(); expect(snapshot.timeMeaning).toBe("inclusive-not-additive");
  expect(snapshot.recent.find((call) => call.id === 2)).toMatchObject({ parentId: 1, elapsedMs: 5 });
  expect(snapshot.recent.find((call) => call.id === 1)).toMatchObject({ parentId: null, elapsedMs: 10 });
});
it("does not serialize independent pending primitives", async () => {
  const timing = new NativeTiming(); let first!: () => void, second!: () => void;
  const one = new Promise<void>((resolve) => { first = resolve; }), two = new Promise<void>((resolve) => { second = resolve; });
  expect(timing.invoke("acl-one", () => one)).toBe(one); expect(timing.invoke("acl-many", () => two)).toBe(two);
  expect(timing.snapshot().active.map((call) => call.parentId)).toEqual([null, null]);
  second(); await two; expect(timing.snapshot().active).toHaveLength(1); first(); await one;
});
it("bounds retained calls and snapshot rows while continuing every primitive", async () => {
  const timing = new NativeTiming(); let calls = 0;
  for (let i = 0; i < 300; i++) await timing.invoke("acl-one", async () => { calls++; });
  const snapshot = timing.snapshot(); expect(calls).toBe(300); expect(snapshot.overflow).toBe(true);
  expect(snapshot.totals.find((row) => row.kind === "acl-one")?.calls).toBe(256); expect(snapshot.recent).toHaveLength(4);
});
it("never writes stdout/stderr", async () => {
  const out = vi.spyOn(process.stdout, "write"), error = vi.spyOn(process.stderr, "write");
  try { const timing = new NativeTiming(); await timing.invoke("create-directory", async () => {}); timing.snapshot();
    expect(out).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  } finally { out.mockRestore(); error.mockRestore(); }
});
