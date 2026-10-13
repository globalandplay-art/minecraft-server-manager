import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";

export type IngressBoundaryCode = "INGRESS_CLOSED" | "INGRESS_PEER_REJECTED" | "INGRESS_HEADERS_REJECTED" | "INGRESS_HOST_REJECTED" | "INGRESS_ORIGIN_REJECTED";
export class IngressBoundaryError extends Error {
  constructor(readonly code: IngressBoundaryCode) { super(code); }
}

const sensitive = new Set(["host", "origin", "cookie", "authorization", "upgrade", "sec-websocket-protocol",
  "sec-websocket-version", "sec-websocket-key", "sec-websocket-origin", "x-csrf-token", "x-manager-intent"]);
const loopback = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const reject = (code: IngressBoundaryCode): never => { throw new IngressBoundaryError(code); };

/** A request-shape boundary, NOT authentication or proof of proxy provenance.
 * Only a dedicated owned listener may use this; never install on the local app.
 * No production constructor is wired. Its controller must prove route/owner/auth
 * readiness before opening, and separately recheck it at final service admission.
 */
export class TailscaleIngressBoundary {
  readonly authority: string;
  readonly origin: string;
  #open = false;
  #generation = 0;
  #closeObserver: (() => void) | undefined;
  constructor(authority: string) {
    // Canonical ASCII MagicDNS HTTPS authority only: no URL, wildcard or port.
    const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
    if (authority.length > 253 || !new RegExp(`^${label}\\.${label}\\.ts\\.net$`, "u").test(authority)) {
      throw new Error("INGRESS_AUTHORITY_INVALID");
    }
    this.authority = authority; this.origin = `https://${authority}`;
    Object.freeze(this);
  }
  /** Internal lifecycle control, not exposed through an HTTP request or headers. */
  open(): void { if (!this.#open) { this.#advance(); this.#open = true; } }
  close(): void { this.#open = false; this.#advance(); this.#closeObserver?.(); }
  #advance(): void {
    if (this.#generation === Number.MAX_SAFE_INTEGER) { this.#open = false; throw new Error("INGRESS_GENERATION_EXHAUSTED"); }
    this.#generation++;
  }
  get generation(): number { return this.#generation; }
  /** One owning authentication controller; replacing an observer is forbidden. */
  observeClose(observer: () => void): void {
    if (this.#closeObserver) throw new Error("INGRESS_OWNER_ALREADY_BOUND");
    this.#closeObserver = observer;
  }
  get admitting(): boolean { return this.#open; }
  assertRequest(request: IncomingMessage): void {
    if (!this.#open) reject("INGRESS_CLOSED");
    if (!loopback.has(request.socket.remoteAddress ?? "")) reject("INGRESS_PEER_REJECTED");
    const counts = new Map<string, number>();
    // Node may discard duplicates from normalized headers. Inspect the wire list.
    if (request.rawHeaders.length % 2 !== 0) reject("INGRESS_HEADERS_REJECTED");
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index]!.toLowerCase();
      if (sensitive.has(name) || name.startsWith("x-forwarded-") || name.startsWith("tailscale-") || name === "forwarded") {
        const count = (counts.get(name) ?? 0) + 1; counts.set(name, count);
        if (count !== 1) reject("INGRESS_HEADERS_REJECTED");
      }
    }
    const headers = request.headers;
    if (counts.get("host") !== 1 || headers.host !== this.authority) reject("INGRESS_HOST_REJECTED");
    const requiresOrigin = !["GET", "HEAD", "OPTIONS"].includes(request.method ?? "") || headers.upgrade !== undefined;
    if ((requiresOrigin && headers.origin === undefined) || (headers.origin !== undefined && headers.origin !== this.origin)) {
      reject("INGRESS_ORIGIN_REJECTED");
    }
    for (const name of Object.keys(headers)) {
      if (name === "forwarded" || (name.startsWith("x-forwarded-") && !["x-forwarded-host", "x-forwarded-proto", "x-forwarded-for"].includes(name))) {
        reject("INGRESS_HEADERS_REJECTED");
      }
    }
    // Pinned Serve adds these. They only corroborate an already fixed authority;
    // never select a provider, principal, client address or secure-cookie policy.
    if ((headers["x-forwarded-host"] !== undefined && headers["x-forwarded-host"] !== this.authority) ||
      (headers["x-forwarded-proto"] !== undefined && headers["x-forwarded-proto"] !== "https")) reject("INGRESS_HEADERS_REJECTED");
    const forwardedFor = headers["x-forwarded-for"];
    if (forwardedFor !== undefined && (typeof forwardedFor !== "string" || isIP(forwardedFor) === 0)) reject("INGRESS_HEADERS_REJECTED");
    // Identity/app-capability metadata is intentionally not read or returned.
    // Reject Funnel-marked requests. Absence does not prove private provenance:
    // the controller must separately verify Funnel-off and route ownership.
    if (headers["tailscale-funnel-request"] !== undefined) reject("INGRESS_HEADERS_REJECTED");
  }
}
