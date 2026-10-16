import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AuthCoreError } from "../src/auth/password.js";
import { WhitelistEnvelopeAclAction, type WhitelistEnvelopeAcl } from "../src/services/whitelist-envelope-acl.js";

const snapshot = (sid = "S-1-5-21-1-2-3-1001") => ({ userSid: sid, ownerSid: sid, protected: true,
  aces: [{ sid, kind: "allow", mask: 0x1f01ff, flags: 0 }] });
function fakeSession() {
  const session = { closedConfirmed: false,
    get healthyForRotation() { return !session.closedConfirmed; },
    query: vi.fn(async (files: readonly string[], _deadline?: number): Promise<unknown[]> => { void _deadline; return files.map(() => snapshot()); }),
    close: vi.fn(async (_deadline?: number) => { void _deadline; session.closedConfirmed = true; }),
  };
  return session;
}
function fixture(limit = 262_144) {
  const state = { held: true, identity: "a".repeat(64), mutation: false, activity: 0, leases: 0, releases: 0, tick: 0 };
  const root = path.resolve("isolated-envelope-acl-fixture");
  const owner = { assertHeld: vi.fn((input: string) => { if (!state.held || input !== root) throw new AuthCoreError("AUTH_PRIVATE_UNSAFE"); }),
    rootIdentity: () => state.identity,
    beginActivity: () => { state.activity++; return () => { state.activity--; }; },
    beginOfflineMutation: () => {
      if (state.mutation) throw new AuthCoreError("AUTH_BUSY"); state.mutation = true; state.leases++;
      return () => { state.mutation = false; state.releases++; };
    },
    nativeAclChildWrapper: vi.fn((input: string) => {
      expect(input).toBe(root); expect(state).toMatchObject({ mutation: true, activity: 1 });
      return (script: string) => { expect(state.mutation).toBe(true); return `# exact-owner\n${script}`; };
    }),
  };
  const sessions: ReturnType<typeof fakeSession>[] = [];
  const factory = vi.fn((wrapper: (script: string) => string, _now: () => number) => {
    void _now;
    expect(wrapper("fixed")).toBe("# exact-owner\nfixed");
    const session = fakeSession(); sessions.push(session); return session;
  });
  const action = new WhitelistEnvelopeAclAction(owner, root, factory, () => state.tick, limit);
  return { state, owner, sessions, factory, action, run: <T>(body: (acl: WhitelistEnvelopeAcl) => Promise<T>, deadline = 100_000) => action.run(deadline, body) };
}
afterEach(() => vi.useRealTimers());

