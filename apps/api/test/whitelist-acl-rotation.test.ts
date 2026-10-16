import { afterEach, expect, it, vi } from "vitest";
import { AuthCoreError } from "../src/auth/password.js";
import { WhitelistAclScope } from "../src/services/whitelist-acl-scope.js";

const sid = "S-1-5-21-1-2-3-1001";
const row = () => ({ userSid: sid, ownerSid: sid, protected: true, aces: [{ sid, kind: "allow", flags: 0, mask: 0x1f01ff }] });
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function fixture(options: { now?: () => number; budget?: number } = {}) {
  let tick = 0;
  const now = options.now ?? (() => tick), trace: string[] = [];
  const ownership = { mutation: false, releases: 0 };
  const owner = { assertHeld: () => undefined, rootIdentity: () => "fixed-root", beginOfflineMutation: () => {
    if (ownership.mutation) throw new AuthCoreError("AUTH_BUSY"); ownership.mutation = true;
    return () => { ownership.mutation = false; ownership.releases++; };
  } };
  const make = () => {
    const born = now(), index = sessions.length;
    const child = { closedConfirmed: false, fault: false,
      get healthyForRotation() { return !child.closedConfirmed && !child.fault && now() - born < 40_000; },
      query: vi.fn(async (...args: [readonly string[], number?]): Promise<unknown[]> => { trace.push(`query-${index}`); return args[0].map(row); }),
      close: vi.fn(async () => { trace.push(`close-${index}`); child.closedConfirmed = true; }),
    };
    sessions.push(child); trace.push(`create-${index}`); return child;
  };
  const sessions: ReturnType<typeof make>[] = [], factory = vi.fn(make);
  const scope = new WhitelistAclScope(owner, "fixed-root", factory, now, options.budget);
  return { scope, sessions, factory, make, trace, ownership, setTime: (value: number) => { tick = value; } };
}
afterEach(() => vi.useRealTimers());

