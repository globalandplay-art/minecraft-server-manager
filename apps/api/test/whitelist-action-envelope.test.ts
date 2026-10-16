import { AsyncResource } from "node:async_hooks";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AuthCoreError } from "../src/auth/password.js";
import { WhitelistActionEnvelope, type WhitelistActionCapability } from "../src/services/whitelist-action-envelope.js";
import type { WhitelistActionResource } from "../src/services/whitelist-action-resources.js";

function deferred<T>() {
  let yes!: (value: T) => void, no!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => { yes = resolve; no = reject; });
  return { promise, resolve: yes, reject: no };
}
function fixture(now: () => number = () => 0) {
  const root = resolve("isolated-whitelist-action-root");
  const state = { held: true, identity: "a".repeat(64), busy: false, activities: 0 };
  const releaseMutation = vi.fn(() => { state.busy = false; });
  const releaseActivity = vi.fn(() => { state.activities--; return undefined; });
  const owner = {
    assertHeld: vi.fn((target: string) => { if (!state.held || target !== root) throw new Error("SECRET_ROOT"); }),
    rootIdentity: vi.fn(() => state.identity),
    beginActivity: vi.fn(() => { state.activities++; return releaseActivity; }),
    beginOfflineMutation: vi.fn(() => { if (state.busy) throw new AuthCoreError("AUTH_BUSY"); state.busy = true; return releaseMutation; }),
  };
  const envelope = new WhitelistActionEnvelope(owner, root, now);
  return { root, owner, state, envelope, releaseMutation, releaseActivity };
}
function task() {
  const result = deferred<number>();
  const resource = { result: result.promise, closedConfirmed: false,
    drain: vi.fn(async (deadline: number) => { void deadline; }) } satisfies WhitelistActionResource<number>;
  return { resource, result };
}
afterEach(() => { vi.useRealTimers(); });

it("takes one activity/mutation and releases in order only after complete tracked work", async () => {
  const f = fixture(), t = task();
  expect(f.owner.beginActivity).not.toHaveBeenCalled();
  const run = f.envelope.run(1000, async (cap) => {
    cap.assertActive(); const work = cap.start(() => t.resource);
    t.resource.closedConfirmed = true; t.result.resolve(7); return await work;
  });
  await expect(run).resolves.toBe(7);
  expect(f.owner.beginActivity).toHaveBeenCalledOnce(); expect(f.owner.beginOfflineMutation).toHaveBeenCalledOnce();
  expect(f.releaseMutation).toHaveBeenCalledOnce(); expect(f.releaseActivity).toHaveBeenCalledOnce();
  expect(f.releaseMutation.mock.invocationCallOrder[0]).toBeLessThan(f.releaseActivity.mock.invocationCallOrder[0]!);
  expect(f.envelope.diagnostic).toMatchObject({ phase: "released", primary: null, resourceCount: 0 });
  expect(f.state).toMatchObject({ busy: false, activities: 0 });
});

it.each([NaN, Infinity, -1, 0, 2_147_483_648])("refuses invalid work deadline before acquiring anything: %s", async (deadline) => {
  const f = fixture(), body = vi.fn(async () => 7);
  await expect(f.envelope.run(deadline, body)).rejects.toMatchObject({ primary: "deadline" });
  expect(body).not.toHaveBeenCalled(); expect(f.owner.beginActivity).not.toHaveBeenCalled();
  await expect(f.envelope.run(1000, body)).rejects.toThrow("WHITELIST_ACTION_UNSAFE");
});

it("reports known AUTH_BUSY without acquiring another mutation or retaining its activity", async () => {
  const f = fixture(); f.state.busy = true;
  await expect(f.envelope.run(1000, async () => 7)).rejects.toMatchObject({ code: "WHITELIST_ACTION_BUSY", primary: "busy" });
  expect(f.releaseMutation).not.toHaveBeenCalled(); expect(f.releaseActivity).toHaveBeenCalledOnce();
  expect(f.state.busy).toBe(true); expect(f.envelope.diagnostic.mutation).toBe("not-acquired");
});

