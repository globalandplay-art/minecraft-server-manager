import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { HttpAuthentication } from "../src/auth/http-auth.js";
import { PasswordVerifier, SCRYPT_PROFILE } from "../src/auth/password.js";
import { SessionCore } from "../src/auth/session-core.js";
import { TailscaleReadOnlyService } from "../src/services/tailscale-readonly.js";

it("requires configured auth, CSRF, trusted ingress and strict empty body before any CLI call", async () => {
  let calls = 0;
  const service = new TailscaleReadOnlyService({ run: async () => { calls++; return "unsupported"; } });
  const sessions = new SessionCore(); let healthy = true;
  const authentication = new HttpAuthentication(new PasswordVerifier({ version: 1, username: "admin", revision: randomUUID(), salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }),
    { ready: () => healthy, record: async () => {}, close: async () => {} }, sessions);
  const session = sessions.create("local-http");
  const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui", cookie: `mcsm_local_session=${session.sessionToken}`, "x-csrf-token": session.csrfToken };
  const app = buildApp({ authentication, tailscaleReadOnly: service });
  try {
    const send = (h = headers, payload = {}) => app.inject({ method: "POST", url: "/api/v1/access/tailscale/preflight", headers: h, payload });
    expect((await send({ ...headers, cookie: "" })).statusCode).toBe(401);
    expect((await send({ ...headers, "x-csrf-token": "wrong" })).statusCode).toBe(403);
    expect((await send({ ...headers, "x-forwarded-host": "evil.ts.net" })).statusCode).toBe(403);
    expect((await send(headers, { command: "serve reset", path: "secret", port: 25575 })).statusCode).toBe(400);
    healthy = false; expect((await send()).statusCode).toBe(503); healthy = true;
    expect(calls).toBe(0);
    const read = await app.inject({ url: "/api/v1/access/tailscale", headers });
    expect(read.statusCode).toBe(200); expect(read.json().data.state).toBe("disabled"); expect(calls).toBe(0);
    const checked = await send(); expect(checked.statusCode).toBe(200); expect(checked.headers["cache-control"]).toBe("no-store");
    expect(checked.json().data.lastErrorCode).toBe("TAILSCALE_VERSION_UNSUPPORTED"); expect(calls).toBe(1);
    expect(checked.body).not.toContain(session.sessionToken); expect(checked.body).not.toContain(session.csrfToken);
    sessions.clear(); expect((await app.inject({ url: "/api/v1/access/tailscale", headers })).statusCode).toBe(401);
  } finally { await app.close(); }
  const anonymous = buildApp({ tailscaleReadOnly: service });
  try { expect((await anonymous.inject({ url: "/api/v1/access/tailscale", headers: { host: headers.host } })).statusCode).toBe(401); expect(calls).toBe(1); }
  finally { await anonymous.close(); }
});