it("keeps32 real queries per healthy child then confirms close before creating the next", async () => {
  const f = fixture();
  await f.scope.run(async (acl) => {
    for (let i = 0; i < 33; i++) await acl.verifyMany(["one", "two"]);
  });
  expect(f.sessions.map((s) => s.query.mock.calls.length)).toEqual([32, 1]);
  expect(f.trace.indexOf("close-0")).toBeLessThan(f.trace.indexOf("create-1"));
  expect(f.sessions.every((s) => s.closedConfirmed)).toBe(true); expect(f.ownership.mutation).toBe(false);
});
it("rotates at20seconds but not at19999ms and preserves the complete batch", async () => {
  const f = fixture();
  await f.scope.run(async (acl) => {
    await acl.verify("one"); f.setTime(19999); await acl.verify("one");
    expect(f.factory).toHaveBeenCalledOnce(); f.setTime(20000); await acl.verifyMany(["one", "two"]);
  });
  expect(f.sessions.map((s) => s.query.mock.calls.length)).toEqual([2, 1]);
  expect(f.sessions[1]!.query.mock.calls[0]![0]).toEqual(["one", "two"]);
});
it("explicit publication quiescence creates no idle child and retains the owner lease", async () => {
  const f = fixture();
  await f.scope.run(async (acl) => {
    await acl.quiesce(); expect(f.factory).not.toHaveBeenCalled();
    await acl.verify("one"); await acl.quiesce();
    expect(f.sessions[0]!.closedConfirmed).toBe(true); expect(f.ownership.mutation).toBe(true);
    acl.verifyNativeSnapshot(row()); await acl.verify("one");
  });
  expect(f.sessions).toHaveLength(2); expect(f.ownership.releases).toBe(1);
});
it("never replaces a child with a known fault even when the age threshold requests rotation", async () => {
  const f = fixture();
  await expect(f.scope.run(async (acl) => {
    await acl.verify("one"); f.sessions[0]!.fault = true; f.setTime(20000); await acl.verify("one");
  })).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  expect(f.factory).toHaveBeenCalledOnce(); expect(f.sessions[0]!.query).toHaveBeenCalledOnce();
});
it("does not rehabilitate a lifetime-expired child by canceling a delayed timer", async () => {
  const f = fixture();
  await expect(f.scope.run(async (acl) => { await acl.verify("one"); f.setTime(40000); await acl.verify("one"); }))
    .rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  expect(f.factory).toHaveBeenCalledOnce();
});
it("cannot hide40s expiry by closing late at the end of an action", async () => {
  const f = fixture();
  await expect(f.scope.run(async (acl) => { await acl.verify("one"); f.setTime(40000); }))
    .rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  expect(f.ownership.mutation).toBe(false);
});
it("never creates a replacement after a confirmed but failed close", async () => {
  const f = fixture();
  await expect(f.scope.run(async (acl) => {
    await acl.verify("one"); f.sessions[0]!.close.mockImplementation(async () => {
      f.sessions[0]!.closedConfirmed = true; throw new Error("PRIVATE_CLOSE");
    });
    await acl.quiesce();
  })).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  expect(f.factory).toHaveBeenCalledOnce(); expect(f.sessions[0]!.close).toHaveBeenCalledOnce();
});
it("enforces the combined query/child budget across quiescence without refund or reset", async () => {
  const f = fixture({ budget: 5 });
  await expect(f.scope.run(async (acl) => {
    await acl.verify("one"); await acl.quiesce(); await acl.verify("one"); await acl.verify("one"); await acl.verify("one");
  })).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  expect(f.sessions.map((s) => s.query.mock.calls.length)).toEqual([1, 2]); expect(f.factory).toHaveBeenCalledTimes(2);
});
it("pre-reserves a new child's full cost before creating it", async () => {
  const f = fixture({ budget: 3 });
  await expect(f.scope.run(async (acl) => { await acl.verify("one"); await acl.quiesce(); await acl.verify("one"); }))
    .rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  expect(f.factory).toHaveBeenCalledOnce();
});
it("cannot spend the last single unit on a count-triggered child replacement", async () => {
  const f = fixture({ budget: 34 });
  await expect(f.scope.run(async (acl) => { for (let i = 0; i < 33; i++) await acl.verify("one"); }))
    .rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  expect(f.sessions[0]!.query).toHaveBeenCalledTimes(32); expect(f.factory).toHaveBeenCalledOnce();
});
it("counts trusted factory preparation inside the logical query deadline before dispatch", async () => {
  const f = fixture(); f.factory.mockImplementation(() => { const session = f.make(); f.setTime(5001); return session; });
  await expect(f.scope.run((acl) => acl.verify("one"))).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  expect(f.factory).toHaveBeenCalledOnce(); expect(f.sessions[0]!.query).not.toHaveBeenCalled();
});
it("does not accept a late fake reply merely because the deadline timer callback is delayed", async () => {
  const f = fixture(); f.factory.mockImplementation(() => {
    const session = f.make(); session.query.mockImplementation(async (files) => { f.setTime(5001); return files.map(row); }); return session;
  });
  await expect(f.scope.run((acl) => acl.verify("one"))).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  expect(f.factory).toHaveBeenCalledOnce(); expect(f.ownership.mutation).toBe(false);
});
it.each([0, 1, 262145, Number.NaN, Number.POSITIVE_INFINITY])("rejects unsafe test policy budget %s", (budget) => {
  expect(() => fixture({ budget })).toThrow("WHITELIST_ACL_SCOPE_UNSAFE");
});
it("keeps the frozen SID after healthy rotation", async () => {
  const f = fixture();
  f.factory.mockImplementation(() => {
    const session = f.make();
    if (f.sessions.length === 2) session.query.mockResolvedValue([{ ...row(), userSid: "S-1-5-21-1-2-3-1002", ownerSid: "S-1-5-21-1-2-3-1002" }]);
    return session;
  });
  await expect(f.scope.run(async (acl) => { await acl.verify("one"); await acl.quiesce(); await acl.verify("one"); }))
    .rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  expect(f.factory).toHaveBeenCalledTimes(2);
});
it("counts rotation-close and new query inside ONE5000ms deadline", async () => {
  vi.useFakeTimers({ now: 0 }); const f = fixture({ now: () => Date.now() });
  f.factory.mockImplementation(() => {
    const session = f.make();
    if (f.sessions.length === 1) session.close.mockImplementation(async () => { await pause(4000); session.closedConfirmed = true; });
    else session.query.mockImplementation((_files, deadline) => new Promise((_, reject) => {
      setTimeout(() => reject(new Error("fixed-deadline")), deadline! - Date.now());
    }));
    return session;
  });
  const run = f.scope.run(async (acl) => { await acl.verify("one"); await pause(20000); await acl.verify("one"); });
  const failure = expect(run).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  await vi.advanceTimersByTimeAsync(24000);
  expect(f.sessions[1]!.query.mock.calls[0]![1]).toBe(25000);
  await vi.advanceTimersByTimeAsync(1000); await failure; expect(Date.now()).toBe(25000);
  expect(f.factory).toHaveBeenCalledTimes(2);
});
it("starts no replacement when old-child drain exhausts the logical query deadline", async () => {
  vi.useFakeTimers({ now: 0 }); const f = fixture({ now: () => Date.now() });
  const run = f.scope.run(async (acl) => {
    await acl.verify("one"); f.sessions[0]!.close.mockImplementation(async () => { await pause(5100); f.sessions[0]!.closedConfirmed = true; });
    await pause(20000); await acl.verify("one");
  });
  const failure = expect(run).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  await vi.advanceTimersByTimeAsync(25000); await failure;
  expect(f.factory).toHaveBeenCalledOnce(); expect(f.sessions[0]!.close).toHaveBeenCalledOnce();
  expect(f.ownership.mutation).toBe(true); await vi.advanceTimersByTimeAsync(100);
  await expect(f.scope.run(async () => undefined)).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
});
it("independently bounds a hanging quiescence and keeps its uncertain lease", async () => {
  vi.useFakeTimers({ now: 0 }); const f = fixture({ now: () => Date.now() });
  const run = f.scope.run(async (acl) => {
    await acl.verify("one"); f.sessions[0]!.close.mockImplementation(() => new Promise<void>(() => {})); await acl.quiesce();
  });
  const failure = expect(run).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  await vi.advanceTimersByTimeAsync(5000); await failure;
  expect(f.sessions[0]!.close).toHaveBeenCalledOnce(); expect(f.ownership.mutation).toBe(true);
});
