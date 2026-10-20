import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { syntheticFixture } from "./whitelist-synthetic-fixture.js";
import { WhitelistRconCoordinator, type WhitelistRconObservations, type WhitelistRconRules } from "../src/services/whitelist-rcon-coordinator.js";
import { OperationService } from "../src/services/operation-service.js";
import { WhitelistCommandStore } from "../src/services/whitelist-command-store.js";
import { WhitelistGuardStore } from "../src/services/whitelist-guard-store.js";
import { buildApp } from "../src/app.js";
import { HttpAuthentication } from "../src/auth/http-auth.js";
import { SessionCore } from "../src/auth/session-core.js";
import { PasswordVerifier, SCRYPT_PROFILE } from "../src/auth/password.js";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) {
  if (!root.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(root).startsWith("mcsm-whitelist-integration-")) throw new Error("cleanup-boundary");
  await rm(root, { recursive: true, force: true });
} });
const allow = () => undefined;
async function fixture() {
  const f = await syntheticFixture(); roots.push(f.root);
  let lost = false, calls = 0, closes = 0;
  let afterList: () => void = () => {};
  let beforeSend: () => Promise<void> = async () => {};
  const observations: WhitelistRconObservations = {
    registeredRoot: serverId => f.runtime.registeredRoot(serverId),
    capture: async (serverId, session) => {
      if (session.runtimeId !== f.runtime.runtimeId) throw new Error("wrong-generation");
      return f.runtime.capture(serverId);
    },
    open: async serverId => {
      if (serverId !== "test") throw new Error("wrong-server");
      const runtimeId = f.runtime.runtimeId; let closed = false;
      const execute = async (action: "add" | "remove", name: string, authorize: () => undefined) => {
        await beforeSend();
        if (closed || runtimeId !== f.runtime.runtimeId) throw new Error("wrong-generation");
        authorize(); calls++;
        if (action === "add") f.runtime.members.push({ name, uuid: "123e4567-e89b-42d3-a456-426614174001" });
        else f.runtime.members = f.runtime.members.filter(row => row.name.toLowerCase() !== name.toLowerCase());
        f.runtime.generation++;
        if (lost) throw new Error("fake-response-lost");
        return `FAKE ${action} ${name}`;
      };
      return { runtimeId, list: async () => { const response = JSON.stringify(f.runtime.members.map(row => row.name)); afterList(); return response; },
        add: (name, authorize) => execute("add", name, authorize), remove: (name, authorize) => execute("remove", name, authorize),
        close: () => { closed = true; closes++; } };
    }
  };
  // Deliberately NOT a Minecraft grammar. Production has no default rule factory.
  const rules: WhitelistRconRules = { id: "vanilla-26.3-rcon-v1", parseList: response => JSON.parse(response) as string[],
    verifyMutation: (request, response) => { if (response !== `FAKE ${request.action} ${request.name}`) throw new Error("wrong-response"); } };
  const open = async (pub = f.publication) => {
    const operations = new OperationService(f.opStore, f.clock); await operations.initialize();
    const commands = await WhitelistCommandStore.open(f.root, f.owner, f.acl, pub), guards = await WhitelistGuardStore.open(f.root, f.owner, f.acl, pub);
    const service = new WhitelistRconCoordinator(operations, commands, guards, observations, rules, f.clock, f.owner); await service.initialize();
    return { operations, commands, guards, service };
  };
  return { ...f, open, observations, rules, calls: () => calls, closes: () => closes,
    loseResponse: () => { lost = true; }, beforeSend: (fn: () => Promise<void>) => { beforeSend = fn; },
    afterList: (fn: () => void) => { afterList = fn; } };
}
async function terminal(operations: OperationService, id: string) {
  await vi.waitFor(() => { expect(["succeeded", "failed", "interrupted"]).toContain(operations.get(id)?.state);
    expect(operations.getServerState("test").activeOperationId).toBeNull(); }); return operations.get(id)!;
}
it("adds/removes through recorded intent and two exact guards, preserving replay after restart", async () => {
  const f = await fixture(), s = await f.open(), request = f.request(), key = randomUUID();
  const op = await s.service.submit("test", request, key, allow);
  expect((await terminal(s.operations, op.id)).state).toBe("succeeded");
  expect((await s.commands.scan())[0]!.at(-1)!.rconEvidence?.response).toBe("FAKE add Player_Two");
  expect((await s.guards.scan()).length).toBe(2);
  const removed = await s.service.submit("test", f.request("remove"), randomUUID(), allow);
  expect((await terminal(s.operations, removed.id)).state).toBe("succeeded");
  const reopened = await f.open();
  expect(reopened.operations.getServerState("test").recoveryRequired).toBe(false);
  expect((await reopened.service.submit("test", request, key, allow)).id).toBe(op.id);
  expect(f.calls()).toBe(2); expect(f.activities()).toBe(0);
});
it("does not resend a lost response even when the desired member exists", async () => {
  const f = await fixture(), s = await f.open(), request = f.request(), key = randomUUID(); f.loseResponse();
  const op = await s.service.submit("test", request, key, allow);
  expect((await terminal(s.operations, op.id)).state).toBe("interrupted");
  expect(f.runtime.members).toHaveLength(2);
  const reopened = await f.open();
  await expect(reopened.service.recover("test", op.id, allow)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  expect((await reopened.service.submit("test", request, key, allow)).id).toBe(op.id);
  expect(f.calls()).toBe(1); expect(reopened.operations.getServerState("test").recoveryRequired).toBe(true);
});
it("recovers complete evidence after terminal persistence failure without dispatch", async () => {
  const f = await fixture(), s = await f.open(); f.opStore.failSuccessOnce = true;
  const op = await s.service.submit("test", f.request(), randomUUID(), allow);
  expect((await terminal(s.operations, op.id)).state).toBe("interrupted");
  const reopened = await f.open();
  expect((await reopened.service.recover("test", op.id, allow)).state).toBe("succeeded");
  expect(f.calls()).toBe(1);
});
it("rejects illegal names and expired admission without operation or command writes", async () => {
  const f = await fixture(), s = await f.open();
  await expect(s.service.submit("test", { ...f.request(), name: "bad;stop" }, randomUUID(), allow)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await expect(s.service.submit("test", f.request(), randomUUID(), () => { throw new Error("expired"); })).rejects.toThrow("expired");
  expect(f.writes()).toBe(0); expect(f.calls()).toBe(0); expect(await f.opStore.list()).toEqual([]);
});
it("detects generation drift before dispatch and leaves recovery evidence", async () => {
  const f = await fixture(), s = await f.open(); f.beforeSend(async () => { f.runtime.runtimeId = randomUUID(); });
  const op = await s.service.submit("test", f.request(), randomUUID(), allow);
  expect((await terminal(s.operations, op.id)).state).toBe("interrupted"); expect(f.calls()).toBe(0);
});
it("rejects lifecycle concurrency and same-key conflicting requests", async () => {
  const f = await fixture(), s = await f.open(); let release!: () => void, entered!: () => void;
  const active = new Promise<void>(resolve => { entered = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
  f.beforeSend(async () => { entered(); await wait; }); const key = randomUUID();
  const op = await s.service.submit("test", f.request(), key, allow); await active;
  try {
    await expect(s.operations.requestLifecycle("test", "stop", randomUUID(), async () => {})).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    await expect(s.service.submit("test", f.request("add", "Other_User"), key, allow)).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
  } finally { release(); await terminal(s.operations, op.id); }
  expect(f.calls()).toBe(1);
});
it("integrates HTTP auth/CSRF/strict DTO/idempotency/operation query with no anonymous writes", async () => {
  const f = await fixture(), opened = await f.open(), sessions = new SessionCore();
  const auth = new HttpAuthentication(new PasswordVerifier({ version: 1, username: "fixture", revision: randomUUID(),
    salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }),
    { ready: () => true, record: async () => {}, close: async () => {} }, sessions);
  const app = buildApp({ mode: "local", clock: f.clock, operationStore: f.opStore, authentication: auth,
    whitelistMembers: operations => new WhitelistRconCoordinator(operations, opened.commands, opened.guards, f.observations, f.rules, f.clock, f.owner) });
  try {
    const url = "/api/v1/servers/test/whitelist/members", body = f.request(), key = randomUUID();
    const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:8080", "x-manager-intent": "local-ui", "idempotency-key": key };
    expect((await app.inject({ method: "POST", url, headers, payload: body })).statusCode).toBe(401);
    const token = sessions.create("local-http"), loggedIn = { ...headers, cookie: `mcsm_local_session=${token.sessionToken}`, "x-csrf-token": token.csrfToken };
    expect((await app.inject({ method: "POST", url, headers: { ...loggedIn, "x-csrf-token": "invalid" }, payload: body })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url, headers: loggedIn, payload: { ...body, command: "stop" } })).statusCode).toBe(400);
    expect(f.calls()).toBe(0); expect(await f.opStore.list()).toEqual([]);
    const submitted = await app.inject({ method: "POST", url, headers: loggedIn, payload: body });
    expect(submitted.statusCode).toBe(202); const id = submitted.json().data.operation.id as string;
    await vi.waitFor(async () => {
      const result = await app.inject({ method: "GET", url: `/api/v1/operations/${id}`, headers: { host: headers.host, cookie: loggedIn.cookie } });
      expect(result.statusCode).toBe(200); expect(result.json().data.state).toBe("succeeded");
    });
    expect((await app.inject({ method: "POST", url, headers: loggedIn, payload: body })).json().data.operation.id).toBe(id);
    expect((await app.inject({ method: "POST", url, headers: loggedIn, payload: { ...body, name: "Other_User" } })).statusCode).toBe(409);
    expect(f.calls()).toBe(1);
    f.opStore.failSuccessOnce = true;
    const removed = await app.inject({ method: "POST", url, headers: { ...loggedIn, "idempotency-key": randomUUID() }, payload: f.request("remove") });
    expect(removed.statusCode).toBe(202); const removeId = removed.json().data.operation.id as string;
    await vi.waitFor(async () => {
      const result = await app.inject({ method: "GET", url: `/api/v1/operations/${removeId}`, headers: { host: headers.host, cookie: loggedIn.cookie } });
      expect(result.json().data.state).toBe("interrupted");
    });
    const recovery = await app.inject({ method: "POST", url: "/api/v1/servers/test/whitelist/recover", headers: loggedIn,
      payload: { operationId: removeId, confirm: true } });
    expect(recovery.statusCode).toBe(200); expect(recovery.json().data.operation.state).toBe("succeeded"); expect(f.calls()).toBe(2);
  } finally { await app.close(); }
});
it("rejects async mutation rules during live verification and historical recovery without unhandled rejection", async () => {
  const f = await fixture(), s = await f.open();
  const op = await s.service.submit("test", f.request(), randomUUID(), allow);
  expect((await terminal(s.operations, op.id)).state).toBe("succeeded");
  f.rules.verifyMutation = async () => { throw new Error("async-rule-invalid"); };
  const reopened = await f.open();
  await expect(reopened.service.recover("test", op.id, allow)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  expect(reopened.operations.getServerState("test").recoveryRequired).toBe(true); expect(f.calls()).toBe(1);
  const g = await fixture(), other = await g.open();
  g.rules.verifyMutation = async () => { throw new Error("async-rule-invalid"); };
  const live = await other.service.submit("test", g.request(), randomUUID(), allow);
  expect((await terminal(other.operations, live.id)).state).toBe("interrupted");
  expect((await other.commands.scan())[0]!.at(-1)!.rconEvidence).toBeUndefined(); expect(g.calls()).toBe(1);
});
it("rejects invalid async list parsing instead of accepting it or leaking a rejected Promise", async () => {
  const f = await fixture(), s = await f.open();
  f.rules.parseList = (() => Promise.reject(new Error("async-list-invalid"))) as unknown as WhitelistRconRules["parseList"];
  await expect(s.service.prepare("test")).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  expect(f.calls()).toBe(0);
});
it("detects file changes during the runtime list observation before archiving success", async () => {
  const f = await fixture(), s = await f.open();
  f.afterList(() => { f.runtime.generation++; });
  await expect(s.service.prepare("test")).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  const op = await s.service.submit("test", f.request(), randomUUID(), allow);
  expect((await terminal(s.operations, op.id)).state).toBe("interrupted");
  expect((await s.guards.scan()).length).toBe(1); expect((await s.commands.scan())[0]!.at(-1)!.rconEvidence).toBeUndefined();
});
it("retains recovery for a durable operation's before-guard when command admission failed", async () => {
  const f = await fixture(), s = await f.open(); vi.spyOn(s.commands, "admit").mockRejectedValue(new Error("before-intent-fault"));
  const op = await s.service.submit("test", f.request(), randomUUID(), allow);
  expect((await terminal(s.operations, op.id)).state).toBe("interrupted");
  expect((await s.guards.scan()).length).toBe(1); expect(await s.commands.scan()).toEqual([]);
  const reopened = await f.open();
  expect(reopened.operations.getServerState("test").recoveryRequired).toBe(true);
  await expect(reopened.service.recover("test", op.id, allow)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  expect(f.calls()).toBe(0);
});
it("keeps the local application available when member evidence initialization is unsafe", async () => {
  const f = await fixture(), s = await f.open();
  const app = buildApp({ mode: "local", clock: f.clock, operationStore: f.opStore, whitelistMembers: operations => {
    const service = new WhitelistRconCoordinator(operations, s.commands, s.guards, f.observations, f.rules, f.clock, f.owner);
    vi.spyOn(service, "initialize").mockRejectedValue(new Error("private-evidence-unsafe")); return service;
  } });
  try {
    expect((await app.inject({ method: "GET", url: "/api/v1/health", headers: { host: "127.0.0.1:8080" } })).statusCode).toBe(200);
    expect(f.calls()).toBe(0);
  } finally { await app.close(); }
});
