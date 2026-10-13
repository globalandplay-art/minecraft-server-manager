import { randomUUID } from "node:crypto";
import fastify from "fastify";
import websocket from "@fastify/websocket";
import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { systemClock } from "../../src/clock.js";
import { HttpAuthentication } from "../../src/auth/http-auth.js";
import { AuthAttemptWindow, PasswordVerifier, SCRYPT_PROFILE } from "../../src/auth/password.js";
import { SessionCore } from "../../src/auth/session-core.js";
import { EVENTS_PROTOCOL } from "../../src/auth/ws-auth.js";
import { TailscaleIngressBoundary } from "../../src/auth/tailscale-ingress-boundary.js";
import type { AuthAudit, AuthAuditEvent } from "../../src/auth/audit.js";

const host = "manager.example-tail.ts.net";
const origin = `https://${host}`;
const headers = { host, origin, "x-manager-intent": "local-ui" };
const credentials = { username: "admin", password: "a sufficiently long test password" };
class Audit implements AuthAudit {
  healthy = true; before?: (event: AuthAuditEvent) => Promise<void>;
  ready() { return this.healthy; }
  async record(event: AuthAuditEvent) { await this.before?.(event); }
  async close() { this.healthy = false; }
}
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
async function fixture(run: (f: {
  remote: ReturnType<typeof fastify>; local: ReturnType<typeof buildApp>; boundary: TailscaleIngressBoundary;
  core: SessionCore; audit: Audit; auth: HttpAuthentication; writes: () => number;
  advance: (ms: number) => void;
  holdLocalClose: (hook: () => Promise<void>) => void;
  login: () => Promise<{ cookie: string; csrf: string }>;
}) => Promise<void>) {
  let now = 0; const core = new SessionCore(() => now); const audit = new Audit();
  const verifier = new PasswordVerifier({ version: 1, username: "admin", revision: randomUUID(), salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }, new AuthAttemptWindow(), async () => Buffer.from("cd".repeat(64), "hex"));
  const auth = new HttpAuthentication(verifier, audit, core);
  const local = buildApp({ authentication: auth });
  let localClosing: (() => Promise<void>) | undefined;
  local.addHook("preClose", async () => { await localClosing?.(); });
  const remote = fastify({ logger: false, trustProxy: false });
  const boundary = new TailscaleIngressBoundary(host);
  void remote.register(websocket, { options: {
    verifyClient: ({ req }) => auth.websocket.verify(req),
    handleProtocols: (protocols) => protocols.has(EVENTS_PROTOCOL) ? EVENTS_PROTOCOL : false
  } });
  auth.installRemote(remote, systemClock, "mock", boundary);
  let writes = 0;
  remote.post("/api/v1/protected", async (request) => { auth.assertRecentMutation(request); writes++; return { ok: true }; });
  void remote.register(async (app) => {
    app.get("/ws/v1/servers/server-a/events", { websocket: true, preValidation: auth.websocket.prepare.bind(auth.websocket) }, (socket, request) => {
      const live = auth.websocket.attach(request.raw, socket, () => {});
      if (live?.()) socket.send("ready");
    });
  });
  const login = async () => {
    const response = await remote.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload: credentials, remoteAddress: "127.0.0.1" });
    expect(response.statusCode).toBe(200);
    const cookie = String(response.headers["set-cookie"]).split(";", 1)[0]!;
    return { cookie, csrf: response.json().data.csrfToken as string };
  };
  try { await remote.ready(); await local.ready(); await run({ remote, local, boundary, core, audit, auth, writes: () => writes, login, advance: (ms) => { now += ms; }, holdLocalClose: (hook) => { localClosing = hook; } }); }
  finally { await remote.close(); await local.close(); }
}
describe("isolated remote authentication integration; production unwired", () => {
  it("default closed prevents login; opening emits secure host-only cookie and serves authenticated reads", async () => fixture(async ({ remote, boundary, login }) => {
    expect((await remote.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload: credentials, remoteAddress: "127.0.0.1" })).statusCode).toBe(403);
    boundary.open(); const session = await login(); expect(session.cookie).toMatch(/^__Host-mcsm_remote_session=/);
    const read = await remote.inject({ url: "/api/v1/auth/session", headers: { ...headers, cookie: session.cookie }, remoteAddress: "127.0.0.1" });
    expect(read.statusCode).toBe(200); expect(read.json().data.authenticated).toBe(true);
    const response = await remote.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload: credentials, remoteAddress: "127.0.0.1" });
    expect(response.headers["set-cookie"]).toContain("Secure; HttpOnly; SameSite=Strict; Path=/");
    expect(response.headers["set-cookie"]).not.toContain("Domain=");
  }));
  it("local and remote cookies and session tokens cannot be substituted in either direction", async () => fixture(async ({ remote, local, boundary, core, login }) => {
    boundary.open(); const remoteSession = await login(); const localSession = core.create("local-http");
    for (const cookie of [`mcsm_local_session=${localSession.sessionToken}`, `__Host-mcsm_remote_session=${localSession.sessionToken}`]) {
      expect((await remote.inject({ url: "/api/v1/auth/session", headers: { ...headers, cookie }, remoteAddress: "127.0.0.1" })).statusCode).toBe(401);
    }
    for (const cookie of [remoteSession.cookie, remoteSession.cookie.replace("__Host-mcsm_remote_session", "mcsm_local_session")]) {
      expect((await local.inject({ url: "/api/v1/auth/session", headers: { host: "127.0.0.1:8080", cookie } })).statusCode).toBe(401);
    }
  }));
  it("Tail identity headers never replace login and direct local ingress rejects remote host/forwarding", async () => fixture(async ({ remote, local, boundary, writes }) => {
    boundary.open();
    expect((await remote.inject({ method: "POST", url: "/api/v1/protected", headers: { ...headers, "tailscale-user-login": "admin" }, payload: {}, remoteAddress: "127.0.0.1" })).statusCode).toBe(401);
    expect((await local.inject({ url: "/api/v1/auth/session", headers: { host, "x-forwarded-proto": "https" } })).statusCode).toBe(403);
    expect(writes()).toBe(0);
  }));
  it("requires CSRF and recent reauthentication for protected writes", async () => fixture(async ({ remote, boundary, login, writes, advance }) => {
    boundary.open(); const s = await login(); const request = { method: "POST" as const, url: "/api/v1/protected", headers: { ...headers, cookie: s.cookie }, payload: {}, remoteAddress: "127.0.0.1" };
    expect((await remote.inject(request)).statusCode).toBe(403);
    advance(5 * 60_000 + 1); // Login is already recent authentication under the existing contract.
    expect((await remote.inject({ ...request, headers: { ...request.headers, "x-csrf-token": s.csrf } })).statusCode).toBe(403);
    expect(writes()).toBe(0);
    expect((await remote.inject({ ...request, url: "/api/v1/auth/reauth", headers: { ...request.headers, "x-csrf-token": s.csrf }, payload: credentials })).statusCode).toBe(200);
    expect((await remote.inject({ ...request, headers: { ...request.headers, "x-csrf-token": s.csrf } })).statusCode).toBe(200);
    expect(writes()).toBe(1);
  }));
  it("closing while mutation audit awaits blocks final admission, even after reopen", async () => fixture(async ({ remote, boundary, login, audit, writes }) => {
    boundary.open(); const s = await login(); const started = deferred(); const release = deferred();
    audit.before = async (event) => { if (event.event === "mutation-admission") { started.resolve(); await release.promise; } };
    const pending = remote.inject({ method: "POST", url: "/api/v1/protected", headers: { ...headers, cookie: s.cookie, "x-csrf-token": s.csrf }, payload: {}, remoteAddress: "127.0.0.1" });
    try {
      await started.promise; boundary.close(); boundary.open(); release.resolve();
      expect((await pending).statusCode).not.toBe(200); expect(writes()).toBe(0);
    } finally { release.resolve(); await pending; }
  }));
  it("closing during login audit prevents cookies, revokes remote sessions and preserves local administration", async () => fixture(async ({ remote, local, boundary, core, audit }) => {
    boundary.open(); const s = core.create("local-http");
    audit.before = async (event) => { if (event.event === "login-success") { boundary.close(); boundary.open(); } };
    const response = await remote.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload: credentials, remoteAddress: "127.0.0.1" });
    expect(response.statusCode).toBe(503); expect(response.headers["set-cookie"]).toBeUndefined();
    await remote.close(); expect(audit.ready()).toBe(true);
    expect((await local.inject({ url: "/api/v1/auth/session", headers: { host: "127.0.0.1:8080", cookie: `mcsm_local_session=${s.sessionToken}` } })).statusCode).toBe(200);
  }));
  it("remote logout clears secure cookie without revoking local sessions", async () => fixture(async ({ remote, boundary, core, login }) => {
    boundary.open(); const local = core.create("local-http"); const s = await login();
    const response = await remote.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { ...headers, cookie: s.cookie, "x-csrf-token": s.csrf }, payload: {}, remoteAddress: "127.0.0.1" });
    expect(response.statusCode).toBe(200); expect(response.headers["set-cookie"]).toContain("Max-Age=0; Secure; HttpOnly");
    expect(core.read(local.sessionToken, "local-http")).toBeDefined();
    expect((await remote.inject({ url: "/api/v1/auth/session", headers: { ...headers, cookie: s.cookie }, remoteAddress: "127.0.0.1" })).statusCode).toBe(401);
  }));
  it("local lifetime close irrevocably denies pending and new remote admissions before audit disposal", async () => fixture(async ({ remote, local, boundary, audit, login, writes, holdLocalClose }) => {
    boundary.open(); const s = await login();
    const loginWaiting = deferred(); const resumeLogin = deferred(); const closing = deferred(); const resumeClose = deferred();
    audit.before = async (event) => { if (event.event === "login-success") { loginWaiting.resolve(); await resumeLogin.promise; } };
    holdLocalClose(async () => { closing.resolve(); await resumeClose.promise; });
    const pending = remote.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload: credentials, remoteAddress: "127.0.0.1" });
    let closingLocal: Promise<void> | undefined;
    try {
      await loginWaiting.promise; closingLocal = local.close(); await closing.promise;
      expect(audit.ready()).toBe(true); expect(boundary.admitting).toBe(false);
      boundary.open(); // Reopening the shape controller cannot resurrect its retired owner.
      expect((await remote.inject({ method: "POST", url: "/api/v1/protected", headers: { ...headers, cookie: s.cookie, "x-csrf-token": s.csrf }, payload: {}, remoteAddress: "127.0.0.1" })).statusCode).toBe(403);
      expect((await remote.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload: credentials, remoteAddress: "127.0.0.1" })).statusCode).toBe(403);
      resumeLogin.resolve(); const result = await pending; expect(result.statusCode).toBe(503); expect(result.headers["set-cookie"]).toBeUndefined(); expect(writes()).toBe(0);
    } finally {
      resumeLogin.resolve(); resumeClose.resolve(); await pending; await closingLocal;
    }
  }));
  it("remote WebSocket uses same core, consumes ticket once and closes when ingress closes", async () => fixture(async ({ remote, boundary, login }) => {
    boundary.open(); const s = await login();
    const issued = await remote.inject({ method: "POST", url: "/api/v1/auth/ws-ticket", headers: { ...headers, cookie: s.cookie, "x-csrf-token": s.csrf }, payload: { serverId: "server-a" }, remoteAddress: "127.0.0.1" });
    expect(issued.statusCode).toBe(200);
    const context = { socket: { remoteAddress: "127.0.0.1" }, headers: { ...headers, cookie: s.cookie, "sec-websocket-protocol": `${EVENTS_PROTOCOL}, ticket.${issued.json().data.ticket}` } };
    const wireContext = { ...context, rawHeaders: Object.entries(context.headers).flat() };
    const received = deferred(); const socket = await remote.injectWS("/ws/v1/servers/server-a/events", wireContext, { onInit: (client) => client.on("message", () => received.resolve()) });
    await received.promise;
    await expect(remote.injectWS("/ws/v1/servers/server-a/events", wireContext)).rejects.toThrow();
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve())); boundary.close(); await closed;
  }));
  it("wrong origin, missing login and forged identity cannot obtain WebSocket admission", async () => fixture(async ({ remote, boundary }) => {
    boundary.open();
    for (const requestOrigin of [origin, "https://attacker.invalid"]) {
      const wireHeaders = { ...headers, origin: requestOrigin, "tailscale-user-login": "admin", "sec-websocket-protocol": EVENTS_PROTOCOL };
      await expect(remote.injectWS("/ws/v1/servers/server-a/events", { socket: { remoteAddress: "127.0.0.1" }, headers: wireHeaders, rawHeaders: Object.entries(wireHeaders).flat() })).rejects.toThrow();
    }
  }));
  it("closing during awaited WebSocket audit prevents 101 even after reopen", async () => fixture(async ({ remote, boundary, login, audit }) => {
    boundary.open(); const s = await login();
    const issued = await remote.inject({ method: "POST", url: "/api/v1/auth/ws-ticket", headers: { ...headers, cookie: s.cookie, "x-csrf-token": s.csrf }, payload: { serverId: "server-a" }, remoteAddress: "127.0.0.1" });
    expect(issued.statusCode).toBe(200);
    audit.before = async (event) => { if (event.event === "ws-open") { boundary.close(); boundary.open(); } };
    const wireHeaders = { ...headers, cookie: s.cookie, "sec-websocket-protocol": `${EVENTS_PROTOCOL}, ticket.${issued.json().data.ticket}` };
    await expect(remote.injectWS("/ws/v1/servers/server-a/events", { socket: { remoteAddress: "127.0.0.1" }, headers: wireHeaders, rawHeaders: Object.entries(wireHeaders).flat() })).rejects.toThrow();
  }));
  it("remote cookie duplicates and expired sessions reject without business side effects", async () => fixture(async ({ remote, boundary, login, advance, writes }) => {
    boundary.open(); const s = await login();
    expect((await remote.inject({ url: "/api/v1/auth/session", headers: { ...headers, cookie: `${s.cookie}; ${s.cookie}` }, remoteAddress: "127.0.0.1" })).statusCode).toBe(401);
    advance(30 * 60_000 + 1);
    expect((await remote.inject({ url: "/api/v1/auth/session", headers: { ...headers, cookie: s.cookie }, remoteAddress: "127.0.0.1" })).statusCode).toBe(401); expect(writes()).toBe(0);
  }));
  it("audit unavailability denies remote reads and writes without changing local permission checks", async () => fixture(async ({ remote, boundary, login, audit, writes }) => {
    boundary.open(); const s = await login(); audit.healthy = false;
    expect((await remote.inject({ url: "/api/v1/auth/session", headers: { ...headers, cookie: s.cookie }, remoteAddress: "127.0.0.1" })).statusCode).toBe(503);
    expect((await remote.inject({ method: "POST", url: "/api/v1/protected", headers: { ...headers, cookie: s.cookie, "x-csrf-token": s.csrf }, payload: {}, remoteAddress: "127.0.0.1" })).statusCode).toBe(503); expect(writes()).toBe(0);
  }));
});
