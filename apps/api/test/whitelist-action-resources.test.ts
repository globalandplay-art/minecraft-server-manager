import { expect, it, vi, afterEach } from "vitest";
import { WhitelistActionResources, type WhitelistActionResource } from "../src/services/whitelist-action-resources.js";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  let active = true;
  const revoke = vi.fn(() => { active = false; });
  const resources = new WhitelistActionResources(() => { if (!active) throw new Error("SECRET"); }, revoke);
  return { resources, revoke };
}
function task() {
  const result = deferred<number>();
  const resource = { result: result.promise, closedConfirmed: false, drain: vi.fn(async (deadline: number) => { void deadline; }) } satisfies WhitelistActionResource<number>;
  return { result, resource };
}
afterEach(() => { vi.useRealTimers(); });

it("has zero side effects at construction and retires only settled closed resources", async () => {
  const { resources, revoke } = fixture(), t = task(), factory = vi.fn(() => t.resource);
  expect(revoke).not.toHaveBeenCalled(); expect(factory).not.toHaveBeenCalled();
  const value = resources.start(factory); expect(resources.activeCount).toBe(1);
  t.resource.closedConfirmed = true; t.result.resolve(7);
  await expect(value).resolves.toBe(7); expect(resources.activeCount).toBe(0);
  expect(resources.seal()).toBe(true); await resources.drain(); expect(revoke).toHaveBeenCalledOnce();
});

it("permanently revokes before a swallowed task failure permits another factory", async () => {
  const { resources, revoke } = fixture(), t = task();
  const value = expect(resources.start(() => t.resource)).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  t.resource.closedConfirmed = true; t.result.reject(new Error("SECRET")); await value;
  expect(revoke).toHaveBeenCalledOnce(); expect(resources.failed).toBe(true);
  const next = vi.fn(() => t.resource); await expect(resources.start(next)).rejects.toThrow("WHITELIST_ACTION_UNSAFE");
  expect(next).not.toHaveBeenCalled(); expect(resources.seal()).toBe(false); await resources.drain();
});

it("does not turn an early body return into success after eventual safe drain", async () => {
  const { resources } = fixture(), t = task();
  const value = expect(resources.start(() => t.resource)).rejects.toThrow("WHITELIST_ACTION_UNSAFE");
  expect(resources.seal()).toBe(false);
  t.resource.drain = vi.fn(async () => { t.resource.closedConfirmed = true; t.result.resolve(7); });
  await resources.drain(); await value; expect(resources.failed).toBe(true); expect(resources.seal()).toBe(false);
});

it("retains unknown creation even if other known resources later close", async () => {
  const { resources } = fixture(), t = task();
  const first = expect(resources.start(() => t.resource)).rejects.toThrow("WHITELIST_ACTION_UNSAFE");
  await expect(resources.start(() => { throw new Error("SECRET_PATH"); })).rejects.toThrow("WHITELIST_ACTION_UNSAFE");
  t.resource.drain = vi.fn(async () => { t.resource.closedConfirmed = true; t.result.resolve(7); });
  await expect(resources.drain()).rejects.toThrow("CLEANUP_BLOCKED"); await first;
  expect(t.resource.drain).toHaveBeenCalledOnce(); expect(resources.activeCount).toBeGreaterThan(0);
});

it("does not mistake result settlement for child close", async () => {
  const { resources } = fixture(), t = task(), value = resources.start(() => t.resource);
  t.result.resolve(7); await value; expect(resources.activeCount).toBe(1);
  await expect(resources.drain()).rejects.toThrow("CLEANUP_BLOCKED");
});