it("retains uncertain acquisition and does not invent release proof", async () => {
  const f = fixture(); f.owner.beginOfflineMutation.mockImplementation(() => { f.state.busy = true; throw new Error("SECRET"); });
  await expect(f.envelope.run(1000, async () => 7)).rejects.toMatchObject({ code: "CLEANUP_BLOCKED", primary: "acquire" });
  expect(f.releaseMutation).not.toHaveBeenCalled(); expect(f.releaseActivity).not.toHaveBeenCalled();
  expect(f.envelope.diagnostic).toMatchObject({ phase: "retained", mutation: "acquire-uncertain", activity: "held" });
});

it("does not claim a lease is held if release happens and then throws", async () => {
  const f = fixture(); f.releaseMutation.mockImplementation(() => { f.state.busy = false; throw new Error("SECRET_RELEASE"); });
  await expect(f.envelope.run(1000, async () => 7)).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  expect(f.state.busy).toBe(false); expect(f.releaseActivity).not.toHaveBeenCalled();
  expect(f.envelope.diagnostic).toMatchObject({ phase: "retained", mutation: "release-uncertain", activity: "held" });
  await expect(f.envelope.run(1000, async () => 8)).rejects.toThrow("WHITELIST_ACTION_UNSAFE");
  expect(f.releaseMutation).toHaveBeenCalledOnce();
});

it("retains both leases when final root identity drifts", async () => {
  const f = fixture();
  await expect(f.envelope.run(1000, async () => { f.state.identity = "b".repeat(64); return 7; })).rejects.toMatchObject({ code: "CLEANUP_BLOCKED", primary: "owner" });
  expect(f.releaseMutation).not.toHaveBeenCalled(); expect(f.releaseActivity).not.toHaveBeenCalled();
});

it("rejects an off-context capability before its resource factory starts", async () => {
  const foreign = new AsyncResource("outside-whitelist-action"), f = fixture(), factory = vi.fn(() => task().resource);
  await expect(f.envelope.run(1000, async (cap) => {
    await expect(foreign.runInAsyncScope(() => cap.start(factory))).rejects.toThrow("WHITELIST_ACTION_UNSAFE"); return 7;
  })).rejects.toMatchObject({ primary: "context" });
  expect(factory).not.toHaveBeenCalled(); expect(f.envelope.diagnostic.phase).toBe("released");
  foreign.emitDestroy();
});

it("keeps success terminal when escaped old capabilities are rejected later", async () => {
  const f = fixture(); let escaped!: WhitelistActionCapability;
  await expect(f.envelope.run(1000, async (cap) => { escaped = cap; return 7; })).resolves.toBe(7);
  const before = f.envelope.diagnostic;
  expect(() => escaped.assertActive()).toThrow("WHITELIST_ACTION_UNSAFE");
  const factory = vi.fn(() => task().resource); await expect(escaped.start(factory)).rejects.toThrow("WHITELIST_ACTION_UNSAFE");
  expect(factory).not.toHaveBeenCalled(); expect(f.envelope.diagnostic).toEqual(before);
});

it("preserves resource failure despite body catch and denies the next factory", async () => {
  const f = fixture(), t = task(), next = vi.fn(() => task().resource);
  await expect(f.envelope.run(1000, async (cap) => {
    const work = cap.start(() => t.resource); t.resource.closedConfirmed = true; t.result.reject(new Error("SECRET"));
    await expect(work).rejects.toThrow("WHITELIST_ACTION_UNSAFE");
    await expect(cap.start(next)).rejects.toThrow("WHITELIST_ACTION_UNSAFE"); return 7;
  })).rejects.toMatchObject({ primary: "resource" });
  expect(next).not.toHaveBeenCalled(); expect(f.releaseMutation).toHaveBeenCalledOnce();
});

