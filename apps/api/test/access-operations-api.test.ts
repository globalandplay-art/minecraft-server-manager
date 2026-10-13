import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { HttpAuthentication } from "../src/auth/http-auth.js";
import { PasswordVerifier, SCRYPT_PROFILE } from "../src/auth/password.js";
import { SessionCore } from "../src/auth/session-core.js";
import { accessFixture } from "./access-operation-fixture.js";
import { AccessOperationService } from "../src/services/access-operation-service.js";

function authenticationFixture() {
  let now = 0; let healthy = true;
  const sessions = new SessionCore(() => now);
  const authentication = new HttpAuthentication(new PasswordVerifier({ version: 1, username: "admin", revision: randomUUID(),
    salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }),
  { ready: () => healthy, record: async () => {}, close: async () => {} }, sessions);
  const session = sessions.create("local-http");
  const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui",
    cookie: `mcsm_local_session=${session.sessionToken}`, "x-csrf-token": session.csrfToken, "idempotency-key": randomUUID() };
  return { authentication, sessions, headers, expire: () => { now += 5 * 60_000; }, unhealthy: () => { healthy = false; } };
}
it("uses shared authenticated APIs, rejects arbitrary body fields and preserves production unavailability", async () => {
  const a = authenticationFixture(); const app = buildApp({ authentication: a.authentication });
  const payload = { revision: randomUUID(), confirm: true };
  try {
    const send = (headers = a.headers, body = payload) => app.inject({ method: "POST", url: "/api/v1/access/tailscale/enable", headers, payload: body });
    expect((await send({ ...a.headers, cookie: "" })).statusCode).toBe(401);
    expect((await send({ ...a.headers, "x-csrf-token": "wrong" })).statusCode).toBe(403);
    expect((await send({ ...a.headers, "x-forwarded-host": "fake.ts.net" })).statusCode).toBe(403);
    const extra = await app.inject({ method: "POST", url: "/api/v1/access/tailscale/enable", headers: a.headers,
      payload: { ...payload, path: "private", command: "arbitrary", targetPort: 25575 } });
    expect(extra.statusCode).toBe(400);
    for (const confirm of ["true", 1, null, false]) {
      expect((await app.inject({ method: "POST", url: "/api/v1/access/tailscale/enable", headers: a.headers,
        payload: { revision: payload.revision, confirm } })).statusCode).toBe(400);
    }
    const unavailable = await send(); expect(unavailable.statusCode).toBe(503); expect(unavailable.json().error.code).toBe("ACCESS_UNAVAILABLE");
    expect((await app.inject({ url: `/api/v1/access/operations/${randomUUID()}`, headers: a.headers })).statusCode).toBe(404);
    a.expire(); expect((await send()).json().error.code).toBe("AUTH_REAUTH_REQUIRED");
  } finally { await app.close(); }
});
it("authenticated injected provider produces a safe queryable operation without remote URL claims", async () => {
  const f = await accessFixture(); const a = authenticationFixture(); const { service } = await f.open();
  const app = buildApp({ authentication: a.authentication, accessOperations: service });
  try {
    const first = await app.inject({ method: "POST", url: "/api/v1/access/tailscale/enable", headers: a.headers, payload: f.body() });
    expect(first.statusCode).toBe(202); expect(first.json().data.state).toBe("succeeded");
    const id = first.json().data.id;
    const query = await app.inject({ url: `/api/v1/access/operations/${id}`, headers: a.headers });
    expect(query.statusCode).toBe(200); expect(query.json().data).toEqual(first.json().data);
    expect(query.headers["cache-control"]).toBe("no-store");
    expect((await app.inject({ method: "POST", url: "/api/v1/access/tailscale/enable", headers: a.headers, payload: f.body() })).json().data.id).toBe(id);
    expect(f.adapter.calls).toBe(1);
    const methods = (await app.inject({ url: "/api/v1/access/methods", headers: a.headers })).json().data;
    expect(methods.tailscale.remoteVerifiedAt).toBeNull(); expect(methods.tailscale.connectionUrl).toBeNull();
    for (const secret of [f.root, a.headers.cookie, a.headers["x-csrf-token"], a.headers["idempotency-key"]]) expect(query.body).not.toContain(secret);
  } finally { await app.close(); await f.close(); }
});
it.each(["expired", "revoked", "audit"])("rejects %s during adapter preflight before private admission", async (failure) => {
  const f = await accessFixture(); const a = authenticationFixture(); const { service } = await f.open();
  const app = buildApp({ authentication: a.authentication, accessOperations: service });
  try {
    f.adapter.duringPreflight = async () => {
      if (failure === "expired") a.expire(); if (failure === "revoked") a.sessions.clear(); if (failure === "audit") a.unhealthy();
    };
    const response = await app.inject({ method: "POST", url: "/api/v1/access/tailscale/enable", headers: a.headers, payload: f.body() });
    expect(response.statusCode).toBe(failure === "expired" ? 403 : failure === "revoked" ? 401 : 503);
    expect(f.writes()).toBe(0); expect(f.adapter.calls).toBe(0);
  } finally { await app.close(); await f.close(); }
});
it("isolates Access storage recovery from local authenticated management", async () => {
  const a = authenticationFixture(); const app = buildApp({ authentication: a.authentication, accessOperations: new AccessOperationService({ blocked: true }) });
  try {
    expect((await app.inject({ url: "/api/v1/access/methods", headers: a.headers })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/v1/servers", headers: a.headers })).statusCode).toBe(200);
    expect((await app.inject({ url: `/api/v1/access/operations/${randomUUID()}`, headers: a.headers })).json().error.code).toBe("ACCESS_RECOVERY_REQUIRED");
    expect((await app.inject({ url: `/api/v1/access/operations/${randomUUID()}`, headers: { ...a.headers, cookie: "" } })).statusCode).toBe(401);
  } finally { await app.close(); }
});
