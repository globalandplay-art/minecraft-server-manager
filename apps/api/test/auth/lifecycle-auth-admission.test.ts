import { randomUUID } from "node:crypto";
import fastify, { type FastifyRequest } from "fastify";
import { expect, it, vi } from "vitest";
import type { LocalMinecraftServerAdapter } from "../../src/adapters/contract.js";
import { AdapterRegistry } from "../../src/adapters/registry.js";
import { buildApp } from "../../src/app.js";
import { HttpAuthentication } from "../../src/auth/http-auth.js";
import { SessionCore } from "../../src/auth/session-core.js";
import { PasswordVerifier, SCRYPT_PROFILE } from "../../src/auth/password.js";
import { TailscaleIngressBoundary } from "../../src/auth/tailscale-ingress-boundary.js";
import { registerOperationRoutes } from "../../src/routes/operations.js";
import { OperationService } from "../../src/services/operation-service.js";
import { MemoryOperationStore } from "../../src/services/operation-store.js";
import { ServerService } from "../../src/services/server-service.js";
import { DomainError } from "../../src/services/domain-errors.js";
import { errorResponse } from "../../src/infra/http.js";
const clock = { now: () => new Date("2026-10-14T00:00:00.000Z") };
function fixture(ownsAdapter = true) {
  let now = 0, healthy = true, during = () => {};
  const sessions = new SessionCore(() => now);
  const auth = new HttpAuthentication(new PasswordVerifier({ version: 1, username: "admin", revision: randomUUID(),
    salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }),
  { ready: () => healthy, record: async () => {}, close: async () => {} }, sessions);
  const start = vi.fn(async () => {}), stop = vi.fn(async () => {});
  const info = { id: "test", name: "Test", type: "vanilla", minecraftVersion: "26.3",
    java: { runtimeVersion: "25", requiredMajor: 25 }, detection: { confidence: "high", evidence: [], warnings: [] } };
  const adapter = { serverId: "test", mode: "local", plan: { eulaAccepted: true, serverInfo: info },
    getServerInfo: async () => info,
    getStatus: async () => { await Promise.resolve(); during(); return { state: "stopped", ownership: "none", source: "process",
      observedAt: clock.now().toISOString(), activeOperationId: null, recoveryRequired: false }; },
    getCapabilities: async () => ({ mods: false, plugins: false, worlds: true, backup: true, console: true, rcon: false, properties: false }),
    getCommandTransport: async () => "stdin", revalidateBeforeStart: async () => {}, start, stop,
    subscribe: () => () => {}, closeObserver: async () => {}
  } as unknown as LocalMinecraftServerAdapter;
  const store = new MemoryOperationStore();
  const app = buildApp({ mode: "local", adapters: ownsAdapter ? [adapter] : [], authentication: auth,
    operationStore: ownsAdapter ? store : new MemoryOperationStore() });
  const token = sessions.create("local-http");
  const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui",
    "idempotency-key": randomUUID(), cookie: `mcsm_local_session=${token.sessionToken}`, "x-csrf-token": token.csrfToken };
  return { app, auth, sessions, adapter, store, headers, start, stop,
    preflight: (action: () => void) => { during = action; }, expire: () => { now = 31 * 60_000; },
    olderReauth: () => { now = 6 * 60_000; }, failAudit: () => { healthy = false; } };
}
it.each(["revoked", "expired", "audit"] as const)("denies %s during real lifecycle preflight before creating an operation", async (kind) => {
  const f = fixture(); f.preflight(kind === "revoked" ? () => f.sessions.clear() : kind === "expired" ? f.expire : f.failAudit);
  try {
    const response = await f.app.inject({ method: "POST", url: "/api/v1/servers/test/actions/start", headers: f.headers, payload: {} });
    expect(response.statusCode).toBe(kind === "audit" ? 503 : 401);
    expect(response.json().error.code).toBe(kind === "audit" ? "AUTH_AUDIT_UNAVAILABLE" : "AUTH_REQUIRED");
    expect(await f.store.list()).toEqual([]); expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  } finally { await f.app.close(); }
});
it("does not newly require recent reauthentication for a valid lifecycle session", async () => {
  const f = fixture(); f.olderReauth();
  try {
    const response = await f.app.inject({ method: "POST", url: "/api/v1/servers/test/actions/start", headers: f.headers, payload: {} });
    expect(response.statusCode).toBe(202);
    await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce());
    await vi.waitFor(async () => expect((await f.store.list())[0]?.operation.state).toBe("succeeded"));
  } finally { await f.app.close(); }
});
it("rechecks CSRF after the lifecycle preflight rather than reusing handler admission", async () => {
  const f = fixture(); let captured: FastifyRequest | undefined;
  f.app.addHook("onRequest", async (request) => { captured = request; });
  f.preflight(() => { if (!captured) throw new Error("fixture-request-missing"); captured.headers["x-csrf-token"] = "invalid"; });
  try {
    const response = await f.app.inject({ method: "POST", url: "/api/v1/servers/test/actions/start", headers: f.headers, payload: {} });
    expect(response.statusCode).toBe(403); expect(response.json().error.code).toBe("CSRF_REJECTED");
    expect(await f.store.list()).toEqual([]); expect(f.start).not.toHaveBeenCalled();
  } finally { await f.app.close(); }
});
it("rejects remote close/reopen during lifecycle preflight without affecting local sessions", async () => {
  const f = fixture(false), remote = fastify({ logger: false, trustProxy: false });
  const boundary = new TailscaleIngressBoundary("manager.test-tail.ts.net");
  const operations = new OperationService(f.store, clock); await operations.initialize();
  const service = new ServerService(new AdapterRegistry([f.adapter]), operations);
  f.auth.installRemote(remote, clock, "local", boundary); registerOperationRoutes(remote, service, clock, "local", f.auth);
  remote.setErrorHandler(async (error, request, reply) => {
    const domain = error instanceof DomainError ? error : undefined;
    await reply.code(domain?.statusCode ?? 500).send(errorResponse(request.id, clock, domain?.code ?? "INTERNAL_ERROR", "Request denied", "local"));
  });
  const token = f.sessions.create("remote-https"); boundary.open();
  f.preflight(() => { boundary.close(); boundary.open(); });
  try {
    const response = await remote.inject({ method: "POST", url: "/api/v1/servers/test/actions/start", payload: {}, headers: {
      host: "manager.test-tail.ts.net", origin: "https://manager.test-tail.ts.net", "x-manager-intent": "local-ui",
      "idempotency-key": randomUUID(), cookie: `__Host-mcsm_remote_session=${token.sessionToken}`, "x-csrf-token": token.csrfToken
    } });
    expect(response.statusCode).toBe(403); expect(response.json().error.code).toBe("INGRESS_REJECTED");
    expect(await f.store.list()).toEqual([]); expect(f.start).not.toHaveBeenCalled();
    const local = f.headers.cookie.slice("mcsm_local_session=".length);
    expect(f.sessions.read(local, "local-http")).toBeDefined();
  } finally { await remote.close(); await service.close(); await f.app.close(); }
});