it("uses exactly one owner lease, no helper for an empty body and a frozen four-method facade", async () => {
  const f = fixture();
  await expect(f.run(async (acl) => {
    expect(Object.isFrozen(acl)).toBe(true);
    expect(Object.keys(acl).sort()).toEqual(["quiesce", "verify", "verifyMany", "verifyNativeSnapshot"]);
    return 7;
  })).resolves.toBe(7);
  expect(f.factory).not.toHaveBeenCalled(); expect(f.state).toMatchObject({ leases: 1, releases: 1, mutation: false, activity: 0 });
  await expect(f.run(async () => undefined)).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
});
it("preserves batches and retires the actual idle child before returning normal body success", async () => {
  const f = fixture(); let finish!: () => void;
  const result = f.run(async (acl) => {
    const hashes = await acl.verifyMany(["first", "second"]); expect(hashes).toHaveLength(2);
    const session = f.sessions[0]!;
    session.close.mockImplementation(() => new Promise<void>((resolve) => { finish = () => { session.closedConfirmed = true; resolve(); }; }));
    return "fixed-result";
  });
  await vi.waitFor(() => expect(f.sessions[0]!.close).toHaveBeenCalledOnce());
  expect(f.state).toMatchObject({ mutation: true, activity: 1, releases: 0 });
  expect(f.action.diagnostic.resourceCount).toBe(1); finish();
  await expect(result).resolves.toBe("fixed-result");
  expect(f.sessions[0]!.query.mock.calls[0]).toEqual([["first", "second"], 5000]);
  expect(f.action.diagnostic).toMatchObject({ phase: "released", resourceCount: 0, primary: null });
});
it.each(["bad-input", "bad-snapshot"])("synchronously poisons the envelope when caught %s occurs before the first session", async (mode) => {
  const f = fixture();
  await expect(f.run(async (acl) => {
    if (mode === "bad-input") await expect(acl.verifyMany([])).rejects.toMatchObject({ code: "WHITELIST_ENVELOPE_ACL_UNSAFE" });
    else expect(() => acl.verifyNativeSnapshot({ ...snapshot(), protected: false })).toThrow("WHITELIST_ENVELOPE_ACL_UNSAFE");
    await expect(acl.verify("later")).rejects.toMatchObject({ code: "WHITELIST_ENVELOPE_ACL_UNSAFE" });
    return "must-not-succeed";
  })).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE", primary: "cancelled" });
  expect(f.factory).not.toHaveBeenCalled(); expect(f.state.releases).toBe(1);
});
it("pins snapshot/query SID across explicitly quiesced children", async () => {
  const f = fixture();
  await expect(f.run(async (acl) => {
    acl.verifyNativeSnapshot(snapshot()); await acl.verify("first"); await acl.quiesce();
    f.factory.mockImplementation(() => { const next = fakeSession(); next.query.mockResolvedValue([snapshot("S-1-5-21-1-2-3-1002")]); f.sessions.push(next); return next; });
    await acl.verify("second");
  })).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.factory).toHaveBeenCalledTimes(2); expect(f.sessions.every((s) => s.closedConfirmed)).toBe(true);
});
it("rotates after32queries while keeping the sole lease and full accounting", async () => {
  const f = fixture();
  await f.run(async (acl) => { for (let i = 0; i < 33; i++) await acl.verify("fixture"); });
  expect(f.factory).toHaveBeenCalledTimes(2); expect(f.sessions.map((s) => s.query.mock.calls.length)).toEqual([32, 1]);
  expect(f.sessions.every((s) => s.closedConfirmed)).toBe(true); expect(f.state).toMatchObject({ leases: 1, releases: 1 });
});
it("includes healthy rotation close cost inside the same logical query deadline", async () => {
  const f = fixture();
  await f.run(async (acl) => {
    await acl.verify("first"); f.state.tick = 20_000;
    f.sessions[0]!.close.mockImplementation(async () => { f.state.tick = 24_000; f.sessions[0]!.closedConfirmed = true; });
    await acl.verify("second");
    expect(f.sessions[1]!.query.mock.calls[0]![1]).toBe(25_000);
  });
  expect(f.state.releases).toBe(1);
});
it("does not create a replacement when rotation exhausts its query deadline", async () => {
  const f = fixture();
  await expect(f.run(async (acl) => {
    await acl.verify("first"); f.state.tick = 20_000;
    f.sessions[0]!.close.mockImplementation(async () => { f.state.tick = 25_001; f.sessions[0]!.closedConfirmed = true; });
    await acl.verify("second");
  })).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.factory).toHaveBeenCalledOnce(); expect(f.state.releases).toBe(1);
});
it("does not reset the combined budget after quiesce or exceed it before factory invocation", async () => {
  const f = fixture(3);
  await expect(f.run(async (acl) => { await acl.verify("first"); await acl.quiesce(); await acl.verify("second"); }))
    .rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.factory).toHaveBeenCalledOnce(); expect(f.state.releases).toBe(1);
});
it("poisons caught query failures before the body can issue another query", async () => {
  const f = fixture(); f.factory.mockImplementation(() => { const s = fakeSession(); s.query.mockRejectedValue(new Error("PRIVATE_SENTINEL")); f.sessions.push(s); return s; });
  const failure = await f.run(async (acl) => {
    await expect(acl.verify("first")).rejects.toMatchObject({ code: "WHITELIST_ENVELOPE_ACL_UNSAFE" });
    await expect(acl.verify("second")).rejects.toMatchObject({ code: "WHITELIST_ENVELOPE_ACL_UNSAFE" });
  }).catch((error: unknown) => error);
  expect(failure).toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" }); expect(JSON.stringify(failure)).not.toContain("PRIVATE_SENTINEL");
  expect(f.sessions[0]!.query).toHaveBeenCalledOnce(); expect(f.state.releases).toBe(1);
});
it("retains an unknown factory result and never tries another child or release", async () => {
  const f = fixture(); f.factory.mockImplementation(() => { throw new Error("PRIVATE_FACTORY"); });
  await expect(f.run((acl) => acl.verify("first"))).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  expect(f.state).toMatchObject({ mutation: true, activity: 1, releases: 0 }); expect(f.factory).toHaveBeenCalledOnce();
});
it("does not release while an early-returned raw query remains unsettled", async () => {
  vi.useFakeTimers(); const f = fixture(); let settle!: (value: unknown[]) => void;
  f.factory.mockImplementation(() => { const s = fakeSession(); s.query.mockImplementation(() => new Promise((resolve) => { settle = resolve; })); f.sessions.push(s); return s; });
  const operation = f.run(async (acl) => { void acl.verify("first").catch(() => undefined); return "not-safe"; });
  const failed = expect(operation).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  await vi.advanceTimersByTimeAsync(0); expect(f.state.mutation).toBe(true);
  f.state.tick = 5001; await vi.advanceTimersByTimeAsync(5001); await failed;
  expect(f.state).toMatchObject({ mutation: true, activity: 1, releases: 0 });
  settle([snapshot()]); await vi.advanceTimersByTimeAsync(0);
  expect(f.action.diagnostic.phase).toBe("retained"); expect(f.state.releases).toBe(0);
});
it("preserves primary failure but releases only after close and raw settlement within cleanup", async () => {
  const f = fixture(); let settle!: (value: unknown[]) => void;
  f.factory.mockImplementation(() => { const s = fakeSession(); s.query.mockImplementation(() => new Promise((resolve) => { settle = resolve; }));
    s.close.mockImplementation(async () => { s.closedConfirmed = true; settle([snapshot()]); }); f.sessions.push(s); return s; });
  await expect(f.run(async (acl) => { void acl.verify("first").catch(() => undefined); return "not-safe"; }))
    .rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.state).toMatchObject({ mutation: false, activity: 0, releases: 1 });
});
it("does not release on an unconfirmed close even if close returned success", async () => {
  const f = fixture(); f.factory.mockImplementation(() => { const s = fakeSession(); s.close.mockImplementation(async () => undefined); f.sessions.push(s); return s; });
  await expect(f.run((acl) => acl.verify("first"))).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  expect(f.state.releases).toBe(0); expect(f.state.mutation).toBe(true);
});
it("rejects owner drift before another query and never reuses an escaped facade", async () => {
  const f = fixture(); let escaped!: WhitelistEnvelopeAcl;
  await expect(f.run(async (acl) => { escaped = acl; await acl.verify("first"); f.state.identity = "b".repeat(64); await acl.verify("second"); }))
    .rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  expect(f.sessions[0]!.query).toHaveBeenCalledOnce(); await expect(escaped.verify("later")).rejects.toMatchObject({ code: "WHITELIST_ENVELOPE_ACL_UNSAFE" });
});
it("refuses an escaped successful facade without changing the released envelope result", async () => {
  const f = fixture(); let escaped!: WhitelistEnvelopeAcl;
  await f.run(async (acl) => { escaped = acl; await acl.verify("first"); });
  const before = f.action.diagnostic;
  await expect(escaped.verify("later")).rejects.toMatchObject({ code: "WHITELIST_ENVELOPE_ACL_UNSAFE" });
  expect(f.action.diagnostic).toEqual(before); expect(f.factory).toHaveBeenCalledOnce();
});
it("fails an overlapping query before a second dispatch and observes the first raw settlement", async () => {
  const f = fixture(); let settle!: (value: unknown[]) => void;
  f.factory.mockImplementation(() => { const s = fakeSession(); s.query.mockImplementation(() => new Promise((resolve) => { settle = resolve; }));
    s.close.mockImplementation(async () => { s.closedConfirmed = true; settle([snapshot()]); }); f.sessions.push(s); return s; });
  await expect(f.run(async (acl) => {
    const first = acl.verify("first").catch(() => undefined);
    await expect(acl.verify("second")).rejects.toMatchObject({ code: "WHITELIST_ENVELOPE_ACL_UNSAFE" });
    // Cleanup will physically close the child and settle the original raw query.
    void first;
  })).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.sessions[0]!.query).toHaveBeenCalledOnce(); expect(f.state.releases).toBe(1);
});
it("rejects a second action on the same owner without another lease or wrapper", async () => {
  const f = fixture(); let finish!: () => void;
  const first = f.run(() => new Promise<void>((resolve) => { finish = resolve; }));
  const second = new WhitelistEnvelopeAclAction(f.owner, path.resolve("isolated-envelope-acl-fixture"), f.factory, () => f.state.tick);
  await expect(second.run(100_000, async () => undefined)).rejects.toMatchObject({ code: "WHITELIST_ACTION_BUSY" });
  expect(f.state).toMatchObject({ mutation: true, activity: 1, leases: 1, releases: 0 });
  expect(f.owner.nativeAclChildWrapper).toHaveBeenCalledOnce(); finish(); await first;
});
it("does not dispatch a raw query when synchronous factory cost exhausts its5s budget", async () => {
  const f = fixture(); const s = fakeSession();
  f.factory.mockImplementation(() => { f.state.tick = 5001; f.sessions.push(s); return s; });
  await expect(f.run((acl) => acl.verify("first"))).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(s.query).not.toHaveBeenCalled(); expect(s.closedConfirmed).toBe(true); expect(f.state.releases).toBe(1);
});
it("does not accept a snapshot whose validation exceeds the original query deadline", async () => {
  const f = fixture(); const row = snapshot();
  Object.defineProperty(row, "protected", { get: () => { f.state.tick = 5001; return true; } });
  f.factory.mockImplementation(() => { const s = fakeSession(); s.query.mockResolvedValue([row]); f.sessions.push(s); return s; });
  await expect(f.run((acl) => acl.verify("first"))).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.factory).toHaveBeenCalledOnce(); expect(f.state.releases).toBe(1);
});
it("rejects a close reaching40s child lifetime and never creates a replacement", async () => {
  const f = fixture();
  await expect(f.run(async (acl) => {
    await acl.verify("first"); f.state.tick = 39_000;
    f.sessions[0]!.close.mockImplementation(async () => { f.state.tick = 40_000; f.sessions[0]!.closedConfirmed = true; });
    await acl.verify("second");
  })).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.factory).toHaveBeenCalledOnce(); expect(f.state.releases).toBe(1);
});
it("rejects a facade invoked outside its active ALS context", async () => {
  const f = fixture(); let facade!: WhitelistEnvelopeAcl, finish!: () => void;
  const running = f.run(async (acl) => { facade = acl; await new Promise<void>((resolve) => { finish = resolve; }); });
  await expect(facade.verify("outside")).rejects.toMatchObject({ code: "WHITELIST_ENVELOPE_ACL_UNSAFE" });
  finish(); await expect(running).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.factory).not.toHaveBeenCalled(); expect(f.state.releases).toBe(1);
});
it.each([1, 262_145, Number.NaN, 2.5])("refuses unsafe combined accounting limit %s without acquiring an owner", (limit) => {
  expect(() => fixture(limit)).toThrow("WHITELIST_ENVELOPE_ACL_UNSAFE");
});
it.each(["owner", "health"])("rechecks healthy rotation after synchronous %s validation crosses20s", async (mode) => {
  const f = fixture();
  await f.run(async (acl) => {
    await acl.verify("first"); f.state.tick = 19_999;
    if (mode === "owner") {
      const original = f.owner.assertHeld.getMockImplementation()!; let checks = 0;
      f.owner.assertHeld.mockImplementation((input) => { original(input); if (++checks === 2) f.state.tick = 20_000; });
    } else Object.defineProperty(f.sessions[0]!, "healthyForRotation", { get: () => { f.state.tick = 20_000; return true; } });
    await acl.verify("second");
    expect(f.factory).toHaveBeenCalledTimes(2);
    expect(f.sessions.map((s) => s.query.mock.calls.length)).toEqual([1, 1]);
    expect(f.sessions[1]!.query.mock.calls[0]![1]).toBe(24_999);
  });
});
it("reserves the replacement unit before retiring the old child when validation crosses20s", async () => {
  const f = fixture(3);
  await expect(f.run(async (acl) => {
    await acl.verify("first"); f.state.tick = 19_999;
    Object.defineProperty(f.sessions[0]!, "healthyForRotation", { get: () => { f.state.tick = 20_000; return true; } });
    f.sessions[0]!.close.mockImplementation(async () => {
      // This is failure cleanup only: healthy retirement was never admitted with an exhausted budget.
      expect(f.action.diagnostic.primary).toBe("cancelled"); f.sessions[0]!.closedConfirmed = true;
    });
    await acl.verify("second");
  })).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.factory).toHaveBeenCalledOnce(); expect(f.sessions[0]!.query).toHaveBeenCalledOnce(); expect(f.state.releases).toBe(1);
});
