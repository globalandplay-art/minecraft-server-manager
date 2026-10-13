import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { HttpAuthentication } from "../../src/auth/http-auth.js";
import { PasswordVerifier, SCRYPT_PROFILE } from "../../src/auth/password.js";
import { SessionCore } from "../../src/auth/session-core.js";

it("requires fresh shared-session authorization and never admits after reauth expiry, revocation or audit failure", async () => {
  let now = 0, healthy = true, effects = 0;
  let duringPreflight = () => {};
  const sessions = new SessionCore(() => now);
  const auth = new HttpAuthentication(new PasswordVerifier({ version: 1, username: "admin", revision: randomUUID(),
    salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }),
  { ready: () => healthy, record: async () => {}, close: async () => {} }, sessions);
  const app = buildApp({ authentication: auth });
  app.post("/api/v1/test-sensitive", async (request) => {
    await Promise.resolve(); duringPreflight();
    auth.assertRecentMutation(request);
    effects++; return { accepted: true };
  });
  const session = sessions.create("local-http");
  const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui",
    cookie: `mcsm_local_session=${session.sessionToken}`, "x-csrf-token": session.csrfToken };
  const send = () => app.inject({ method: "POST", url: "/api/v1/test-sensitive", headers });
  try {
    expect((await send()).statusCode).toBe(200); expect(effects).toBe(1);
    now = 5 * 60_000;
    const stale = await send(); expect(stale.statusCode).toBe(403); expect(stale.json().error.code).toBe("AUTH_REAUTH_REQUIRED");
    expect(effects).toBe(1);
    sessions.markReauthenticated(session.sessionToken, "local-http");
    expect((await send()).statusCode).toBe(200); expect(effects).toBe(2);
    duringPreflight = () => { now += 5 * 60_000; };
    const expiredDuringPreflight = await send();
    expect(expiredDuringPreflight.statusCode).toBe(403);
    expect(expiredDuringPreflight.json().error.code).toBe("AUTH_REAUTH_REQUIRED"); expect(effects).toBe(2);
    sessions.markReauthenticated(session.sessionToken, "local-http");
    duringPreflight = () => { healthy = false; };
    const audit = await send(); expect(audit.statusCode).toBe(503); expect(audit.json().error.code).toBe("AUTH_AUDIT_UNAVAILABLE");
    expect(effects).toBe(2);
    healthy = true; duringPreflight = () => { sessions.clear(); };
    const revoked = await send(); expect(revoked.statusCode).toBe(401); expect(effects).toBe(2);
  } finally { await app.close(); }
});
