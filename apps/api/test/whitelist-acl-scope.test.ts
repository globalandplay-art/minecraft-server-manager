import { expect, it, vi } from "vitest";
import { AuthCoreError } from "../src/auth/password.js";
import type { WindowsPrivateAclVerifier } from "../src/auth/windows-private-acl.js";
import { WhitelistAclScope, type WhitelistAclScopeSession } from "../src/services/whitelist-acl-scope.js";
import { WhitelistAclSession } from "../src/services/whitelist-acl-session.js";

const snapshot = (sid = "S-1-5-21-1-2-3-1001") => ({ userSid: sid, ownerSid: sid, protected: true,
  aces: [{ sid, kind: "allow", mask: 0x1f01ff, flags: 0 }] });
function fixture() {
  const state = { held: true, identity: "fixed-root-identity", mutation: false, releases: 0, failRelease: false };
  const owner = {
    assertHeld: () => { if (!state.held) throw new AuthCoreError("AUTH_PRIVATE_UNSAFE"); },
    rootIdentity: () => state.identity,
    beginOfflineMutation: () => {
      if (state.mutation) throw new AuthCoreError("AUTH_BUSY"); state.mutation = true;
      return () => { if (state.failRelease) throw new Error("PRIVATE_SENTINEL"); state.releases++; state.mutation = false; };
    },
  };
  const session = {
    closedConfirmed: false,
    get healthyForRotation() { return !session.closedConfirmed; },
    query: vi.fn(async (...args: [readonly string[], number?]): Promise<unknown[]> => args[0].map(() => snapshot())),
    close: vi.fn(async () => { session.closedConfirmed = true; }),
  };
  const factory = vi.fn((): WhitelistAclScopeSession => session);
  const scope = new WhitelistAclScope(owner, "fixed-isolated-root", factory);
  return { state, owner, session, factory, scope };
}

