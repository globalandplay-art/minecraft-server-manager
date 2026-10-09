import { describe, expect, it } from "vitest";
import { SessionCore } from "../../src/auth/session-core.js";

const LOCAL = "local-http";
const ORIGIN = "http://127.0.0.1:3000";
const invalid = { code: "AUTH_INVALID" };
describe("bounded ephemeral session/ticket core", () => {
  it("issues fresh 256-bit bearers, freezes views, keeps bearer/tickets hidden and separates profiles", () => {
    const core = new SessionCore(() => 0); const first = core.create(LOCAL); const second = core.create(LOCAL);
    expect(first.sessionToken).toHaveLength(43); expect(first.csrfToken).toHaveLength(43);
    expect(first.sessionToken).not.toBe(second.sessionToken); expect(first.csrfToken).not.toBe(second.csrfToken);
    expect(core.read(first.sessionToken, LOCAL).csrfToken).toBe(first.csrfToken);
    expect(Object.isFrozen(core.read(first.sessionToken, LOCAL))).toBe(true);
    expect(() => core.read(first.sessionToken, "remote-https")).toThrowError(expect.objectContaining(invalid));
    core.validateCsrf(first.sessionToken, LOCAL, first.csrfToken);
    expect(() => core.validateCsrf(first.sessionToken, LOCAL, second.csrfToken)).toThrowError(expect.objectContaining(invalid));
    expect(JSON.stringify(core)).toBe("{}");
    core.create("remote-https", first.sessionToken); expect(core.read(first.sessionToken, LOCAL)).toBeDefined();
    const rotated = core.create(LOCAL, first.sessionToken);
    expect(rotated.sessionToken).not.toBe(first.sessionToken);
    expect(() => core.read(first.sessionToken, LOCAL)).toThrowError(expect.objectContaining(invalid));
  });
  it("bounds eight sessions without evicting live ones; expired records release capacity", () => {
    let time = 0; const core = new SessionCore(() => time); const sessions = Array.from({ length: 8 }, () => core.create(LOCAL));
    expect(() => core.create(LOCAL)).toThrowError(expect.objectContaining({ code: "AUTH_CAPACITY" }));
    expect(core.read(sessions[0]!.sessionToken, LOCAL)).toBeDefined();
    time = 30 * 60_000; expect(core.create(LOCAL)).toBeDefined();
    expect(() => core.read(sessions[0]!.sessionToken, LOCAL)).toThrowError(expect.objectContaining(invalid));
  });
  it("HTTP touches extend idle only, absolute expiry is fixed and read/WS activity does not extend idle", () => {
    let time = 0; const core = new SessionCore(() => time); const session = core.create(LOCAL);
    time = 29 * 60_000; core.read(session.sessionToken, LOCAL); core.issueTicket(session.sessionToken, LOCAL, "server-a", ORIGIN);
    time = 30 * 60_000;
    expect(() => core.read(session.sessionToken, LOCAL)).toThrowError(expect.objectContaining(invalid));
    const fresh = core.create(LOCAL); const absolute = time + 8 * 60 * 60_000;
    for (time += 20 * 60_000; time < absolute; time += 20 * 60_000) core.read(fresh.sessionToken, LOCAL, true);
    time = absolute - 1; expect(core.read(fresh.sessionToken, LOCAL, true).remainingMs).toBe(1);
    time++; expect(() => core.read(fresh.sessionToken, LOCAL, true)).toThrowError(expect.objectContaining(invalid));
  });
  it.each(["server", "origin", "session", "profile"])("consumes one-use ticket on rejected %s binding", (mismatch) => {
    const core = new SessionCore(() => 0); const first = core.create(LOCAL); const second = core.create(LOCAL);
    const { ticket } = core.issueTicket(first.sessionToken, LOCAL, "server-a", ORIGIN);
    expect(() => core.consumeTicket(mismatch === "session" ? second.sessionToken : first.sessionToken,
      mismatch === "profile" ? "remote-https" : LOCAL, ticket, mismatch === "server" ? "server-b" : "server-a", mismatch === "origin" ? "http://localhost:3000" : ORIGIN)).toThrowError(expect.objectContaining(invalid));
    expect(() => core.consumeTicket(first.sessionToken, LOCAL, ticket, "server-a", ORIGIN)).toThrowError(expect.objectContaining(invalid));
  });
  it("accepts a ticket once, rejects reuse and exact 30-second expiry; pending quota prunes", () => {
    let time = 0; const core = new SessionCore(() => time); const session = core.create(LOCAL);
    const issue = () => core.issueTicket(session.sessionToken, LOCAL, "server-a", ORIGIN);
    const { ticket } = issue(); core.consumeTicket(session.sessionToken, LOCAL, ticket, "server-a", ORIGIN);
    expect(() => core.consumeTicket(session.sessionToken, LOCAL, ticket, "server-a", ORIGIN)).toThrowError(expect.objectContaining(invalid));
    const pending = Array.from({ length: 8 }, issue);
    expect(() => issue()).toThrowError(expect.objectContaining({ code: "AUTH_CAPACITY" }));
    time = 30_000; expect(issue()).toBeDefined();
    expect(() => core.consumeTicket(session.sessionToken, LOCAL, pending[0]!.ticket, "server-a", ORIGIN)).toThrowError(expect.objectContaining(invalid));
  });
  it("revoke/reset/restart destroy session, CSRF and tickets; backwards/invalid clock fails closed", () => {
    let time = 100; const core = new SessionCore(() => time); const session = core.create(LOCAL);
    const { ticket } = core.issueTicket(session.sessionToken, LOCAL, "server-a", ORIGIN); core.revoke(session.sessionToken, LOCAL);
    expect(() => core.validateCsrf(session.sessionToken, LOCAL, session.csrfToken)).toThrowError(expect.objectContaining(invalid));
    expect(() => core.consumeTicket(session.sessionToken, LOCAL, ticket, "server-a", ORIGIN)).toThrowError(expect.objectContaining(invalid));
    const reset = core.create(LOCAL); core.clear();
    expect(() => core.read(reset.sessionToken, LOCAL)).toThrowError(expect.objectContaining(invalid));
    expect(() => new SessionCore(() => time).read(reset.sessionToken, LOCAL)).toThrowError(expect.objectContaining(invalid));
    const backwards = core.create(LOCAL); time--;
    expect(() => core.read(backwards.sessionToken, LOCAL)).toThrowError(expect.objectContaining(invalid));
    time = 100; expect(() => core.read(backwards.sessionToken, LOCAL)).toThrowError(expect.objectContaining(invalid));
    time = NaN; expect(() => core.create(LOCAL)).toThrowError(expect.objectContaining(invalid));
  });
  it("bounds socket reservations to four/session and32 total, holds revoked resources until actual close", () => {
    const core = new SessionCore(() => 0); const sessions = Array.from({ length: 8 }, () => core.create(LOCAL));
    for (const [n, session] of sessions.entries()) for (let s = 0; s < 4; s++) core.reserveSocket(session.sessionToken, LOCAL, `socket-${n}-${s}`);
    expect(() => core.reserveSocket(sessions[0]!.sessionToken, LOCAL, "extra")).toThrowError(expect.objectContaining({ code: "AUTH_CAPACITY" }));
    core.releaseSocket("socket-0-0"); core.reserveSocket(sessions[0]!.sessionToken, LOCAL, "replacement");
    core.revoke(sessions[0]!.sessionToken, LOCAL); const newSession = core.create(LOCAL);
    expect(() => core.reserveSocket(newSession.sessionToken, LOCAL, "socket-0-0")).toThrowError(expect.objectContaining({ code: "AUTH_CAPACITY" }));
    core.releaseSocket("replacement");
    core.reserveSocket(newSession.sessionToken, LOCAL, "socket-0-0");
  });
  it("valid inspection preserves a ticket, rejected inspection burns it and revocation notifies once", () => {
    let time = 0; const core = new SessionCore(() => time); const session = core.create(LOCAL);
    const notifications: string[] = []; core.observeSocketRevocation((id) => notifications.push(id));
    const issued = core.issueTicket(session.sessionToken, LOCAL, "server-a", ORIGIN);
    core.inspectTicket(session.sessionToken, LOCAL, issued.ticket, "server-a", ORIGIN);
    core.consumeTicket(session.sessionToken, LOCAL, issued.ticket, "server-a", ORIGIN);
    const rejected = core.issueTicket(session.sessionToken, LOCAL, "server-a", ORIGIN);
    expect(() => core.inspectTicket(session.sessionToken, LOCAL, rejected.ticket, "server-b", ORIGIN)).toThrow();
    expect(() => core.consumeTicket(session.sessionToken, LOCAL, rejected.ticket, "server-a", ORIGIN)).toThrow();
    core.reserveSocket(session.sessionToken, LOCAL, "socket");
    expect(core.socketRemaining("socket")).toBe(30 * 60_000);
    time = 30 * 60_000;
    expect(() => core.socketRemaining("socket")).toThrow();
    core.clear(); expect(notifications).toEqual(["socket"]);
    expect(() => core.reserveSocket(core.create(LOCAL).sessionToken, LOCAL, "socket")).toThrow();
    core.releaseSocket("socket"); core.reserveSocket(core.create(LOCAL).sessionToken, LOCAL, "socket");
  });
  it("rejects malformed or noncanonical tokens/origins/serverIds and reports nearest expiry", () => {
    const core = new SessionCore(() => 0); expect(core.nextDeadline()).toBeUndefined(); const session = core.create(LOCAL);
    expect(core.nextDeadline()).toBe(30 * 60_000);
    for (const bad of ["", "x".repeat(44), "a".repeat(43), undefined]) expect(() => core.read(bad, LOCAL)).toThrowError(expect.objectContaining(invalid));
    for (const origin of ["null", "https://example.test/", "https://example.test/path", "file:///tmp", "https://user@example.test", "https://EXAMPLE.test"]) {
      expect(() => core.issueTicket(session.sessionToken, LOCAL, "server-a", origin)).toThrowError(expect.objectContaining(invalid));
    }
    expect(() => core.issueTicket(session.sessionToken, LOCAL, "../bad", ORIGIN)).toThrowError(expect.objectContaining(invalid));
  });
});
