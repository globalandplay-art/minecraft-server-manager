import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { api } from "../../web/src/api.js";
import { authState } from "../../web/src/authState.js";
import { buildApp } from "../src/app.js";
import { HttpAuthentication } from "../src/auth/http-auth.js";
import { PasswordVerifier, SCRYPT_PROFILE } from "../src/auth/password.js";
import { SessionCore } from "../src/auth/session-core.js";
import { TailscaleReadOnlyService } from "../src/services/tailscale-readonly.js";
import { tailscaleControlFixture } from "./tailscale-control-fixture.js";

it("real web client crosses authenticated API intent/CSRF gates for preflight, control and recovery", async () => {
  const f = await tailscaleControlFixture(); const { operations, control } = await f.open();
  const sessions = new SessionCore(); const session = sessions.create("local-http");
  const authentication = new HttpAuthentication(new PasswordVerifier({ version: 1, username: "fixture", revision: randomUUID(),
    salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }),
  { ready: () => true, record: async () => {}, close: async () => {} }, sessions);
  let reads = 0; let removeIntent = false;
  const readonly = new TailscaleReadOnlyService({ run: async () => { reads++; return "unsupported"; } });
  const app = buildApp({ authentication, accessOperations: operations, tailscaleControl: control, tailscaleReadOnly: readonly });
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  // Emulate only browser-supplied origin/host/cookie. Intent and CSRF must come from the real client.
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    expect(init.credentials).toBe("same-origin");
    expect(headers.get("x-manager-intent")).toBe("local-ui");
    expect(headers.get("x-csrf-token")).toBe(session.csrfToken);
    if (removeIntent) headers.delete("x-manager-intent");
    headers.set("host", "127.0.0.1:8080"); headers.set("origin", "http://127.0.0.1:3000");
    headers.set("cookie", `mcsm_local_session=${session.sessionToken}`);
    const reply = await app.inject({ method: "POST", url, headers: Object.fromEntries(headers), payload: String(init.body) });
    return new Response(reply.body, { status: reply.statusCode, headers: { "content-type": "application/json" } });
  });
  const now = Date.now();
  authState.authenticated({ data: { authenticated: true, csrfToken: session.csrfToken,
    expiresAt: new Date(now + session.remainingMs).toISOString(), recentReauthentication: true },
  meta: { mode: "mock", requestId: "fixture", generatedAt: new Date(now).toISOString() } }, authState.checking());
  try {
    removeIntent = true;
    await expect(api.tailscalePreflight()).rejects.toMatchObject({ status: 403, code: "ORIGIN_REJECTED" });
    await expect(api.tailscaleMutate("enable", f.body(), randomUUID())).rejects.toMatchObject({ status: 403, code: "ORIGIN_REJECTED" });
    await expect(api.accessRecover(randomUUID(), f.body())).rejects.toMatchObject({ status: 403, code: "ORIGIN_REJECTED" });
    expect(reads).toBe(0); expect(f.writes()).toBe(0); expect(f.daemon.commits).toBe(0);
    removeIntent = false;
    expect((await api.tailscalePreflight()).data.lastErrorCode).toBe("TAILSCALE_VERSION_UNSUPPORTED"); expect(reads).toBe(1);
    f.daemon.loseResponse = true; const on = await api.tailscaleMutate("enable", f.body(), randomUUID());
    expect(on.data.state).toBe("recovery_required"); expect(f.daemon.commits).toBe(1);
    const recovered = await api.accessRecover(on.data.id, f.body()); expect(recovered.data.state).toBe("succeeded");
    expect(f.daemon.calls).toBe(1); expect(f.daemon.commits).toBe(1);
    f.daemon.loseResponse = false;
    expect((await api.tailscaleMutate("disable", f.body(), randomUUID())).data.state).toBe("succeeded");
    expect(f.daemon.commits).toBe(2);
  } finally { authState.checking(); vi.unstubAllGlobals(); await app.close(); await f.close(); }
});
