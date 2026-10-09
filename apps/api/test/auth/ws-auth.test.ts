import { randomUUID } from "node:crypto";
import { PassThrough, Writable } from "node:stream";
import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ServerStatus, WsMessage } from "@mcsm/contracts";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import type { LocalMinecraftServerAdapter } from "../../src/adapters/contract.js";
import { HttpAuthentication } from "../../src/auth/http-auth.js";
import { AuthAttemptWindow, PasswordVerifier, SCRYPT_PROFILE } from "../../src/auth/password.js";
import { SessionCore } from "../../src/auth/session-core.js";
import { WebSocketAuthentication } from "../../src/auth/ws-auth.js";
import { EventStreamService } from "../../src/services/event-stream-service.js";
import type { AuthAudit, AuthAuditEvent } from "../../src/auth/audit.js";

const ORIGIN = "http://127.0.0.1:3000";
const headers = { host: "127.0.0.1:8080", origin: ORIGIN, "x-manager-intent": "local-ui" };
const status: ServerStatus = { state: "stopped", ownership: "none", source: "process", observedAt: "2026-10-09T00:00:00.000Z", activeOperationId: null, recoveryRequired: false };
class Audit implements AuthAudit {
  healthy = true; events: AuthAuditEvent[] = []; before?: (event: AuthAuditEvent) => Promise<void>;
  ready() { return this.healthy; }
  async record(event: AuthAuditEvent) { await this.before?.(event); this.events.push(event); }
  async close() { this.healthy = false; }
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
async function fixture(run: (c: { app: ReturnType<typeof buildApp>; core: SessionCore; audit: Audit; raw: string; csrf: string; cookie: string;
  ticket: () => Promise<string>; advance: (ms: number) => void; snapshot: ReturnType<typeof vi.fn>; subscriptions: ReturnType<typeof vi.spyOn> }) => Promise<void>, pauseSnapshot?: Promise<void>,
  configure?: (app: ReturnType<typeof buildApp>) => void) {
  let now = 0; const core = new SessionCore(() => now); const audit = new Audit();
  const snapshot = vi.fn(async () => { await pauseSnapshot; return { streamId: "runtime-stream", latestSequence: 0, status, logs: [] }; });
  const adapter = { serverId: "server-a", mode: "local", subscribe: () => () => {}, streamSnapshot: snapshot, closeObserver: async () => {} } as unknown as LocalMinecraftServerAdapter;
  const verifier = new PasswordVerifier({ version: 1, username: "admin", revision: randomUUID(), salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }, new AuthAttemptWindow(() => now), async () => Buffer.from("cd".repeat(64), "hex"));
  const app = buildApp({ authentication: new HttpAuthentication(verifier, audit, core), adapters: [adapter], mode: "local" });
  const subscriptions = vi.spyOn(EventStreamService.prototype, "subscribe"); configure?.(app);
  const session = core.create("local-http"); const cookie = `mcsm_local_session=${session.sessionToken}`;
  const ticket = async () => {
    const response = await app.inject({ method: "POST", url: "/api/v1/auth/ws-ticket", headers: { ...headers, cookie, "x-csrf-token": session.csrfToken }, payload: { serverId: "server-a" } });
    expect(response.statusCode).toBe(200); return response.json().data.ticket as string;
  };
  try { await app.ready(); await run({ app, core, audit, raw: session.sessionToken, csrf: session.csrfToken, cookie, ticket, snapshot, subscriptions, advance: (ms) => { now += ms; } }); }
  finally { await app.close(); subscriptions.mockRestore(); }
}
const context = (cookie: string, ticket: string, ticketFirst = false) => ({ socket: { encrypted: false, authorized: false }, headers: {
  ...headers, cookie, "sec-websocket-protocol": ticketFirst ? `ticket.${ticket}, mcsm.events.v1` : `mcsm.events.v1, ticket.${ticket}`
} });

describe("authenticated event upgrades", () => {
  it.each([false, true])("101 selects only public protocol (ticket first=%s), sends hello/snapshot and consumes once", async (first) => fixture(async ({ app, ticket, cookie, audit }) => {
    const issued = await ticket(); const messages: WsMessage[] = []; const received = deferred();
    let responseHeaders = "";
    app.websocketServer.once("headers", (lines) => { responseHeaders = lines.join("\n"); });
    const socket = await app.injectWS("/ws/v1/servers/server-a/events", context(cookie, issued, first), { onInit: (client) => client.on("message", (data) => {
      messages.push(JSON.parse(data.toString()) as WsMessage); if (messages.length === 2) received.resolve();
    }) });
    await received.promise;
    expect(messages.map((value) => value.type)).toEqual(["hello", "snapshot"]);
    expect(responseHeaders).toContain("Sec-WebSocket-Protocol: mcsm.events.v1"); expect(responseHeaders).not.toContain(issued);
    await expect(app.injectWS("/ws/v1/servers/server-a/events", context(cookie, issued))).rejects.toThrow("403");
    expect(audit.events.some((event) => event.event === "ws-open")).toBe(true);
    const closed = new Promise<number>((resolve) => socket.once("close", resolve)); socket.close(); await closed;
  }));
  it.each(["no-cookie", "no-ticket", "extra", "duplicate-public", "wrong-server", "wrong-origin", "query-auth", "duplicate-cursor", "encoded-key", "unknown-query", "unsafe-sequence", "encoded", "ordinary"])("rejects %s before stream snapshot", async (variation) => fixture(async ({ app, cookie, ticket, snapshot, subscriptions }) => {
    const issued = await ticket(); const request = context(cookie, issued);
    let path = "/ws/v1/servers/server-a/events";
    if (variation === "no-cookie") request.headers.cookie = "";
    if (variation === "no-ticket") request.headers["sec-websocket-protocol"] = "mcsm.events.v1";
    if (variation === "extra") request.headers["sec-websocket-protocol"] += ", extra";
    if (variation === "duplicate-public") request.headers["sec-websocket-protocol"] = "mcsm.events.v1, mcsm.events.v1";
    if (variation === "wrong-server") path = "/ws/v1/servers/server-b/events";
    if (variation === "wrong-origin") request.headers.origin = "http://localhost:3000";
    if (variation === "query-auth") path += `?ticket=${issued}`;
    if (variation === "duplicate-cursor") path += "?streamId=runtime-stream&afterSequence=0&afterSequence=1";
    if (variation === "encoded-key") path += "?%73treamId=runtime-stream&afterSequence=0";
    if (variation === "unknown-query") path += "?streamId=runtime-stream&afterSequence=0&authorization=x";
    if (variation === "unsafe-sequence") path += "?streamId=runtime-stream&afterSequence=9007199254740992";
    if (variation === "encoded") path = "/ws/v1/servers/%73erver-a/events";
    if (variation === "ordinary") path = "/api/v1/health";
    await expect(app.injectWS(path, request)).rejects.toThrow(/400|403/u); expect(snapshot).not.toHaveBeenCalled(); expect(subscriptions).not.toHaveBeenCalled();
  }));
  it.each(["logout", "expiry", "audit"])("revocation during snapshot await prevents post-await delivery: %s", async (reason) => {
    const pause = deferred(); await fixture(async ({ app, cookie, ticket, raw, core, advance, audit, snapshot }) => {
      const messages: WsMessage[] = [];
      const socket = await app.injectWS("/ws/v1/servers/server-a/events", context(cookie, await ticket()), { onInit: (client) => client.on("message", (data) => messages.push(JSON.parse(data.toString()) as WsMessage)) });
      await vi.waitFor(() => expect(snapshot).toHaveBeenCalledOnce());
      const closed = new Promise<number>((resolve) => socket.once("close", resolve));
      if (reason === "logout") core.revoke(raw, "local-http");
      if (reason === "expiry") advance(30 * 60_000);
      if (reason === "audit") audit.healthy = false;
      pause.resolve(); expect(await closed).toBe(1008);
      expect(messages.map((message) => message.type)).toEqual(["hello"]);
    }, pause.promise);
  });
  it.each(["logout", "expiry", "audit"])("suspended upgrade audit rechecks before101: %s", async (reason) => fixture(async ({ app, ticket, cookie, raw, core, advance, audit, snapshot }) => {
    const issued = await ticket(); const started = deferred(); const release = deferred();
    audit.before = async (event) => { if (event.event === "ws-open") { started.resolve(); await release.promise; } };
    const pending = app.injectWS("/ws/v1/servers/server-a/events", context(cookie, issued));
    const rejected = expect(pending).rejects.toThrow(/401|403|503/u); await started.promise;
    if (reason === "logout") core.revoke(raw, "local-http");
    if (reason === "expiry") advance(30 * 60_000);
    if (reason === "audit") audit.healthy = false;
    release.resolve(); await rejected; expect(snapshot).not.toHaveBeenCalled();
  }));
  it.each(["logout", "expiry", "audit"])("actual upgrade waits for a child route hook then rechecks synchronously: %s", async (reason) => {
    const started = deferred(); const release = deferred();
    await fixture(async ({ app, cookie, ticket, core, raw, advance, audit, snapshot, subscriptions }) => {
      const pending = app.injectWS("/ws/v1/servers/server-a/events", context(cookie, await ticket()));
      const rejected = expect(pending).rejects.toThrow("401"); await started.promise;
      if (reason === "logout") core.revoke(raw, "local-http");
      if (reason === "expiry") advance(30 * 60_000);
      if (reason === "audit") audit.healthy = false;
      release.resolve(); await rejected; expect(snapshot).not.toHaveBeenCalled(); expect(subscriptions).not.toHaveBeenCalled();
    }, undefined, (app) => app.addHook("onRoute", (route) => {
      if (route.websocket) {
        const prior = route.preHandler;
        route.preHandler = [...(Array.isArray(prior) ? prior : prior ? [prior] : []), async () => { started.resolve(); await release.promise; }];
      }
    }));
  });
  it.each(["version8", "sec-websocket-origin", "origin", "cookie", "sec-websocket-protocol"])("rejects raw handshake ambiguity %s before subscription", async (kind) => fixture(async ({ app, cookie, ticket, snapshot, subscriptions }) => {
    app.server.prependOnceListener("upgrade", (request) => {
      if (kind === "version8") request.headers["sec-websocket-version"] = "8";
      else if (kind === "sec-websocket-origin") request.headers[kind] = ORIGIN;
      else request.rawHeaders = [kind, "first", kind.toUpperCase(), "second"];
    });
    await expect(app.injectWS("/ws/v1/servers/server-a/events", context(cookie, await ticket()))).rejects.toThrow("403");
    expect(snapshot).not.toHaveBeenCalled(); expect(subscriptions).not.toHaveBeenCalled();
  }));
  it.each(["expiry", "audit"])("closes silently idle sockets within the bounded health timer: %s", async (reason) => fixture(async ({ app, cookie, ticket, audit, advance }) => {
    const socket = await app.injectWS("/ws/v1/servers/server-a/events", context(cookie, await ticket()));
    const closed = new Promise<number>((resolve) => socket.once("close", resolve));
    if (reason === "expiry") advance(30 * 60_000); else audit.healthy = false;
    expect(await closed).toBe(1008);
  }));
  it("enforces four sockets, frees capacity after transport close and rotation closes remaining connections", async () => fixture(async ({ app, ticket, cookie, core, raw }) => {
    const sockets = [];
    for (let n = 0; n < 4; n++) sockets.push(await app.injectWS("/ws/v1/servers/server-a/events", context(cookie, await ticket())));
    await expect(app.injectWS("/ws/v1/servers/server-a/events", context(cookie, await ticket()))).rejects.toThrow("401");
    const serverSocket = [...app.websocketServer.clients][0]!;
    const serverClosed = new Promise<void>((resolve) => serverSocket.once("close", () => resolve()));
    const closed = new Promise<number>((resolve) => sockets[0]!.once("close", resolve));
    // injectWS uses paired in-memory Duplexify streams: close-frame receipt on
    // the client alone is not proof that the server transport has closed.
    sockets[0]!.terminate(); serverSocket.terminate(); await Promise.all([closed, serverClosed]);
    sockets[0] = await app.injectWS("/ws/v1/servers/server-a/events?streamId=runtime-stream&afterSequence=0", context(cookie, await ticket()));
    const revoked = sockets.map((socket) => new Promise<number>((resolve) => socket.once("close", resolve)));
    core.create("local-http", raw); expect(await Promise.all(revoked)).toEqual([1008, 1008, 1008, 1008]);
  }));
  it("explicit off status is minimal, guarded and no-store", async () => {
    const app = buildApp(); try {
      const response = await app.inject({ method: "GET", url: "/api/v1/auth/status", headers });
      expect(response.json()).toEqual({ data: { configured: false, authenticationRequired: false, auditReady: false } });
      expect(response.headers["cache-control"]).toBe("no-store");
      expect((await app.inject({ method: "GET", url: "/api/v1/auth/status", headers: { host: "evil.test" } })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
});

describe("final synchronous101 gate", () => {
  it("actual custom logger never serializes passwords, bearer cookies or ticket protocols", async () => {
    const chunks: string[] = [];
    const stream = new Writable({ write(chunk, _encoding, done) { chunks.push(String(chunk)); done(); } });
    const core = new SessionCore(() => 0); const audit = new Audit();
    const verifier = new PasswordVerifier({ version: 1, username: "admin", revision: randomUUID(), salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }, new AuthAttemptWindow(() => 0), async () => Buffer.from("cd".repeat(64), "hex"));
    const app = buildApp({ authentication: new HttpAuthentication(verifier, audit, core), mode: "local", logger: { level: "info", stream,
      serializers: { req: (request) => request, err: (error) => error } } });
    try {
      await app.ready();
      await app.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload: { username: "admin", password: "private-log-password" } });
      const session = core.create("local-http");
      const ticket = core.issueTicket(session.sessionToken, "local-http", "server-a", ORIGIN).ticket;
      await expect(app.injectWS("/ws/v1/servers/server-a/events?password=private-log-query", context(`mcsm_local_session=${session.sessionToken}`, ticket))).rejects.toThrow();
      const output = chunks.join(""); expect(output.length).toBeGreaterThan(0);
      for (const secret of ["private-log-password", "private-log-query", session.sessionToken, ticket]) expect(output).not.toContain(secret);
    } finally { await app.close(); stream.end(); }
  });
  it("denies HTTP service admission when final session pruning synchronously exhausts audit", async () => {
    let advanceLate = () => {}; const handler = vi.fn(() => ({ ok: true }));
    await fixture(async ({ app, cookie, ticket, core, audit, advance }) => {
      const socket = await app.injectWS("/ws/v1/servers/server-a/events", context(cookie, await ticket()));
      const closed = new Promise<number>((resolve) => socket.once("close", resolve));
      advance(30 * 60_000 - 500); const fresh = core.create("local-http");
      advanceLate = () => advance(500);
      const record = audit.record.bind(audit);
      audit.record = (event) => { if (event.event === "ws-revocation") audit.healthy = false; return record(event); };
      const response = await app.inject({ method: "GET", url: "/api/v1/prune-gate", headers: { ...headers, cookie: `mcsm_local_session=${fresh.sessionToken}` } });
      expect(response.statusCode).toBe(503); expect(response.json().error.code).toBe("AUTH_AUDIT_UNAVAILABLE");
      expect(handler).not.toHaveBeenCalled(); expect(await closed).toBe(1008);
    }, undefined, (app) => { app.get("/api/v1/prune-gate", { preHandler: async () => advanceLate() }, handler); });
  });
  it("live delivery fails closed when pruning another expired session exhausts audit", async () => {
    let time = 0; const core = new SessionCore(() => time); const audit = new Audit();
    const auth = new WebSocketAuthentication(core, audit); const transports: PassThrough[] = [];
    const attach = async (token: string) => {
      const transport = new PassThrough(); transports.push(transport);
      const raw = { method: "GET", url: "/ws/v1/servers/server-a/events", headers: {
        ...context(`mcsm_local_session=${token}`, core.issueTicket(token, "local-http", "server-a", ORIGIN).ticket).headers,
        upgrade: "websocket", "sec-websocket-version": "13" }, rawHeaders: [] } as unknown as IncomingMessage;
      await auth.prepare({ raw, headers: raw.headers, method: "GET", id: randomUUID() } as FastifyRequest, { raw: { socket: transport } } as FastifyReply);
      expect(auth.verify(raw)).toBe(true);
      const socket = Object.assign(new EventEmitter(), { close: vi.fn() }); const cleanup = vi.fn();
      return { live: auth.attach(raw, socket as unknown as WebSocket, cleanup)!, socket, cleanup };
    };
    await attach(core.create("local-http").sessionToken); time = 30 * 60_000 - 500;
    const fresh = await attach(core.create("local-http").sessionToken);
    const record = audit.record.bind(audit);
    audit.record = (event) => { if (event.event === "ws-revocation") audit.healthy = false; return record(event); };
    time += 500;
    expect(fresh.live()).toBe(false); expect(fresh.cleanup).toHaveBeenCalledTimes(1);
    expect(fresh.socket.close).toHaveBeenCalledWith(1008, "authentication-required");
    auth.close(); for (const transport of transports) transport.destroy();
  });
  it("rejects when synchronous pruning exhausts audit during final ticket consumption", async () => {
    let time = 0;
    const core = new SessionCore(() => time); const audit = new Audit();
    const auth = new WebSocketAuthentication(core, audit);
    const old = core.create("local-http"); const oldTransport = new PassThrough();
    const make = (token: string, transport: PassThrough) => {
      const raw = { method: "GET", url: "/ws/v1/servers/server-a/events", headers: {
        ...context(`mcsm_local_session=${token}`, core.issueTicket(token, "local-http", "server-a", ORIGIN).ticket).headers,
        upgrade: "websocket", "sec-websocket-version": "13" }, rawHeaders: [] } as unknown as IncomingMessage;
      return { raw, request: { raw, headers: raw.headers, method: "GET", id: randomUUID() } as FastifyRequest,
        reply: { raw: { socket: transport } } as FastifyReply };
    };
    const first = make(old.sessionToken, oldTransport);
    await auth.prepare(first.request, first.reply); expect(auth.verify(first.raw)).toBe(true);
    time = 30 * 60_000 - 500;
    const fresh = core.create("local-http"); const transport = new PassThrough();
    const next = make(fresh.sessionToken, transport); await auth.prepare(next.request, next.reply);
    const record = audit.record.bind(audit);
    audit.record = (event) => {
      if (event.event === "ws-revocation") audit.healthy = false;
      return record(event);
    };
    time += 500;
    expect(auth.verify(next.raw)).toBe(false);
    expect(audit.healthy).toBe(false);
    // Rejected upgrades cannot consume the new session's live socket allowance.
    for (let n = 0; n < 4; n++) core.reserveSocket(fresh.sessionToken, "local-http", `free-${n}`);
    auth.close(); oldTransport.destroy(); transport.destroy();
  });
  function setup() {
    let time = 0; const core = new SessionCore(() => time); const audit = new Audit(); const auth = new WebSocketAuthentication(core, audit);
    const session = core.create("local-http"); const transport = new PassThrough();
    const raw = { method: "GET", url: "/ws/v1/servers/server-a/events", headers: { ...context(`mcsm_local_session=${session.sessionToken}`, core.issueTicket(session.sessionToken, "local-http", "server-a", ORIGIN).ticket).headers,
      upgrade: "websocket", "sec-websocket-version": "13" }, rawHeaders: [] } as unknown as IncomingMessage;
    const request = { raw, headers: raw.headers, method: "GET", id: randomUUID() } as FastifyRequest;
    const reply = { raw: { socket: transport } } as FastifyReply;
    return { core, audit, auth, session, transport, raw, request, reply, advance: () => { time = 30 * 60_000; } };
  }
  it.each(["logout", "expiry", "audit", "version8", "duplicate-origin", "duplicate-cookie", "duplicate-protocol"])("checks after all async hooks: %s", async (reason) => {
    const c = setup(); await c.auth.prepare(c.request, c.reply);
    if (reason === "logout") c.core.revoke(c.session.sessionToken, "local-http");
    if (reason === "expiry") c.advance();
    if (reason === "audit") c.audit.healthy = false;
    if (reason === "version8") c.raw.headers["sec-websocket-version"] = "8";
    const name = reason.slice(10); if (reason.startsWith("duplicate-")) c.raw.rawHeaders = [name === "protocol" ? "Sec-WebSocket-Protocol" : name, "one", name === "protocol" ? "sec-websocket-protocol" : name, "two"];
    expect(c.auth.verify(c.raw)).toBe(false); c.auth.close(); c.transport.destroy();
  });
  it("aborted101 releases the reservation on raw transport close and permits replacement", async () => {
    const c = setup(); await c.auth.prepare(c.request, c.reply); expect(c.auth.verify(c.raw)).toBe(true);
    const closed = new Promise<void>((resolve) => c.transport.once("close", resolve)); c.transport.destroy(); await closed;
    for (let n = 0; n < 4; n++) c.core.reserveSocket(c.session.sessionToken, "local-http", `replacement-${n}`);
    c.auth.close();
  });
});
