import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authStatusResponseSchema, authSessionResponseSchema, authLogoutResponseSchema, authWsTicketResponseSchema, type Mode } from "@mcsm/contracts";
import { localSessionCookie } from "./cookies.js";
import { WebSocketAuthentication } from "./ws-auth.js";
import type { Clock } from "../clock.js";
import { errorResponse, responseMeta, type LocalGuardDenialObserver } from "../infra/http.js";
import { AuthCoreError, PasswordVerifier, validPassword, validUsername } from "./password.js";
import { SessionCore } from "./session-core.js";
import type { AuthAudit, AuthAuditEvent } from "./audit.js";

const COOKIE = "mcsm_local_session";
const COOKIE_FLAGS = "HttpOnly; SameSite=Strict; Path=/";
const AUTH = "/api/v1/auth/";
const mutation = (method: string) => !["GET", "HEAD", "OPTIONS"].includes(method);
export { localSessionCookie } from "./cookies.js";
const credentials = (body: unknown): { username: string; password: string } | undefined => {
  if (typeof body !== "object" || body === null || Array.isArray(body) ||
    Object.keys(body).sort().join(",") !== "password,username") return undefined;
  const value = body as Record<string, unknown>;
  return validUsername(value.username) && validPassword(value.password) ? { username: value.username, password: value.password } : undefined;
};

