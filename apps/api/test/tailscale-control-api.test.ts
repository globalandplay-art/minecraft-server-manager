import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { HttpAuthentication } from "../src/auth/http-auth.js";
import { PasswordVerifier, SCRYPT_PROFILE } from "../src/auth/password.js";
import { SessionCore } from "../src/auth/session-core.js";
import { tailscaleControlFixture } from "./tailscale-control-fixture.js";

function authFixture() {
  let now = 0; const sessions = new SessionCore(() => now);
  const auth = new HttpAuthentication(new PasswordVerifier({ version: 1, username: "fixture", revision: randomUUID(),
    salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }),
  { ready: () => true, record: async () => {}, close: async () => {} }, sessions);
  const session = sessions.create("local-http");
  return { auth, expire: () => { now += 5 * 60_000; }, headers: { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000",
    "x-manager-intent": "local-ui", cookie: `mcsm_local_session=${session.sessionToken}`,
    "x-csrf-token": session.csrfToken, "idempotency-key": randomUUID() } };
}
it("production control unavailable and default GET performs zero remote changes", async () => {
  const a = authFixture(); const app = buildApp({ authentication: a.auth });
  try {
    const response = await app.inject({ url: "/api/v1/access/tailscale/control", headers: a.headers });
    expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().data).toMatchObject({ state: "unavailable", enableAllowed: false, disableAllowed: false,
      revision: null, connectionUrl: null, remoteVerifiedAt: null });
    expect((await app.inject({ url: "/api/v1/access/tailscale/control", headers: { ...a.headers, cookie: "" } })).statusCode).toBe(401);
  } finally { await app.close(); }
});
it("uses one authenticated operation service for preview, install and explicit evidence recovery", async () => {
  const f = await tailscaleControlFixture(); const a = authFixture(); const { operations, control } = await f.open();
  const app = buildApp({ authentication: a.auth, accessOperations: operations, tailscaleControl: control });
  try {
    const send = (headers = a.headers, body = f.body()) => app.inject({ method: "POST", url: "/api/v1/access/tailscale/enable", headers, payload: body });
    expect((await send({ ...a.headers, cookie: "" })).statusCode).toBe(401);
    expect((await send({ ...a.headers, "x-csrf-token": "wrong" })).statusCode).toBe(403);
    expect((await send({ ...a.headers, "x-forwarded-host": "fake.ts.net" })).statusCode).toBe(403);
    expect((await send(a.headers, { ...f.body(), path: "arbitrary" } as ReturnType<typeof f.body>)).statusCode).toBe(400);
    expect(f.daemon.commits).toBe(0); expect(f.writes()).toBe(0);
    f.daemon.loseResponse = true; const result = await send();
    expect(result.statusCode).toBe(202); expect(result.json().data.state).toBe("recovery_required");
    const preview = await app.inject({ url: "/api/v1/access/tailscale/control", headers: a.headers });
    expect(preview.json().data).toMatchObject({ state: "recovery_required", enableAllowed: false, disableAllowed: false,
      recoveryOperationId: result.json().data.id });
    const recovery = await app.inject({ method: "POST", url: `/api/v1/access/operations/${result.json().data.id}/recover`, headers: a.headers, payload: f.body() });
    expect(recovery.statusCode).toBe(200); expect(recovery.json().data.state).toBe("succeeded");
    expect(f.daemon.commits).toBe(1); expect(f.daemon.calls).toBe(1);
    for (const sensitive of [f.root, a.headers.cookie, a.headers["x-csrf-token"], f.daemon.snapshot.hostname]) expect(preview.body).not.toContain(sensitive);
  } finally { await app.close(); await f.close(); }
});
it("late administrator expiry is HTTP403 with zero provider commits and retained intent", async () => {
  const f = await tailscaleControlFixture(); const a = authFixture(); const { operations, control } = await f.open();
  const app = buildApp({ authentication: a.auth, accessOperations: operations, tailscaleControl: control });
  try {
    f.daemon.beforeCommit = async () => a.expire();
    const result = await app.inject({ method: "POST", url: "/api/v1/access/tailscale/enable", headers: a.headers, payload: f.body() });
    expect(result.statusCode).toBe(403); expect(result.json().error.code).toBe("AUTH_REAUTH_REQUIRED");
    expect(f.daemon.commits).toBe(0); expect((await operations.controlState()).recoveryOperationId).not.toBeNull();
  } finally { await app.close(); await f.close(); }
});
it("rejects mismatched preview and mutation coordinators at construction", async () => {
  const f = await tailscaleControlFixture();
  try { const { control } = await f.open(); expect(() => buildApp({ tailscaleControl: control })).toThrow("share the same operation service"); }
  finally { await f.close(); }
});
