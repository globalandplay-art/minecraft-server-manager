import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import type { AuthAudit, AuthAuditEvent } from "./audit.js";
import { localSessionCookie } from "./cookies.js";
import { AuthCoreError } from "./password.js";
import { SessionCore } from "./session-core.js";

export const EVENTS_PROTOCOL = "mcsm.events.v1";
type Prepared = { socketId: string; requestId: string; serverId: string; origin: string; transport: Duplex };
type Reservation = { requestId: string; transport: Duplex; socket?: WebSocket; cleanup?: () => void; closing: boolean };
const invalid = () => new AuthCoreError("AUTH_INVALID");

/** Authenticated upgrades are restricted to the existing event route and nonsecret replay cursor. */
export function websocketServerId(method: string, url: string | undefined): string | undefined {
  if (method !== "GET" || !url) return undefined;
  const serverId = /^\/ws\/v1\/servers\/([a-z0-9][a-z0-9-]{0,62})\/events(?:\?[^#]*)?$/u.exec(url)?.[1];
  if (!serverId) return undefined;
  const marker = url.indexOf("?");
  if (marker >= 0) {
    const query = url.slice(marker + 1);
    // Check original keys before AJV can remove unknown or coerce duplicate query values.
    const keys = query.split("&").map((part) => part.split("=", 1)[0]);
    if (keys.length !== 2 || keys.filter((key) => key === "streamId").length !== 1 || keys.filter((key) => key === "afterSequence").length !== 1) return undefined;
    const values = new URLSearchParams(query); const streamId = values.get("streamId")!; const sequence = values.get("afterSequence")!;
    if ([...streamId].length < 1 || [...streamId].length > 128 || !/^\d+$/u.test(sequence) || !Number.isSafeInteger(Number(sequence))) return undefined;
  }
  return serverId;
}
function handshake(request: IncomingMessage): { raw: string; ticket: string; origin: string; serverId: string } {
  const serverId = websocketServerId(request.method ?? "", request.url);
  const headers = request.headers;
  for (const name of ["origin", "cookie", "sec-websocket-protocol", "sec-websocket-version", "sec-websocket-origin"]) {
    const occurrences = (request.rawHeaders ?? []).filter((value, index) => index % 2 === 0 && value.toLowerCase() === name).length;
    if (occurrences > 1) throw invalid();
  }
  if (!serverId || String(headers["sec-websocket-version"]) !== "13" || headers["sec-websocket-origin"] !== undefined ||
    headers.upgrade?.toLowerCase() !== "websocket" || typeof headers.origin !== "string" ||
    !["http://127.0.0.1:3000", "http://localhost:3000", "http://127.0.0.1:8080", "http://localhost:8080"].includes(headers.origin)) throw invalid();
  const protocols = headers["sec-websocket-protocol"];
  if (typeof protocols !== "string" || protocols.length > 128) throw invalid();
  const offered = protocols.split(",").map((entry) => entry.trim());
  const tickets = offered.filter((entry) => /^ticket\.[A-Za-z0-9_-]{43}$/u.test(entry));
  const raw = localSessionCookie(headers.cookie);
  if (offered.length !== 2 || offered.filter((entry) => entry === EVENTS_PROTOCOL).length !== 1 || tickets.length !== 1 || !raw) throw invalid();
  return { raw, ticket: tickets[0]!.slice(7), origin: headers.origin, serverId };
}

/** Weak handshake context contains no bearer. Final consumption and reservation are synchronous. */
export class WebSocketAuthentication {
  #prepared = new WeakMap<IncomingMessage, Prepared>();
  #reservations = new Map<string, Reservation>();
  #timer: NodeJS.Timeout | undefined;
  #closed = false;
  constructor(private readonly sessions: SessionCore, private readonly audit: AuthAudit) {
    sessions.observeSocketRevocation((id) => this.#stop(id, true));
  }
  ready(): boolean { return !this.#closed && this.audit.ready(); }
  early(request: FastifyRequest): void {
    if (!this.audit.ready() || this.#closed) throw invalid();
    const value = handshake(request.raw);
    this.sessions.inspectTicket(value.raw, "local-http", value.ticket, value.serverId, value.origin);
  }
  async prepare(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    this.early(request);
    const serverId = websocketServerId(request.method, request.raw.url)!;
    await this.audit.record({ event: "ws-open", requestId: request.id });
    this.early(request);
    this.#prepared.set(request.raw, { socketId: randomUUID(), requestId: request.id, serverId,
      origin: request.headers.origin!, transport: reply.raw.socket! });
  }
  /** ws invokes this immediately before completeUpgrade, with no intervening asynchronous step. */
  verify(request: IncomingMessage): boolean {
    const context = this.#prepared.get(request);
    this.#prepared.delete(request);
    if (!context || this.#closed || !this.audit.ready()) return false;
    try {
      const value = handshake(request);
      if (value.serverId !== context.serverId || value.origin !== context.origin) throw invalid();
      this.sessions.consumeTicket(value.raw, "local-http", value.ticket, value.serverId, value.origin);
      this.sessions.reserveSocket(value.raw, "local-http", context.socketId);
      this.#reservations.set(context.socketId, { requestId: context.requestId, transport: context.transport, closing: false });
      // completeUpgrade can still abort after verifyClient. Close owns release in both cases.
      context.transport.once("close", () => this.#release(context.socketId));
      this.#prepared.set(request, context);
      this.#schedule();
      // Core pruning can synchronously revoke another socket and exhaust the audit queue.
      // Check after every consuming/reserving/scheduling side effect, immediately before101.
      if (!this.ready()) throw invalid();
      return true;
    } catch {
      this.#prepared.delete(request);
      this.#release(context.socketId);
      return false;
    }
  }
  attach(request: IncomingMessage, socket: WebSocket, cleanup: () => void): (() => boolean) | undefined {
    const context = this.#prepared.get(request); this.#prepared.delete(request);
    // Protocol negotiation is complete now; minimize bearer retention by the plugin request.
    delete request.headers.cookie; delete request.headers["sec-websocket-protocol"];
    if (request.rawHeaders) request.rawHeaders = request.rawHeaders.filter((_value, index, entries) =>
      !["cookie", "sec-websocket-protocol"].includes(entries[index - index % 2]!.toLowerCase()));
    if (!context) { socket.close(1008, "authentication-required"); return undefined; }
    const reservation = this.#reservations.get(context.socketId);
    if (!reservation) { socket.close(1008, "authentication-required"); return undefined; }
    reservation.socket = socket; reservation.cleanup = cleanup;
    socket.once("close", () => this.#release(context.socketId));
    const live = () => this.#live(context.socketId);
    if (!live()) return undefined;
    return live;
  }
  #live(id: string): boolean {
    const reservation = this.#reservations.get(id);
    if (!reservation || reservation.closing) return false;
    try {
      if (this.#closed || !this.audit.ready()) throw invalid();
      this.sessions.socketRemaining(id);
      if (!this.ready()) throw invalid();
      return true;
    } catch { this.#stop(id, true); return false; }
  }
  #record(event: AuthAuditEvent["event"], requestId: string): void {
    if (!this.audit.ready()) return;
    void this.audit.record({ event, requestId }).then(() => {
      if (!this.audit.ready()) for (const id of this.#reservations.keys()) this.#stop(id, true);
    }).catch(() => { for (const id of this.#reservations.keys()) this.#stop(id, true); });
  }
  #stop(id: string, revoked: boolean): void {
    const value = this.#reservations.get(id);
    if (!value || value.closing) return;
    value.closing = true; value.cleanup?.();
    if (value.socket) value.socket.close(1008, "authentication-required");
    else value.transport.destroy();
    if (revoked) this.#record("ws-revocation", value.requestId);
  }
  #release(id: string): void {
    const value = this.#reservations.get(id); if (!value) return;
    value.cleanup?.(); this.#reservations.delete(id); this.sessions.releaseSocket(id);
    this.#record("ws-close", value.requestId);
    this.#schedule();
  }
  #schedule(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#closed || !this.#reservations.size) return;
    let delay = 1000;
    for (const [id, value] of this.#reservations) {
      if (value.closing) continue;
      try { delay = Math.min(delay, this.sessions.socketRemaining(id)); }
      catch { this.#stop(id, true); }
    }
    this.#timer = setTimeout(() => {
      for (const id of this.#reservations.keys()) this.#live(id);
      this.#schedule();
    }, Math.max(1, delay));
    this.#timer.unref();
  }
  close(): void {
    this.#closed = true; if (this.#timer) clearTimeout(this.#timer);
    for (const id of this.#reservations.keys()) this.#stop(id, true);
  }
}