it("uses a shared5s deadline and keeps a failed drain cached after late settlement", async () => {
  vi.useFakeTimers(); const { resources } = fixture(), a = task(), b = task();
  const first = expect(resources.start(() => a.resource)).rejects.toThrow("WHITELIST_ACTION_UNSAFE");
  const second = expect(resources.start(() => b.resource)).rejects.toThrow("WHITELIST_ACTION_UNSAFE");
  const drain = resources.drain(); expect(resources.drain()).toBe(drain);
  const error = expect(drain).rejects.toThrow("CLEANUP_BLOCKED");
  await vi.advanceTimersByTimeAsync(5000); await error;
  expect(vi.mocked(a.resource.drain).mock.calls[0]![0]).toBe(vi.mocked(b.resource.drain).mock.calls[0]![0]);
  a.resource.closedConfirmed = b.resource.closedConfirmed = true; a.result.resolve(1); b.result.resolve(2); await first; await second;
  await expect(resources.drain()).rejects.toThrow("CLEANUP_BLOCKED");
});

it("counts synchronous revocation and cleanup cost before any quick success", async () => {
  let now = 0; const resources = new WhitelistActionResources(() => undefined, () => { now = 5000; }, () => now);
  await expect(resources.drain()).rejects.toThrow("CLEANUP_BLOCKED");
});

it("refuses capacity before invoking the excess factory", async () => {
  const resources = new WhitelistActionResources(() => undefined, () => undefined, undefined, 1), t = task();
  const first = expect(resources.start(() => t.resource)).rejects.toThrow("WHITELIST_ACTION_UNSAFE");
  const next = vi.fn(() => t.resource); await expect(resources.start(next)).rejects.toThrow("WHITELIST_ACTION_UNSAFE");
  expect(next).not.toHaveBeenCalled(); t.resource.drain = vi.fn(async () => { t.resource.closedConfirmed = true; t.result.resolve(1); });
  await resources.drain(); await first;
});

it("treats revoked external context and revocation failure as unsafe, without raw errors", async () => {
  const resources = new WhitelistActionResources(() => { throw new Error("SECRET_CONTEXT"); }, () => { throw new Error("SECRET_REVOKE"); });
  const next = vi.fn(() => task().resource);
  await expect(resources.start(next)).rejects.toThrow("WHITELIST_ACTION_UNSAFE"); expect(next).not.toHaveBeenCalled();
  const error = await resources.drain().catch((value: unknown) => value);
  expect(String(error)).toBe("Error: CLEANUP_BLOCKED"); expect(JSON.stringify(error)).not.toContain("SECRET");
});

it.each(["revoke", "resource"])("publishes shared drain before synchronous %s reentry", async (stage) => {
  let nested: Promise<void> | undefined;
  const resources = new WhitelistActionResources(() => undefined, () => { if (stage === "revoke") nested = resources.drain(); });
  const t = task(), result = expect(resources.start(() => t.resource)).rejects.toThrow("WHITELIST_ACTION_UNSAFE");
  t.resource.drain = vi.fn(async () => {
    if (stage === "resource") nested = resources.drain();
    t.resource.closedConfirmed = true; t.result.resolve(1);
  });
  const drain = resources.drain(); expect(nested).toBe(drain); await drain; await result;
  expect(t.resource.drain).toHaveBeenCalledOnce();
});

it("refuses additional cleanup dispatch after synchronous prior cleanup exhausts the shared limit", async () => {
  let now = 0; const resources = new WhitelistActionResources(() => undefined, () => undefined, () => now);
  const a = task(), b = task();
  const first = expect(resources.start(() => a.resource)).rejects.toThrow("WHITELIST_ACTION_UNSAFE");
  const second = expect(resources.start(() => b.resource)).rejects.toThrow("WHITELIST_ACTION_UNSAFE");
  a.resource.drain = vi.fn(async () => { now = 5000; a.resource.closedConfirmed = true; a.result.resolve(1); });
  await expect(resources.drain()).rejects.toThrow("CLEANUP_BLOCKED");
  expect(b.resource.drain).not.toHaveBeenCalled(); expect(resources.failed).toBe(true);
  b.resource.closedConfirmed = true; b.result.resolve(2); await first; await second;
});