it("waits for body settlement as well as resources after a timeout, under the same cleanup deadline", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0); const f = fixture(() => Date.now()), body = deferred<number>();
  const run = expect(f.envelope.run(1000, async () => body.promise)).rejects.toMatchObject({ code: "CLEANUP_BLOCKED", primary: "deadline" });
  await vi.advanceTimersByTimeAsync(1000); expect(f.releaseMutation).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5000); await run;
  expect(f.envelope.diagnostic).toMatchObject({ phase: "retained", bodySettled: false, mutation: "held", activity: "held" });
  body.resolve(7); await vi.advanceTimersByTimeAsync(0);
  expect(f.envelope.diagnostic.phase).toBe("retained"); expect(f.releaseMutation).not.toHaveBeenCalled();
});

it("keeps a timeout failed even when body settles during cleanup and permits only release", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0); const f = fixture(() => Date.now()), body = deferred<number>();
  let escaped!: WhitelistActionCapability;
  const run = expect(f.envelope.run(1000, async (cap) => { escaped = cap; return body.promise; })).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE", primary: "deadline" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(() => escaped.assertActive()).toThrow("WHITELIST_ACTION_UNSAFE"); body.resolve(7);
  await vi.advanceTimersByTimeAsync(0); await run; expect(f.releaseMutation).toHaveBeenCalledOnce();
});

it("does not release while a child has closed but the body handle-finally is pending", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0); const f = fixture(() => Date.now()), t = task(), bodyClose = deferred<void>();
  const run = expect(f.envelope.run(1000, async (cap) => {
    try { await cap.start(() => t.resource); } finally { await bodyClose.promise; } return 7;
  })).rejects.toMatchObject({ primary: "deadline" });
  t.resource.closedConfirmed = true; t.result.resolve(1);
  await vi.advanceTimersByTimeAsync(1000); expect(f.releaseMutation).not.toHaveBeenCalled();
  bodyClose.resolve(); await vi.advanceTimersByTimeAsync(0); await run; expect(f.releaseMutation).toHaveBeenCalledOnce();
});

it("treats early body return with outstanding work as unsafe even after drain", async () => {
  const f = fixture(), t = task(); let work!: Promise<number>;
  t.resource.drain = vi.fn(async () => { t.resource.closedConfirmed = true; t.result.resolve(1); });
  const run = f.envelope.run(1000, async (cap) => { work = cap.start(() => t.resource); return 7; });
  await expect(run).rejects.toMatchObject({ primary: "resource" }); await expect(work).rejects.toThrow("WHITELIST_ACTION_UNSAFE");
  expect(f.releaseMutation).toHaveBeenCalledOnce();
});

it("accounts synchronous acquisition cost and never dispatches the body after deadline", async () => {
  let now = 0; const f = fixture(() => now), body = vi.fn(async () => 7);
  f.owner.beginOfflineMutation.mockImplementation(() => { f.state.busy = true; now = 1000; return f.releaseMutation; });
  await expect(f.envelope.run(1000, body)).rejects.toMatchObject({ primary: "deadline" });
  expect(body).not.toHaveBeenCalled(); expect(f.releaseMutation).toHaveBeenCalledOnce();
});

it("includes synchronous release cost without falsely claiming the mutation remains held", async () => {
  let now = 0; const f = fixture(() => now);
  f.releaseMutation.mockImplementation(() => { f.state.busy = false; now = 5000; });
  await expect(f.envelope.run(1000, async () => 7)).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  expect(f.envelope.diagnostic).toMatchObject({ mutation: "released", activity: "held", phase: "retained" });
  expect(f.releaseActivity).not.toHaveBeenCalled();
});

it("consumes the instance on pre-run cancellation without acquiring anything", async () => {
  const f = fixture(); f.envelope.cancel();
  await expect(f.envelope.run(1000, async () => 7)).rejects.toMatchObject({ primary: "cancelled" });
  expect(f.owner.beginActivity).not.toHaveBeenCalled();
});

