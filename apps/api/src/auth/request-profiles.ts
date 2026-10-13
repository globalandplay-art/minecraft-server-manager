import type { IncomingMessage } from "node:http";
import { localSessionCookie, remoteSessionCookie } from "./cookies.js";
import type { SessionProfile } from "./session-core.js";
import { IngressBoundaryError, type TailscaleIngressBoundary } from "./tailscale-ingress-boundary.js";

/** Server-selected bindings only. Headers never choose an authentication profile. */
export class AuthenticationRequestProfiles {
  #closed = false;
  #remote = new WeakMap<IncomingMessage, { boundary: TailscaleIngressBoundary; generation: number }>();
  bindRemote(request: IncomingMessage, boundary: TailscaleIngressBoundary): void {
    if (this.#remote.has(request)) throw new Error("INGRESS_REQUEST_ALREADY_BOUND");
    this.#remote.set(request, { boundary, generation: boundary.generation });
  }
  boundary(request: IncomingMessage): TailscaleIngressBoundary | undefined { return this.#remote.get(request)?.boundary; }
  assert(request: IncomingMessage): void {
    if (this.#closed) throw new IngressBoundaryError("INGRESS_CLOSED");
    const context = this.#remote.get(request);
    if (context && context.generation !== context.boundary.generation) throw new IngressBoundaryError("INGRESS_CLOSED");
    context?.boundary.assertRequest(request);
  }
  close(): void { this.#closed = true; }
  profile(request: IncomingMessage): SessionProfile {
    this.assert(request); return this.#remote.has(request) ? "remote-https" : "local-http";
  }
  cookie(request: IncomingMessage): string | undefined {
    this.assert(request); return this.#remote.has(request) ? remoteSessionCookie(request.headers.cookie) : localSessionCookie(request.headers.cookie);
  }
  cookieHeader(request: IncomingMessage, value: string, clear = false): string {
    this.assert(request);
    return `${this.#remote.has(request) ? "__Host-mcsm_remote_session" : "mcsm_local_session"}=${value}; ${clear ? "Max-Age=0; " : ""}${this.#remote.has(request) ? "Secure; " : ""}HttpOnly; SameSite=Strict; Path=/`;
  }
  originAllowed(request: IncomingMessage, origin: string): boolean {
    this.assert(request);
    const boundary = this.#remote.get(request)?.boundary;
    return boundary ? origin === boundary.origin : ["http://127.0.0.1:3000", "http://localhost:3000", "http://127.0.0.1:8080", "http://localhost:8080"].includes(origin);
  }
}
