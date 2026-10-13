import { randomUUID } from "node:crypto";
import { accessMethodsResponseSchema } from "@mcsm/contracts";
import { Value } from "@sinclair/typebox/value";
import { expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { HttpAuthentication } from "../src/auth/http-auth.js";
import { PasswordVerifier, SCRYPT_PROFILE } from "../src/auth/password.js";
import { SessionCore } from "../src/auth/session-core.js";
import { AccessCoordinator } from "../src/services/access-coordinator.js";

const headers = { host: "127.0.0.1:8080" };
it("rejects invented remote success, extra paths and mixed-provider contracts", () => {
  const data = new AccessCoordinator(true).read();
  const response = { data, meta: { mode: "mock", requestId: randomUUID(), generatedAt: new Date().toISOString() } };
  expect(Value.Check(accessMethodsResponseSchema, response)).toBe(true);
  for (const invalid of [
    { ...data.tailscale, observedState: "enabled" },
    { ...data.tailscale, connectionUrl: "https://invented.ts.net" },
    { ...data.tailscale, targetPath: "private" },
    { ...data.tailscale, id: "cloudflare" },
    { ...data.tailscale, capabilities: { preflight: false, enable: true, disable: false } }
  ]) expect(Value.Check(accessMethodsResponseSchema, { ...response, data: { ...data, tailscale: invalid } })).toBe(false);
});
it("reports capability defaults without claiming actual remote state or exposing mutable shared data", () => {
  const coordinator = new AccessCoordinator(false);
  const first = coordinator.read();
  expect(first.local.authenticationRequired).toBe(false);
  for (const method of [first.tailscale, first.cloudflare]) {
    expect(method).toMatchObject({ implemented: false, desiredEnabled: false, observedState: "unknown",
      managementMode: "external", connectionUrl: null, remoteVerifiedAt: null,
      capabilities: { preflight: method.id === "tailscale", enable: false, disable: false } });
  }
  first.local.authenticationRequired = true;
  expect(coordinator.read().local.authenticationRequired).toBe(false);
});
it("keeps the legacy local inventory read-only and uncached", async () => {
  const app = buildApp();
  try {
    const response = await app.inject({ url: "/api/v1/access/methods", headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().data.local.authenticationRequired).toBe(false);
    expect((await app.inject({ method: "POST", url: "/api/v1/access/tailscale/enable",
      payload: { revision: randomUUID(), confirm: true },
      headers: { ...headers, origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui" } })).statusCode).toBe(401);
  } finally { await app.close(); }
});
it("shares required authentication, audit health, profile and session revocation gates", async () => {
  let healthy = true;
  const sessions = new SessionCore();
  const authentication = new HttpAuthentication(new PasswordVerifier({ version: 1, username: "admin",
    revision: randomUUID(), salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }),
  { ready: () => healthy, record: async () => {}, close: async () => {} }, sessions);
  const app = buildApp({ authentication });
  try {
    expect((await app.inject({ url: "/api/v1/access/methods", headers })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/v1/access/methods", headers: { ...headers, "tailscale-user-login": "admin" } })).statusCode).toBe(401);
    const session = sessions.create("local-http");
    const signed = { ...headers, cookie: `mcsm_local_session=${session.sessionToken}` };
    const response = await app.inject({ url: "/api/v1/access/methods", headers: signed });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.local.authenticationRequired).toBe(true);
    expect(response.body).not.toContain(session.sessionToken);
    expect(response.body).not.toContain(session.csrfToken);
    expect((await app.inject({ url: "/api/v1/access/methods", headers: { ...signed, "x-forwarded-host": "fake.ts.net" } })).statusCode).toBe(403);
    healthy = false;
    expect((await app.inject({ url: "/api/v1/access/methods", headers: signed })).statusCode).toBe(503);
    healthy = true;
    sessions.clear();
    expect((await app.inject({ url: "/api/v1/access/methods", headers: signed })).statusCode).toBe(401);
  } finally { await app.close(); }
});