it("does not create a helper for an empty scope and releases the lease only after action completion", async () => {
  const f = fixture();
  await expect(f.scope.run(async () => { expect(f.state.mutation).toBe(true); return 7; })).resolves.toBe(7);
  expect(f.factory).not.toHaveBeenCalled(); expect(f.state).toMatchObject({ mutation: false, releases: 1 });
});
it("preserves actual batches and fresh snapshot checks and waits for confirmed close", async () => {
  const f = fixture(); let finishClose!: () => void;
  f.session.close.mockImplementation(() => new Promise<void>((resolve) => { finishClose = () => { f.session.closedConfirmed = true; resolve(); }; }));
  const action = f.scope.run(async (acl) => {
    const first = await acl.verifyMany(["one", "two"]);
    f.session.query.mockImplementation(async (files) => files.map(() => ({ ...snapshot(), aces: [{ ...snapshot().aces[0]!, flags: 1 }] })));
    const second = await acl.verifyMany(["one", "two"]); expect(second[0]).not.toBe(first[0]); return "fixed-result";
  });
  await vi.waitFor(() => expect(f.session.close).toHaveBeenCalledOnce());
  expect(f.state).toMatchObject({ mutation: true, releases: 0 }); finishClose(); await expect(action).resolves.toBe("fixed-result");
  expect(f.session.query.mock.calls.map(([files]) => files)).toEqual([["one", "two"], ["one", "two"]]);
  expect(f.factory).toHaveBeenCalledOnce(); expect(f.state.mutation).toBe(false);
});
it("rejects overlapping scopes without acquiring or creating another helper", async () => {
  const f = fixture(); let finish!: () => void;
  const first = f.scope.run(() => new Promise<void>((resolve) => { finish = resolve; }));
  await expect(f.scope.run(async () => undefined)).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_BUSY" });
  expect(f.factory).not.toHaveBeenCalled(); finish(); await first; expect(f.state.releases).toBe(1);
});
it.each(["close-rejected", "close-unconfirmed"])("retains the mutation lease when %s and refuses future scopes", async (mode) => {
  const f = fixture(); f.session.close.mockImplementation(async () => { if (mode === "close-rejected") throw new Error("PRIVATE_SENTINEL"); });
  await expect(f.scope.run((acl) => acl.verify("one"))).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  expect(f.state).toMatchObject({ mutation: true, releases: 0 });
  expect(() => f.owner.beginOfflineMutation()).toThrow("AUTH_BUSY");
  await expect(f.scope.run(async () => undefined)).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  expect(f.factory).toHaveBeenCalledOnce();
});
it("rejects a failed close even when exit is known, then releases and poisons", async () => {
  const f = fixture(); f.session.close.mockImplementation(async () => { f.session.closedConfirmed = true; throw new Error("PRIVATE_SENTINEL"); });
  await expect(f.scope.run((acl) => acl.verify("one"))).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  expect(f.state).toMatchObject({ mutation: false, releases: 1 });
  await expect(f.scope.run(async () => undefined)).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
});
it("preserves a primary action failure only after healthy cleanup and does not invent success", async () => {
  const f = fixture(), failure = new Error("fixed-action-failure");
  await expect(f.scope.run(async (acl) => { await acl.verify("one"); throw failure; })).rejects.toBe(failure);
  expect(f.state.mutation).toBe(false); expect(f.session.close).toHaveBeenCalledOnce();
});
it("reports both primary failure presence and unknown cleanup without leaking errors", async () => {
  const f = fixture(); f.session.close.mockImplementation(async () => { throw new Error("PRIVATE_CLOSE"); });
  const error = await f.scope.run(async (acl) => { await acl.verify("one"); throw new Error("PRIVATE_ACTION"); }).catch((value: unknown) => value);
  expect(error).toMatchObject({ code: "CLEANUP_BLOCKED", primaryFailed: true });
  expect(JSON.stringify(error)).not.toMatch(/PRIVATE_|cause/u); expect(f.state.mutation).toBe(true);
});
it("never retries failed queries or replaces their child", async () => {
  const f = fixture(); f.session.query.mockRejectedValue(new Error("PRIVATE_QUERY"));
  await expect(f.scope.run((acl) => acl.verify("one"))).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE", primaryFailed: true });
  expect(f.session.query).toHaveBeenCalledOnce(); expect(f.factory).toHaveBeenCalledOnce(); expect(f.state.mutation).toBe(false);
});
it("does not infer no child from a throwing trusted factory", async () => {
  const f = fixture(); f.factory.mockImplementation(() => { throw new Error("PRIVATE_FACTORY"); });
  await expect(f.scope.run((acl) => acl.verify("one"))).rejects.toMatchObject({ code: "CLEANUP_BLOCKED", primaryFailed: true });
  expect(f.state.mutation).toBe(true); expect(f.state.releases).toBe(0); expect(f.factory).toHaveBeenCalledOnce();
});
it.each(["wrong-count", "unsafe-acl"])("rejects %s with the original ACL rules", async (mode) => {
  const f = fixture(); f.session.query.mockResolvedValue(mode === "wrong-count" ? [] : [{ ...snapshot(), protected: false }]);
  await expect(f.scope.run((acl) => acl.verify("one"))).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  expect(f.state.mutation).toBe(false);
});
it("keeps the frozen SID across distinct fully closed scopes", async () => {
  const f = fixture(); await f.scope.run((acl) => acl.verify("one"));
  const second = { query: vi.fn(async () => [snapshot("S-1-5-21-1-2-3-1002")]), closedConfirmed: false,
    get healthyForRotation() { return !second.closedConfirmed; },
    close: async () => { second.closedConfirmed = true; } };
  f.factory.mockReturnValue(second);
  await expect(f.scope.run((acl) => acl.verify("one"))).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  expect(f.factory).toHaveBeenCalledTimes(2); expect(f.state.releases).toBe(2);
});
it("binds inline publication snapshots to the same SID as queried ACLs", async () => {
  const f = fixture();
  await expect(f.scope.run(async (acl) => { acl.verifyNativeSnapshot(snapshot("S-1-5-21-1-2-3-1002")); await acl.verify("one"); }))
    .rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  expect(f.state.mutation).toBe(false);
});
it("rejects invalid batches before creating a helper", async () => {
  const f = fixture(); await expect(f.scope.run((acl) => acl.verifyMany([]))).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  expect(f.factory).not.toHaveBeenCalled(); expect(f.state.releases).toBe(1);
});
it("rejects owner identity drift before returning an action result", async () => {
  const f = fixture(); await expect(f.scope.run(async () => { f.state.identity = "replaced"; return "not-success"; }))
    .rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  expect(f.state.releases).toBe(1);
});
it("retains the lease if a detached query remains unconfirmed at close", async () => {
  const f = fixture(); let reply!: (rows: unknown[]) => void;
  f.session.query.mockImplementation(() => new Promise((resolve) => { reply = resolve; }));
  let detached!: Promise<string>;
  const run = f.scope.run(async (acl) => { detached = acl.verify("one"); });
  const rejected = expect(detached).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  await expect(run).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  expect(f.state.mutation).toBe(true); reply([snapshot()]); await rejected;
});
it("never reports success when lease release is unconfirmed", async () => {
  const f = fixture(); f.state.failRelease = true;
  await expect(f.scope.run(async () => 1)).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  await expect(f.scope.run(async () => 1)).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
});
it("rejects a prior action capability even when invoked inside the next action context", async () => {
  const f = fixture(); let old!: WindowsPrivateAclVerifier;
  await f.scope.run(async (acl) => { old = acl; });
  await f.scope.run(async (acl) => {
    expect(acl).not.toBe(old);
    await expect(old.verify("one")).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
    expect(() => old.verifyNativeSnapshot(snapshot("S-1-5-21-1-2-3-1002"))).toThrow("WHITELIST_ACL_SCOPE_UNSAFE");
    await acl.verify("one");
  });
  expect(f.session.query).toHaveBeenCalledOnce();
});
it("does not accept a borrowed active capability from an unrelated async context", async () => {
  const f = fixture(); let borrowed!: WindowsPrivateAclVerifier, resume!: () => void;
  const gate = new Promise<void>((resolve) => { resume = resolve; });
  const running = f.scope.run(async (acl) => { borrowed = acl; await gate; await acl.verify("one"); });
  await expect(borrowed.verify("one")).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  expect(() => borrowed.verifyNativeSnapshot(snapshot())).toThrow("WHITELIST_ACL_SCOPE_UNSAFE");
  expect(f.factory).not.toHaveBeenCalled(); resume(); await running;
  expect(f.session.query).toHaveBeenCalledOnce();
});
it("closes action admission before cleanup and does not let creator validation mutate the SID", async () => {
  const f = fixture(); let borrowed!: WindowsPrivateAclVerifier, finish!: () => void;
  f.session.close.mockImplementation(() => new Promise<void>((resolve) => { finish = () => { f.session.closedConfirmed = true; resolve(); }; }));
  const running = f.scope.run(async (acl) => { borrowed = acl; await acl.verify("one"); });
  await vi.waitFor(() => expect(f.session.close).toHaveBeenCalledOnce());
  await expect(borrowed.verify("one")).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  expect(() => borrowed.verifyNativeSnapshot(snapshot())).toThrow("WHITELIST_ACL_SCOPE_UNSAFE");
  expect(f.state.mutation).toBe(true); expect(f.session.query).toHaveBeenCalledOnce(); finish(); await running;
});
it("rejects an old action's scheduled continuation while a later action is active", async () => {
  const f = fixture(); let trigger!: () => void, stale!: Promise<string>;
  const gate = new Promise<void>((resolve) => { trigger = resolve; });
  await f.scope.run(async (acl) => { stale = gate.then(() => acl.verify("one")); });
  const rejected = expect(stale).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  await f.scope.run(async (acl) => { trigger(); await rejected; await acl.verify("one"); });
  expect(f.session.query).toHaveBeenCalledOnce();
});
it.each(["query", "creator"])("does not report success when an action catches a rejected %s ACL check", async (mode) => {
  const f = fixture(); f.session.query.mockRejectedValue(new Error("PRIVATE_QUERY"));
  await expect(f.scope.run(async (acl) => {
    try {
      if (mode === "query") await acl.verify("one");
      else acl.verifyNativeSnapshot({ ...snapshot(), protected: false });
    } catch { /* Caller handling cannot authorize a rejected security check. */ }
    return "not-success";
  })).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  expect(f.state.mutation).toBe(false);
  await expect(f.scope.run(async () => undefined)).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
});
it("retains the owner lease when the transport's nested factory outcome is unknown", async () => {
  const f = fixture(), inner = vi.fn(() => { throw new Error("PRIVATE_INNER_FACTORY"); });
  const transport = new WhitelistAclSession(inner); f.factory.mockReturnValue(transport);
  await expect(f.scope.run((acl) => acl.verify("one"))).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  expect(transport.closedConfirmed).toBe(false); expect(inner).toHaveBeenCalledOnce();
  expect(f.state).toMatchObject({ mutation: true, releases: 0 });
});