it("includes synchronous identity-check cost before a resource factory", async () => {
  let now = 0; const f = fixture(() => now), factory = vi.fn(() => task().resource);
  await expect(f.envelope.run(1000, async (cap) => {
    f.owner.rootIdentity.mockImplementation(() => { now = 1000; return f.state.identity; });
    await expect(cap.start(factory)).rejects.toThrow("WHITELIST_ACTION_UNSAFE"); return 7;
  })).rejects.toMatchObject({ primary: "deadline" });
  expect(factory).not.toHaveBeenCalled();
});

it("does not release after a synchronous final identity check consumes cleanup budget", async () => {
  let now = 0; const f = fixture(() => now), original = f.owner.rootIdentity.getMockImplementation()!;
  await expect(f.envelope.run(1000, async () => {
    let checks = 0; f.owner.rootIdentity.mockImplementation(() => { if (++checks >= 2) now = 5000; return original(); }); return 7;
  })).rejects.toThrow("CLEANUP_BLOCKED");
  expect(f.releaseMutation).not.toHaveBeenCalled(); expect(f.releaseActivity).not.toHaveBeenCalled();
});

it("rejects a body success whose final synchronous identity check crosses the work deadline", async () => {
  let now = 0; const f = fixture(() => now);
  await expect(f.envelope.run(1000, async () => {
    f.owner.rootIdentity.mockImplementation(() => { now = 1000; return f.state.identity; }); return 7;
  })).rejects.toMatchObject({ primary: "deadline" });
  expect(f.releaseMutation).toHaveBeenCalledOnce();
});

it("never dispatches mutation acquisition after the preceding identity check expires", async () => {
  let now = 0; const f = fixture(() => now), original = f.owner.beginActivity.getMockImplementation()!;
  f.owner.beginActivity.mockImplementation(() => {
    f.owner.rootIdentity.mockImplementation(() => { now = 1000; return f.state.identity; }); return original();
  });
  await expect(f.envelope.run(1000, async () => 7)).rejects.toMatchObject({ primary: "deadline" });
  expect(f.owner.beginOfflineMutation).not.toHaveBeenCalled(); expect(f.releaseActivity).toHaveBeenCalledOnce();
});

it("retains an activity acquisition that throws after taking its reference", async () => {
  const f = fixture(); f.owner.beginActivity.mockImplementation(() => { f.state.activities++; throw new Error("SECRET"); });
  await expect(f.envelope.run(1000, async () => 7)).rejects.toMatchObject({ code: "CLEANUP_BLOCKED", primary: "acquire" });
  expect(f.envelope.diagnostic).toMatchObject({ activity: "acquire-uncertain", mutation: "not-acquired" });
  expect(f.releaseActivity).not.toHaveBeenCalled(); expect(f.owner.beginOfflineMutation).not.toHaveBeenCalled();
});

it("requires activity release proof without retrying an already-released throwing callback", async () => {
  const f = fixture(); f.releaseActivity.mockImplementation(() => { f.state.activities--; throw new Error("SECRET"); });
  await expect(f.envelope.run(1000, async () => 7)).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  expect(f.envelope.diagnostic).toMatchObject({ mutation: "released", activity: "release-uncertain" });
  expect(f.state.activities).toBe(0); expect(f.releaseActivity).toHaveBeenCalledOnce();
});

it("can cancel pending work while allowing only existing finalizers to settle", async () => {
  const f = fixture(), body = deferred<number>();
  const run = expect(f.envelope.run(1000, async () => body.promise)).rejects.toMatchObject({ primary: "cancelled" });
  f.envelope.cancel(); body.resolve(7); await run;
  expect(f.releaseMutation).toHaveBeenCalledOnce(); expect(f.releaseActivity).toHaveBeenCalledOnce();
});

it("does not begin activity when the initial owner check synchronously cancels", async () => {
  const f = fixture(); f.owner.rootIdentity.mockImplementation(() => { f.envelope.cancel(); return f.state.identity; });
  await expect(f.envelope.run(1000, async () => 7)).rejects.toMatchObject({ primary: "cancelled" });
  expect(f.owner.beginActivity).not.toHaveBeenCalled(); expect(f.owner.beginOfflineMutation).not.toHaveBeenCalled();
});