/** Required local HTTP and event streams share one bounded session core. */
export class HttpAuthentication {
  #verifier: PasswordVerifier; #sessions: SessionCore; #audit: AuthAudit;
  readonly websocket: WebSocketAuthentication;
  constructor(verifier: PasswordVerifier, audit: AuthAudit, sessions = new SessionCore()) {
    this.#verifier = verifier; this.#audit = audit; this.#sessions = sessions;
    this.websocket = new WebSocketAuthentication(sessions, audit);
  }
  async observeLocalGuardDenial(...[event, requestId]: Parameters<LocalGuardDenialObserver>): Promise<boolean> {
    if (event !== "origin-rejected" || !this.#audit.ready()) return false;
    try { await this.#audit.record({ event: "csrf-denial", requestId }); return this.#audit.ready(); }
    catch { return false; }
  }
  install(app: FastifyInstance, clock: Clock, mode: Mode): void {
    const deny = async (request: FastifyRequest, reply: FastifyReply, status: number, code: string,
      event?: AuthAuditEvent["event"]) => {
      if (event && this.#audit.ready()) {
        try { await this.#audit.record({ event, requestId: request.id }); }
        catch { status = 503; code = "AUTH_AUDIT_UNAVAILABLE"; }
      }
      await reply.code(status).send(errorResponse(request.id, clock, code, "Authentication request denied", mode));
    };
    const session = (request: FastifyRequest, refresh = false) => this.#sessions.read(localSessionCookie(request.headers.cookie), "local-http", refresh);
    const response = (request: FastifyRequest, remainingMs: number, csrfToken: string, recentReauthentication: boolean) => ({
      data: { authenticated: true, expiresAt: new Date(clock.now().getTime() + remainingMs).toISOString(), csrfToken, recentReauthentication },
      meta: responseMeta(request.id, clock, mode)
    });
    app.addHook("onRequest", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const exactStatus = request.method === "GET" && request.raw.url === AUTH + "status";
      const exactLogin = request.method === "POST" && request.raw.url === AUTH + "login";
      if (request.headers.upgrade !== undefined) {
        try { this.websocket.early(request); }
        catch { await deny(request, reply, this.#audit.ready() ? 403 : 503, this.#audit.ready() ? "AUTH_WS_REJECTED" : "AUTH_AUDIT_UNAVAILABLE", "ws-denial"); }
        return;
      }
      if (exactStatus) return;
      if (!this.#audit.ready()) { await deny(request, reply, 503, "AUTH_AUDIT_UNAVAILABLE"); return; }
      try {
        const expired = this.#sessions.takeExpiredCount();
        for (let index = 0; index < expired; index++) await this.#audit.record({ event: "session-expiry", requestId: request.id });
      } catch { await deny(request, reply, this.#audit.ready() ? 401 : 503, this.#audit.ready() ? "AUTH_REQUIRED" : "AUTH_AUDIT_UNAVAILABLE"); return; }
      if (!exactLogin) {
        try { session(request); }
        catch { await deny(request, reply, 401, "AUTH_REQUIRED", "auth-denial"); return; }
      }
      if (mutation(request.method)) {
        // The preceding local guard has already checked exact allowed Origin values.
        if (!request.headers.origin || request.headers["x-manager-intent"] !== "local-ui" ||
          (request.headers["sec-fetch-site"] !== undefined && !["same-origin", "same-site", "none"].includes(String(request.headers["sec-fetch-site"])))) {
          await deny(request, reply, 403, "ORIGIN_REJECTED", "csrf-denial"); return;
        }
        if (!exactLogin) {
          try { this.#sessions.validateCsrf(localSessionCookie(request.headers.cookie), "local-http", request.headers["x-csrf-token"]); }
          catch { await deny(request, reply, 403, "CSRF_REJECTED", "csrf-denial"); return; }
        }
        if (exactLogin || request.raw.url === AUTH + "reauth" || request.raw.url === AUTH + "logout" || request.raw.url === AUTH + "ws-ticket") {
          const type = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
          if (type !== "application/json" || request.headers["content-encoding"] !== undefined) {
            await deny(request, reply, 415, "AUTH_CONTENT_TYPE"); return;
          }
        }
      }
      if (!exactLogin) {
        try { session(request, true); }
        catch { await deny(request, reply, 401, "AUTH_REQUIRED"); }
      }
    });
    const auditReady = () => this.#audit.ready();
    const auditRecord = (event: AuthAuditEvent) => this.#audit.record(event);
    const validateCsrf = (request: FastifyRequest) => this.#sessions.validateCsrf(localSessionCookie(request.headers.cookie), "local-http", request.headers["x-csrf-token"]);
    app.addHook("onRoute", (route) => {
      // WS handlers have a socket/request signature; final admission is verifyClient.
      if (route.websocket === true || route.wsHandler !== undefined) return;
      const handler = route.handler;
      route.handler = async function (request, reply) {
        const exactStatus = request.method === "GET" && request.raw.url === AUTH + "status";
        const exactLogin = request.method === "POST" && request.raw.url === AUTH + "login";
        if (request.headers.upgrade !== undefined) return deny(request, reply, 403, "AUTH_WS_UNAVAILABLE", "ws-denial");
        if (exactStatus) return handler.call(this, request, reply);
        if (!auditReady()) return deny(request, reply, 503, "AUTH_AUDIT_UNAVAILABLE");
        if (!exactLogin) {
          try { session(request); }
          catch { return deny(request, reply, 401, "AUTH_REQUIRED", "auth-denial"); }
          if (mutation(request.method)) {
            try { validateCsrf(request); }
            catch { return deny(request, reply, 403, "CSRF_REJECTED", "csrf-denial"); }
            if (!request.raw.url?.startsWith(AUTH)) {
              try { await auditRecord({ event: "mutation-admission", requestId: request.id }); }
              catch { return deny(request, reply, 503, "AUTH_AUDIT_UNAVAILABLE"); }
            }
          }
        }
        // Parser, route hooks and audit may have awaited. No await is allowed between
        // these last synchronous checks and invoking the handler/service admission.
        if (!auditReady()) return deny(request, reply, 503, "AUTH_AUDIT_UNAVAILABLE");
        if (!exactLogin) {
          try { session(request); }
          catch { return deny(request, reply, 401, "AUTH_REQUIRED", "auth-denial"); }
          if (mutation(request.method)) {
            try { validateCsrf(request); }
            catch { return deny(request, reply, 403, "CSRF_REJECTED", "csrf-denial"); }
          }
        }
        if (!auditReady()) return deny(request, reply, 503, "AUTH_AUDIT_UNAVAILABLE");
        return handler.call(this, request, reply);
      };
    });
    // Apply even when the local guard rejects before the auth hook or a handler sets cache headers.
    app.addHook("onSend", async (_request, reply, payload) => { reply.header("Cache-Control", "no-store"); return payload; });
    app.addHook("preClose", async () => { this.websocket.close(); this.#sessions.clear(); });
    app.addHook("onClose", async () => { await this.#audit.close(); });
    app.get(AUTH + "status", { exposeHeadRoute: false, schema: { response: { 200: authStatusResponseSchema } } }, async () => ({ data: {
      configured: true, authenticationRequired: true, auditReady: this.#audit.ready()
    } }));
    const passwordRoute = (kind: "login" | "reauth") => {
      app.post(AUTH + kind, { bodyLimit: 2048, schema: { response: { 200: authSessionResponseSchema } } }, async (request, reply) => {
        if (request.raw.url !== AUTH + kind) { await deny(request, reply, 400, "VALIDATION_ERROR"); return; }
        const input = credentials(request.body);
        if (!input) { await deny(request, reply, 400, "VALIDATION_ERROR"); return; }
        try { await this.#verifier.verify(input.username, input.password); }
        catch (error) {
          const throttled = error instanceof AuthCoreError && ["AUTH_BUSY", "AUTH_RATE_LIMITED", "AUTH_CAPACITY"].includes(error.code);
          if (throttled) reply.header("Retry-After", error.retryAfterSeconds ?? 1);
          await deny(request, reply, throttled ? 429 : 401, throttled ? "AUTH_THROTTLED" : "AUTH_INVALID", kind === "login" ? "login-failure" : "reauth-failure"); return;
        }
        if (kind === "reauth") {
          try {
            session(request); await this.#audit.record({ event: "reauth-success", requestId: request.id });
            if (!this.#audit.ready()) throw new AuthCoreError("AUTH_PRIVATE_UNSAFE");
            this.#sessions.markReauthenticated(localSessionCookie(request.headers.cookie), "local-http");
            const view = session(request);
            if (!this.#audit.ready()) throw new AuthCoreError("AUTH_PRIVATE_UNSAFE");
            return response(request, view.remainingMs, view.csrfToken, view.recentReauthentication);
          } catch { await deny(request, reply, this.#audit.ready() ? 401 : 503, this.#audit.ready() ? "AUTH_REQUIRED" : "AUTH_AUDIT_UNAVAILABLE"); return; }
        }
        let created: ReturnType<SessionCore["create"]> | undefined;
        try {
          created = this.#sessions.create("local-http", localSessionCookie(request.headers.cookie));
          await this.#audit.record({ event: "login-success", requestId: request.id });
          if (!this.#audit.ready()) throw new AuthCoreError("AUTH_PRIVATE_UNSAFE");
          const view = this.#sessions.read(created.sessionToken, "local-http");
          if (!this.#audit.ready()) throw new AuthCoreError("AUTH_PRIVATE_UNSAFE");
          reply.header("Set-Cookie", `${COOKIE}=${created.sessionToken}; ${COOKIE_FLAGS}`);
          return response(request, view.remainingMs, view.csrfToken, view.recentReauthentication);
        } catch (error) {
          if (created) { try { this.#sessions.revoke(created.sessionToken, "local-http"); } catch { /* Already expired/revoked. */ } }
          await deny(request, reply, error instanceof AuthCoreError && error.code === "AUTH_CAPACITY" ? 429 : 503,
            this.#audit.ready() ? "AUTH_UNAVAILABLE" : "AUTH_AUDIT_UNAVAILABLE");
        }
      });
    };
    passwordRoute("login"); passwordRoute("reauth");
    app.get(AUTH + "session", { schema: { response: { 200: authSessionResponseSchema } } }, async (request, reply) => {
      if (request.raw.url !== AUTH + "session") { await deny(request, reply, 400, "VALIDATION_ERROR"); return; }
      try {
        const view = session(request);
        if (!this.#audit.ready()) throw new AuthCoreError("AUTH_PRIVATE_UNSAFE");
        return response(request, view.remainingMs, view.csrfToken, view.recentReauthentication);
      } catch { await deny(request, reply, this.#audit.ready() ? 401 : 503, this.#audit.ready() ? "AUTH_REQUIRED" : "AUTH_AUDIT_UNAVAILABLE"); }
    });
    app.post(AUTH + "ws-ticket", { bodyLimit: 2048, schema: { response: { 200: authWsTicketResponseSchema } } }, async (request, reply) => {
      const body = request.body as Record<string, unknown> | null;
      if (request.raw.url !== AUTH + "ws-ticket" || !body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).join(",") !== "serverId" || typeof body.serverId !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/u.test(body.serverId)) {
        await deny(request, reply, 400, "VALIDATION_ERROR"); return;
      }
      try {
        await this.#audit.record({ event: "ws-ticket", requestId: request.id });
        if (!this.#audit.ready()) throw new AuthCoreError("AUTH_PRIVATE_UNSAFE");
        this.#sessions.validateCsrf(localSessionCookie(request.headers.cookie), "local-http", request.headers["x-csrf-token"]);
        const issued = this.#sessions.issueTicket(localSessionCookie(request.headers.cookie), "local-http", body.serverId, request.headers.origin!);
        if (!this.#audit.ready()) throw new AuthCoreError("AUTH_PRIVATE_UNSAFE");
        return { data: { ticket: issued.ticket, expiresAt: new Date(clock.now().getTime() + issued.remainingMs).toISOString() }, meta: responseMeta(request.id, clock, mode) };
      } catch (error) {
        const capacity = error instanceof AuthCoreError && error.code === "AUTH_CAPACITY";
        await deny(request, reply, !this.#audit.ready() ? 503 : capacity ? 429 : 401,
          !this.#audit.ready() ? "AUTH_AUDIT_UNAVAILABLE" : capacity ? "AUTH_CAPACITY" : "AUTH_REQUIRED");
      }
    });
    app.post(AUTH + "logout", { bodyLimit: 2048, schema: { response: { 200: authLogoutResponseSchema } } }, async (request, reply) => {
      if (request.raw.url !== AUTH + "logout" || typeof request.body !== "object" || request.body === null || Array.isArray(request.body) || Object.keys(request.body).length) {
        await deny(request, reply, 400, "VALIDATION_ERROR"); return;
      }
      try { this.#sessions.revoke(localSessionCookie(request.headers.cookie), "local-http"); }
      catch { await deny(request, reply, 401, "AUTH_REQUIRED"); return; }
      reply.header("Set-Cookie", `${COOKIE}=; Max-Age=0; ${COOKIE_FLAGS}`);
      try {
        await this.#audit.record({ event: "logout", requestId: request.id });
        if (!this.#audit.ready()) throw new AuthCoreError("AUTH_PRIVATE_UNSAFE");
      }
      catch { await deny(request, reply, 503, "AUTH_AUDIT_UNAVAILABLE"); return; }
      return { data: { authenticated: false }, meta: responseMeta(request.id, clock, mode) };
    });
  }
}
