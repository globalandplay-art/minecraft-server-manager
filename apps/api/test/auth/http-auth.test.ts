import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { buildApp, type BuildAppOptions } from "../../src/app.js";
import { TransactionJournalStore } from "../../src/services/transaction-journal.js";
import { AuthAttemptWindow, PasswordVerifier, SCRYPT_PROFILE } from "../../src/auth/password.js";
import { HttpAuthentication } from "../../src/auth/http-auth.js";
import { SessionCore } from "../../src/auth/session-core.js";
import type { AuthAudit, AuthAuditEvent } from "../../src/auth/audit.js";

const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui" };
const input = { username: "admin", password: "a sufficiently long password" };
const record = { version: 1 as const, username: "admin", revision: randomUUID(), salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE };
class Audit implements AuthAudit {
  events: AuthAuditEvent[] = []; healthy = true; fail = false;
  beforeRecord?: (event: AuthAuditEvent) => Promise<void>;
  ready() { return this.healthy; }
  async record(event: AuthAuditEvent) { await this.beforeRecord?.(event); if (this.fail) { this.healthy = false; throw new Error("private-secret-path"); } this.events.push(event); }
  async close() { this.healthy = false; }
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}
async function fixture(run: (context: { app: ReturnType<typeof buildApp>; audit: Audit; advance: (ms: number) => void;
  sessions: SessionCore;
  routes: { method: string; url: string }[];
  login: (extra?: Record<string, string>) => Promise<{ cookie: string; csrf: string }> }) => Promise<void>,
  work: (password: string) => Promise<Buffer> = async (password) => Buffer.from((password === input.password ? "cd" : "ef").repeat(64), "hex"),
  options: BuildAppOptions = {}) {
  let now = 0; const audit = new Audit(); const sessions = new SessionCore(() => now);
  const routes: { method: string; url: string }[] = [];
  const authentication = new HttpAuthentication(new PasswordVerifier(record, new AuthAttemptWindow(() => now), work), audit, sessions);
  const install = authentication.install.bind(authentication);
  authentication.install = (...args) => {
    args[0].addHook("onRoute", (route) => { for (const method of Array.isArray(route.method) ? route.method : [route.method]) routes.push({ method, url: route.url }); });
    install(...args);
  };
  const app = buildApp({ ...options, authentication });
  const login = async (extra = {}) => {
    const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { ...headers, ...extra }, payload: input });
    expect(response.statusCode).toBe(200);
    return { cookie: String(response.headers["set-cookie"]).split(";", 1)[0]!, csrf: response.json().data.csrfToken as string };
  };
  try { await run({ app, audit, sessions, routes, advance: (ms) => { now += ms; }, login }); }
  finally { await app.close(); }
}
describe("default-deny authenticated HTTP", () => {
  it("keeps public status minimal and denies method/path/query/encoded variants, health and unknown routes", async () => fixture(async ({ app }) => {
    const status = await app.inject({ method: "GET", url: "/api/v1/auth/status", headers });
    expect(status.json()).toEqual({ data: { configured: true, authenticationRequired: true, auditReady: true } });
    for (const [method, url] of [["HEAD", "/api/v1/auth/status"], ["OPTIONS", "/api/v1/auth/status"], ["GET", "/api/v1/auth/status?x=1"],
      ["GET", "/api/v1/auth/%73tatus"], ["GET", "/health"], ["GET", "/no-route"], ["GET", "/api/v1/auth/session"],
      ["POST", "/api/v1/auth/login?x=1"], ["GET", "/api/v1/servers"], ["DELETE", "/api/v1/servers/unknown"]] as const) {
      const response = await app.inject({ method, url, headers });
      expect(response.statusCode, `${method} ${url}`).toBe(401); expect(response.headers["cache-control"]).toBe("no-store");
      if (method !== "HEAD") expect(response.json().error.code).toBe("AUTH_REQUIRED");
    }
  }));
  it("covers the complete registered method/path inventory including child raw uploads before all route handlers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mcsm-auth-routes-"));
    try { await fixture(async ({ app, routes }) => {
    let parsed = 0; let entered = 0;
    await app.register(async (child) => {
      child.addContentTypeParser("application/zip", (_req, payload, done) => { parsed++; done(null, payload); });
      child.post("/test/upload/:serverId", async () => { entered++; return {}; });
    });
    const denied = await app.inject({ method: "POST", url: "/test/upload/unknown", headers: { ...headers, "content-type": "application/zip", "transfer-encoding": "chunked" }, payload: Readable.from([Buffer.alloc(100_000)]) });
    expect(denied.statusCode).toBe(401); expect(parsed).toBe(0); expect(entered).toBe(0);
    expect(routes.some((route) => route.url.endsWith("/addons/uploads"))).toBe(true);
    expect(routes.some((route) => route.url.endsWith("/worlds/import-uploads"))).toBe(true);
    expect(routes.some((route) => route.url.endsWith("/download"))).toBe(true);
    expect(routes.length).toBeGreaterThan(60);
    for (const route of routes.filter((value) => !value.url.startsWith("/api/v1/auth/"))) {
      const result = await app.inject({ method: route.method as "GET", url: route.url.replace(/:[A-Za-z]+/gu, "unknown"), headers });
      expect(result.statusCode, `${route.method} ${route.url}`).toBe(401);
    }
    }, undefined, { managerRoot: root, transactionJournal: new TransactionJournalStore(root), backupSchedulerTimers: false,
      activeWorldState: { initialize: async () => new Set<string>(), isActive: () => false, reconcileAfterStart: async () => {},
        snapshot: () => null, prepareGeneration: async () => {}, installImportedWorld: async () => {}, archiveCurrentWorld: async () => {} } }); }
    finally { await rm(root, { recursive: true, force: true }); }
  });
  it("rejects before JSON parse/instance lookup and never trusts bearer, query, profile cookie or duplicate cookie", async () => fixture(async ({ app, login }) => {
    const malformed = await app.inject({ method: "POST", url: "/api/v1/servers/unknown/start", headers: { ...headers, "content-type": "application/json" }, payload: "{" });
    expect(malformed.statusCode).toBe(401);
    const { cookie } = await login();
    for (const extra of [{ authorization: "Bearer " + cookie.split("=")[1] }, { cookie: cookie + "; " + cookie }, { cookie: cookie.replace("mcsm_local_session", "__Host-mcsm_session") }]) {
      const response = await app.inject({ method: "GET", url: "/api/v1/auth/session", headers: { ...headers, ...extra } }); expect(response.statusCode).toBe(401);
    }
    expect((await app.inject({ method: "GET", url: "/api/v1/auth/session?token=" + cookie.split("=")[1], headers })).statusCode).toBe(401);
  }));
  it("issues local private cookie, stable session CSRF, rotates prior login and logout immediately revokes", async () => fixture(async ({ app, login, audit }) => {
    const firstResponse = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload: input });
    const flags = String(firstResponse.headers["set-cookie"]);
    expect(flags).toMatch(/^mcsm_local_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/$/u);
    expect(firstResponse.body).not.toContain(flags.split(";", 1)[0]!.split("=")[1]!);
    const oldCookie = flags.split(";", 1)[0]!; const current = await login({ cookie: oldCookie });
    expect(current.cookie).not.toBe(oldCookie);
    expect((await app.inject({ method: "GET", url: "/api/v1/auth/session", headers: { ...headers, cookie: oldCookie } })).statusCode).toBe(401);
    const response = await app.inject({ method: "GET", url: "/api/v1/auth/session", headers: { ...headers, cookie: current.cookie } });
    expect(response.json().data.csrfToken).toBe(current.csrf);
    const logout = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { ...headers, cookie: current.cookie, "x-csrf-token": current.csrf }, payload: {} });
    expect(logout.statusCode).toBe(200); expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
    expect((await app.inject({ method: "GET", url: "/api/v1/servers", headers: { ...headers, cookie: current.cookie } })).statusCode).toBe(401);
    expect(audit.events.map((event) => event.event)).toContain("logout");
    expect(JSON.stringify(audit.events)).not.toContain(input.password);
  }));
  it.each([{}, { origin: "null" }, { origin: "http://evil.test" }, { "x-manager-intent": "wrong" }, { "sec-fetch-site": "cross-site" }])("checks login Origin/intent/site %j before hashing", async (change) => {
    let hashes = 0;
    await fixture(async ({ app }) => {
      const actual = Object.keys(change).length ? { ...headers, ...change } : { host: headers.host, "x-manager-intent": "local-ui" };
      expect((await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: actual, payload: input })).statusCode).toBe(403);
      expect(hashes).toBe(0);
    }, async () => { hashes++; return Buffer.from(record.hash, "hex"); });
  });
  it("requires Origin/intent/CSRF even for raw uploads and applies failclosed WS including valid cookies", async () => fixture(async ({ app, login }) => {
    let parsed = 0;
    app.addContentTypeParser("application/zip", (_req, stream, done) => { parsed++; done(null, stream); });
    app.post("/test/upload", async () => ({}));
    const { cookie, csrf } = await login();
    for (const extra of [{}, { "x-csrf-token": "wrong" }, { "x-csrf-token": csrf, origin: undefined }, { "x-csrf-token": csrf, "x-manager-intent": "wrong" }]) {
      const requestHeaders = Object.fromEntries(Object.entries({ ...headers, cookie, ...extra, "content-type": "application/zip" }).filter(([, value]) => value !== undefined));
      expect((await app.inject({ method: "POST", url: "/test/upload", headers: requestHeaders, payload: "raw" })).statusCode).toBe(403);
    }
    expect(parsed).toBe(0);
    expect((await app.inject({ method: "POST", url: "/test/upload", headers: { ...headers, cookie, "x-csrf-token": csrf, "content-type": "application/zip" }, payload: "raw" })).statusCode).toBe(200);
    expect(parsed).toBe(1);
    for (const sessionCookie of [undefined, cookie]) {
      const upgrade = await app.inject({ method: "GET", url: "/ws/v1/servers/mock/events", headers: { ...headers, ...(sessionCookie === undefined ? {} : { cookie: sessionCookie }), upgrade: "websocket", connection: "upgrade", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" } });
      expect(upgrade.statusCode).toBe(403); expect(upgrade.json().error.code).toBe("AUTH_WS_REJECTED");
    }
  }));
  it("limits login bytes, strict fields/content type, and generic password failures with bounded rate", async () => fixture(async ({ app }) => {
    for (const payload of [{ ...input, extra: true }, { username: 3, password: "x" }, [], { username: "admin" }]) {
      expect((await app.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { ...headers, "content-type": "application/json" }, payload: JSON.stringify({ ...input, extra: "x".repeat(2048) }) })).statusCode).toBe(413);
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { ...headers, "content-type": "application/json" }, payload: "{" })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { ...headers, "content-type": "text/plain" }, payload: "secret" })).statusCode).toBe(415);
    for (let attempt = 0; attempt < 5; attempt++) {
      const denied = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload: { username: attempt % 2 ? "unknown" : "admin", password: "wrong" } });
      expect(denied.statusCode).toBe(401); expect(denied.json().error.code).toBe("AUTH_INVALID");
    }
    const limited = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload: input });
    expect(limited.statusCode).toBe(429); expect(limited.headers["retry-after"]).toBe("300");
  }));
  it("audits before login cookie/mutation admission and reports sticky unavailable status without secrets", async () => fixture(async ({ app, audit, login }) => {
    let admitted = 0; app.post("/test/mutation", async () => { admitted++; return {}; }); const { cookie, csrf } = await login();
    audit.fail = true;
    const denied = await app.inject({ method: "POST", url: "/test/mutation", headers: { ...headers, cookie, "x-csrf-token": csrf }, payload: {} });
    expect(denied.statusCode).toBe(503); expect(admitted).toBe(0); expect(denied.body).not.toContain("private-secret-path");
    expect((await app.inject({ method: "GET", url: "/api/v1/auth/status", headers })).json().data.auditReady).toBe(false);
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload: input })).headers["set-cookie"]).toBeUndefined();
  }));
  it("fails successful login closed if its audit append fails", async () => fixture(async ({ app, audit }) => {
    audit.fail = true;
    const denied = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload: input });
    expect(denied.statusCode).toBe(503); expect(denied.headers["set-cookie"]).toBeUndefined();
  }));
  it("reauth is bounded in session, expires after five minutes and cannot resurrect logout during hashing", async () => {
    let release: (() => void) | undefined; let block = false;
    await fixture(async ({ app, login, advance }) => {
      const { cookie, csrf } = await login(); advance(5 * 60_000);
      expect((await app.inject({ method: "GET", url: "/api/v1/auth/session", headers: { ...headers, cookie } })).json().data.recentReauthentication).toBe(false);
      const reauthHeaders = { ...headers, cookie, "x-csrf-token": csrf };
      expect((await app.inject({ method: "POST", url: "/api/v1/auth/reauth", headers: reauthHeaders, payload: input })).json().data.recentReauthentication).toBe(true);
      block = true; const pending = app.inject({ method: "POST", url: "/api/v1/auth/reauth", headers: reauthHeaders, payload: input });
      while (!release) await new Promise((resolve) => setImmediate(resolve));
      expect((await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: reauthHeaders, payload: {} })).statusCode).toBe(200);
      release(); expect((await pending).statusCode).toBe(401);
    }, async () => { if (block) await new Promise<void>((resolve) => { release = resolve; }); return Buffer.from(record.hash, "hex"); });
  });
  it("records expiry before rejecting expired cookies", async () => fixture(async ({ app, login, advance, audit }) => {
    const { cookie } = await login(); advance(30 * 60_000);
    expect((await app.inject({ method: "GET", url: "/api/v1/auth/session", headers: { ...headers, cookie } })).statusCode).toBe(401);
    expect(audit.events.map((event) => event.event)).toContain("session-expiry");
  }));
  it("preserves legacy app explicitly without injected auth and rejects hostile Host/forwarding before login", async () => {
    const legacy = buildApp(); try { expect((await legacy.inject({ method: "GET", url: "/api/v1/servers", headers })).statusCode).toBe(200); } finally { await legacy.close(); }
    await fixture(async ({ app }) => {
      for (const change of [{ host: "evil.test" }, { "x-forwarded-for": "127.0.0.1" }, { forwarded: "host=localhost:8080" }]) {
        const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { ...headers, ...change }, payload: input });
        expect(response.statusCode).toBe(403); expect(response.headers["cache-control"]).toBe("no-store");
      }
    });
  });
  it.each([
    ["parser", "logout"], ["parser", "expiry"], ["parser", "audit-failure"], ["parser", "unchanged"],
    ["pre-handler", "logout"], ["pre-handler", "expiry"], ["pre-handler", "audit-failure"], ["pre-handler", "unchanged"]
  ] as const)("rechecks final admission after deferred child %s and %s", async (stage, change) => fixture(async ({ app, audit, login, advance }) => {
    const paused = deferred(); const release = deferred(); let sideEffects = 0;
    await app.register(async (child) => {
      if (stage === "parser") {
        child.removeContentTypeParser("application/json");
        child.addContentTypeParser("application/json", { parseAs: "string" }, async (_request, body) => {
          paused.resolve(); await release.promise; return JSON.parse(String(body));
        });
      }
      child.post("/test/deferred", {
        ...(stage === "pre-handler" ? { preHandler: async () => { paused.resolve(); await release.promise; } } : {})
      }, function () { expect(this).toBe(child); sideEffects++; return {}; });
    });
    const { cookie, csrf } = await login();
    const requestHeaders = { ...headers, cookie, "x-csrf-token": csrf };
    const pending = app.inject({ method: "POST", url: "/test/deferred", headers: requestHeaders, payload: {} }).then((value) => value);
    await paused.promise;
    expect(sideEffects).toBe(0);
    expect(audit.events.filter((event) => event.event === "mutation-admission")).toHaveLength(0);
    if (change === "logout") expect((await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: requestHeaders, payload: {} })).statusCode).toBe(200);
    if (change === "expiry") advance(30 * 60_000);
    if (change === "audit-failure") {
      audit.fail = true;
      expect((await app.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload: input })).statusCode).toBe(503);
    }
    release.resolve(); const result = await pending;
    expect(result.statusCode).toBe(change === "unchanged" ? 200 : change === "audit-failure" ? 503 : 401);
    expect(sideEffects).toBe(change === "unchanged" ? 1 : 0);
    expect(audit.events.filter((event) => event.event === "mutation-admission")).toHaveLength(change === "unchanged" ? 1 : 0);
  }));
  it.each(["logout", "expiry", "audit-failure"] as const)("rechecks after awaited mutation audit changes %s before service invocation", async (change) => fixture(async ({ app, audit, login, advance }) => {
    const paused = deferred(); const release = deferred(); let sideEffects = 0;
    app.post("/test/audit-pause", () => { sideEffects++; return {}; });
    const { cookie, csrf } = await login(); const requestHeaders = { ...headers, cookie, "x-csrf-token": csrf };
    audit.beforeRecord = async (event) => { if (event.event === "mutation-admission") { paused.resolve(); await release.promise; } };
    const pending = app.inject({ method: "POST", url: "/test/audit-pause", headers: requestHeaders, payload: {} }).then((value) => value);
    await paused.promise;
    if (change === "logout") expect((await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: requestHeaders, payload: {} })).statusCode).toBe(200);
    if (change === "expiry") advance(30 * 60_000);
    if (change === "audit-failure") audit.healthy = false;
    release.resolve(); const result = await pending;
    expect(result.statusCode).toBe(change === "audit-failure" ? 503 : 401); expect(sideEffects).toBe(0);
  }));
  it("does not cancel an already admitted service operation on logout", async () => fixture(async ({ app, login }) => {
    const admitted = deferred(); const complete = deferred(); let sideEffects = 0;
    app.post("/test/admitted", async () => { sideEffects++; admitted.resolve(); await complete.promise; return { completed: true }; });
    const { cookie, csrf } = await login(); const requestHeaders = { ...headers, cookie, "x-csrf-token": csrf };
    const pending = app.inject({ method: "POST", url: "/test/admitted", headers: requestHeaders, payload: {} }).then((value) => value);
    await admitted.promise;
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: requestHeaders, payload: {} })).statusCode).toBe(200);
    complete.resolve(); const result = await pending;
    expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ completed: true }); expect(sideEffects).toBe(1);
  }));
  it("returns the live session deadline and recent-reauth state after delayed login audit", async () => {
    const epoch = Date.parse("2026-10-09T00:00:00.000Z"); let wall = 0;
    await fixture(async ({ app, audit, advance }) => {
      audit.beforeRecord = async (event) => { if (event.event === "login-success") { wall += 6 * 60_000; advance(6 * 60_000); } };
      const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload: input });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.expiresAt).toBe(new Date(epoch + 30 * 60_000).toISOString());
      expect(response.json().data.recentReauthentication).toBe(false);
      const cookie = String(response.headers["set-cookie"]).split(";", 1)[0]!;
      const view = await app.inject({ method: "GET", url: "/api/v1/auth/session", headers: { ...headers, cookie } });
      expect(response.json().data.csrfToken).toBe(view.json().data.csrfToken);
    }, undefined, { clock: { now: () => new Date(epoch + wall) } });
  });
  it.each(["null", "http://evil.test/private-secret?token=credential", "http://127.0.0.1:3000.evil.test"])("audits rejected Origin %s before parse/hash without raw values", async (origin) => {
    let hashes = 0;
    await fixture(async ({ app, audit }) => {
      const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { ...headers, origin, "content-type": "application/json" }, payload: "{" });
      expect(response.statusCode).toBe(403); expect(response.json().error.code).toBe("ORIGIN_REJECTED"); expect(response.headers["cache-control"]).toBe("no-store");
      expect(hashes).toBe(0); expect(audit.events).toEqual([{ event: "csrf-denial", requestId: response.json().meta.requestId }]);
      expect(JSON.stringify(audit.events)).not.toContain(origin);
    }, async () => { hashes++; return Buffer.from(record.hash, "hex"); });
  });
  it("fails Origin denial closed if audit fails and keeps legacy local rejection unchanged", async () => {
    await fixture(async ({ app, audit }) => {
      audit.fail = true;
      const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { ...headers, origin: "null" }, payload: input });
      expect(response.statusCode).toBe(503); expect(response.json().error.code).toBe("AUTH_AUDIT_UNAVAILABLE"); expect(response.body).not.toContain("private-secret-path");
      expect((await app.inject({ method: "GET", url: "/api/v1/auth/status", headers })).json().data.auditReady).toBe(false);
    });
    const legacy = buildApp();
    try {
      const response = await legacy.inject({ method: "POST", url: "/api/v1/auth/login", headers: { ...headers, origin: "null" }, payload: input });
      expect(response.statusCode).toBe(403); expect(response.json().error.code).toBe("ORIGIN_REJECTED");
    } finally { await legacy.close(); }
  });
  it("revokes the newly created session and emits no cookie when fulfilled login audit becomes unhealthy", async () => fixture(async ({ app, audit, sessions }) => {
    const paused = deferred(); const release = deferred();
    audit.beforeRecord = async (event) => { if (event.event === "login-success") { paused.resolve(); await release.promise; } };
    const pending = app.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload: input }).then((value) => value);
    await paused.promise;
    expect(sessions.nextDeadline()).toBeDefined();
    audit.healthy = false; release.resolve(); const result = await pending;
    expect(audit.events.map((event) => event.event)).toContain("login-success"); // The in-flight write still fulfilled.
    expect(result.statusCode).toBe(503); expect(result.json().error.code).toBe("AUTH_AUDIT_UNAVAILABLE");
    expect(result.headers["set-cookie"]).toBeUndefined(); expect(sessions.nextDeadline()).toBeUndefined();
  }));
  it("does not extend recent reauthentication after fulfilled audit becomes unhealthy", async () => fixture(async ({ app, audit, sessions, login, advance }) => {
    const { cookie, csrf } = await login(); const raw = cookie.slice(cookie.indexOf("=") + 1);
    advance(6 * 60_000); expect(sessions.read(raw, "local-http").recentReauthentication).toBe(false);
    const paused = deferred(); const release = deferred();
    audit.beforeRecord = async (event) => { if (event.event === "reauth-success") { paused.resolve(); await release.promise; } };
    const pending = app.inject({ method: "POST", url: "/api/v1/auth/reauth", headers: { ...headers, cookie, "x-csrf-token": csrf }, payload: input }).then((value) => value);
    await paused.promise; advance(60_000); audit.healthy = false; release.resolve(); const result = await pending;
    expect(audit.events.map((event) => event.event)).toContain("reauth-success"); // The in-flight write still fulfilled.
    expect(result.statusCode).toBe(503); expect(result.json().error.code).toBe("AUTH_AUDIT_UNAVAILABLE");
    expect(sessions.read(raw, "local-http").recentReauthentication).toBe(false);
  }));
});
