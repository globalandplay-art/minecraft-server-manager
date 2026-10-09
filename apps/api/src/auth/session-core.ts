import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";
import { AuthCoreError, type MonotonicNow } from "./password.js";

export type SessionProfile = "local-http" | "remote-https";
const IDLE_MS = 30 * 60_000;
const ABSOLUTE_MS = 8 * 60 * 60_000;
const TICKET_MS = 30_000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const validToken = (value: unknown): value is string => typeof value === "string" && TOKEN.test(value) && Buffer.from(value, "base64url").toString("base64url") === value;
type Session = { profile: SessionProfile; csrfToken: string; csrfDigest: string; idle: number; absolute: number; reauthenticatedUntil: number; sockets: Set<string> };
type Ticket = { sessionDigest: string; serverId: string; origin: string; expires: number };
export type SessionView = Readonly<{ csrfToken: string; remainingMs: number; recentReauthentication: boolean }>;
const invalid = () => new AuthCoreError("AUTH_INVALID");

/** Ephemeral bounded state. Socket reservations survive revocation until transport close. */
export class SessionCore {
  #sessions = new Map<string, Session>();
  #tickets = new Map<string, Ticket>();
  #last = 0;
  #expired = 0;
  #sockets = new Map<string, { sessionDigest: string; profile: SessionProfile }>();
  #socketRevoked: ((socketId: string) => void) | undefined;
  constructor(private readonly now: MonotonicNow = () => performance.now()) {}
  observeSocketRevocation(observer: (socketId: string) => void): void {
    if (this.#socketRevoked) throw invalid();
    this.#socketRevoked = observer;
  }
  #time(): number {
    const time = this.now();
    if (!Number.isFinite(time) || time < this.#last) { this.clear(); throw invalid(); }
    this.#last = time;
    this.#prune(time);
    return time;
  }
  #remove(key: string): void {
    const session = this.#sessions.get(key);
    this.#sessions.delete(key);
    if (session) {
      session.csrfToken = ""; session.csrfDigest = "";
      for (const socketId of session.sockets) this.#socketRevoked?.(socketId);
      session.sockets.clear();
    }
    for (const [ticketKey, ticket] of this.#tickets) if (ticket.sessionDigest === key) this.#tickets.delete(ticketKey);
  }
  #prune(time: number): void {
    for (const [key, session] of this.#sessions) if (time >= Math.min(session.idle, session.absolute)) { this.#expired++; this.#remove(key); }
    for (const [key, ticket] of this.#tickets) if (time >= ticket.expires) this.#tickets.delete(key);
  }
  #session(raw: unknown, profile: SessionProfile): { key: string; session: Session; time: number } {
    const time = this.#time();
    if (!validToken(raw)) throw invalid();
    const key = digest(raw); const session = this.#sessions.get(key);
    if (!session || session.profile !== profile) throw invalid();
    return { key, session, time };
  }
  /** Caller must first complete PasswordVerifier.verify. No session fixation or eviction. */
  create(profile: SessionProfile, priorToken?: string): { sessionToken: string; csrfToken: string; remainingMs: number } {
    const time = this.#time();
    if (!["local-http", "remote-https"].includes(profile)) throw invalid();
    // Rotation is restricted to the same transport profile.
    if (validToken(priorToken)) {
      const priorKey = digest(priorToken);
      if (this.#sessions.get(priorKey)?.profile === profile) this.#remove(priorKey);
    }
    if (this.#sessions.size >= 8) throw new AuthCoreError("AUTH_CAPACITY");
    const raw = token(); const key = digest(raw); const csrfToken = token();
    if (this.#sessions.has(key)) throw invalid();
    this.#sessions.set(key, { profile, csrfToken, csrfDigest: digest(csrfToken), idle: time + IDLE_MS, absolute: time + ABSOLUTE_MS, reauthenticatedUntil: time + 5 * 60_000, sockets: new Set() });
    return { sessionToken: raw, csrfToken, remainingMs: IDLE_MS };
  }
  read(raw: unknown, profile: SessionProfile, refreshIdle = false): SessionView {
    const { session, time } = this.#session(raw, profile);
    if (refreshIdle) session.idle = Math.min(time + IDLE_MS, session.absolute);
    return Object.freeze({ csrfToken: session.csrfToken, remainingMs: Math.min(session.idle, session.absolute) - time, recentReauthentication: time < session.reauthenticatedUntil });
  }
  /** Caller has just verified the password; HTTP must revalidate after that asynchronous work. */
  markReauthenticated(raw: unknown, profile: SessionProfile): void {
    const { session, time } = this.#session(raw, profile);
    session.reauthenticatedUntil = Math.min(time + 5 * 60_000, session.absolute);
  }
  validateCsrf(raw: unknown, profile: SessionProfile, csrf: unknown): void {
    const { session } = this.#session(raw, profile);
    if (!validToken(csrf) || !timingSafeEqual(Buffer.from(digest(csrf), "hex"), Buffer.from(session.csrfDigest, "hex"))) throw invalid();
  }
  revoke(raw: unknown, profile: SessionProfile): void {
    const { key } = this.#session(raw, profile); this.#remove(key);
  }
  clear(): void { for (const key of this.#sessions.keys()) this.#remove(key); this.#tickets.clear(); }
  /** At most eight expirations between admissions; never exposes tokens or identifiers. */
  takeExpiredCount(): number { this.#time(); const count = this.#expired; this.#expired = 0; return count; }
  nextDeadline(): number | undefined {
    this.#time();
    const deadlines = [...this.#sessions.values()].map((session) => Math.min(session.idle, session.absolute));
    return deadlines.length ? Math.min(...deadlines) : undefined;
  }
  issueTicket(raw: unknown, profile: SessionProfile, serverId: string, exactOrigin: string): { ticket: string; remainingMs: number } {
    const { key, time } = this.#session(raw, profile);
    if (typeof serverId !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/u.test(serverId) || typeof exactOrigin !== "string" || exactOrigin.length > 512) throw invalid();
    let origin: URL;
    try { origin = new URL(exactOrigin); } catch { throw invalid(); }
    if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== exactOrigin) throw invalid();
    if ([...this.#tickets.values()].filter((ticket) => ticket.sessionDigest === key).length >= 8) throw new AuthCoreError("AUTH_CAPACITY");
    const ticket = token(); const ticketKey = digest(ticket);
    if (this.#tickets.has(ticketKey)) throw invalid();
    this.#tickets.set(ticketKey, { sessionDigest: key, serverId, origin: exactOrigin, expires: time + TICKET_MS });
    return { ticket, remainingMs: TICKET_MS };
  }
  /** Consume even a rejected binding: callers must obtain a fresh ticket for every attempt. */
  consumeTicket(raw: unknown, profile: SessionProfile, rawTicket: unknown, serverId: string, exactOrigin: string): void {
    this.inspectTicket(raw, profile, rawTicket, serverId, exactOrigin);
    this.#tickets.delete(digest(rawTicket as string));
  }
  /** Valid early inspection does not consume; invalid bindings burn the presented ticket. */
  inspectTicket(raw: unknown, profile: SessionProfile, rawTicket: unknown, serverId: string, exactOrigin: string): void {
    this.#time();
    if (!validToken(rawTicket)) throw invalid();
    const ticketKey = digest(rawTicket); const ticket = this.#tickets.get(ticketKey);
    try {
      const { key } = this.#session(raw, profile);
      if (!ticket || ticket.sessionDigest !== key || ticket.serverId !== serverId || ticket.origin !== exactOrigin) throw invalid();
    } catch (error) { this.#tickets.delete(ticketKey); throw error; }
  }
  /** Admission bookkeeping only; raw session/ticket values are never socket identifiers. */
  reserveSocket(raw: unknown, profile: SessionProfile, socketId: string): void {
    const { key, session } = this.#session(raw, profile);
    if (typeof socketId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(socketId) || this.#sockets.has(socketId)) throw invalid();
    if ([...this.#sockets.values()].filter((s) => s.sessionDigest === key).length >= 4 || this.#sockets.size >= 32) throw new AuthCoreError("AUTH_CAPACITY");
    session.sockets.add(socketId);
    this.#sockets.set(socketId, { sessionDigest: key, profile });
  }
  socketRemaining(socketId: string): number {
    const time = this.#time(); const binding = this.#sockets.get(socketId);
    const session = binding && this.#sessions.get(binding.sessionDigest);
    if (!session || session.profile !== binding?.profile) throw invalid();
    return Math.min(session.idle, session.absolute) - time;
  }
  releaseSocket(socketId: string): void {
    const binding = this.#sockets.get(socketId);
    if (binding) this.#sessions.get(binding.sessionDigest)?.sockets.delete(socketId);
    this.#sockets.delete(socketId);
  }
}
