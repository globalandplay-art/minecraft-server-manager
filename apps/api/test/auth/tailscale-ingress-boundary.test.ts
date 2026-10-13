import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { IngressBoundaryError, TailscaleIngressBoundary } from "../../src/auth/tailscale-ingress-boundary.js";

const host = "manager.example-tail.ts.net";
function request(headers: Record<string, string> = {}, method = "GET", peer = "127.0.0.1"): IncomingMessage {
  const values = { host, ...headers };
  return { method, headers: values, rawHeaders: Object.entries(values).flat(), socket: { remoteAddress: peer } } as unknown as IncomingMessage;
}
function boundary() { const value = new TailscaleIngressBoundary(host); value.open(); return value; }
function denied(value: TailscaleIngressBoundary, input: IncomingMessage, code: string) {
  try { value.assertRequest(input); throw new Error("unexpected admission"); }
  catch (error) { expect(error).toBeInstanceOf(IngressBoundaryError); expect((error as IngressBoundaryError).code).toBe(code); expect((error as Error).message).toBe(code); }
}
describe("unwired Tailscale ingress shape boundary (never grants authentication)", () => {
  it("defaults closed, closes synchronously and new controller remains closed", () => {
    const value = new TailscaleIngressBoundary(host);
    denied(value, request(), "INGRESS_CLOSED"); value.open(); value.assertRequest(request());
    value.close(); denied(value, request(), "INGRESS_CLOSED"); expect(value.admitting).toBe(false);
    expect(new TailscaleIngressBoundary(host).admitting).toBe(false);
  });
  it.each(["https://" + host, "*.example-tail.ts.net", host + ":443", host + ".", "localhost", "127.0.0.1", "Manager.example-tail.ts.net", "manager.example.net", "manager..ts.net", "-manager.tail.ts.net"])("rejects configured authority %s", (authority) => {
    expect(() => new TailscaleIngressBoundary(authority)).toThrow("INGRESS_AUTHORITY_INVALID");
  });
  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])("accepts exact owned-listener loopback shape %s only as pre-auth validation", (peer) => {
    expect(boundary().assertRequest(request({}, "GET", peer))).toBeUndefined();
  });
  it.each(["100.64.0.1", "192.168.1.1", "127.0.0.2", "", "::ffff:192.168.1.1"])("rejects non-approved peer %s", (peer) => {
    denied(boundary(), request({}, "GET", peer), "INGRESS_PEER_REJECTED");
  });
  it.each([host + ":443", host + ",other.ts.net", "127.0.0.1:8080", "attacker.ts.net"])("rejects request authority %s", (authority) => {
    denied(boundary(), request({ host: authority }), "INGRESS_HOST_REJECTED");
  });
  it.each(["POST", "PUT", "PATCH", "DELETE", "UNKNOWN"])("requires exact HTTPS origin for %s", (method) => {
    denied(boundary(), request({}, method), "INGRESS_ORIGIN_REJECTED");
    denied(boundary(), request({ origin: "http://" + host }, method), "INGRESS_ORIGIN_REJECTED");
    boundary().assertRequest(request({ origin: "https://" + host }, method));
  });
  it("requires origin for upgrades and rejects wrong origin even on reads", () => {
    denied(boundary(), request({ upgrade: "websocket" }), "INGRESS_ORIGIN_REJECTED");
    denied(boundary(), request({ origin: "https://attacker.invalid" }), "INGRESS_ORIGIN_REJECTED");
  });
  it.each(["Host", "Origin", "Cookie", "Authorization", "X-CSRF-Token", "X-Manager-Intent", "Sec-WebSocket-Protocol", "X-Forwarded-Host", "Tailscale-User-Login"])("rejects duplicate wire %s despite normalized fields", (name) => {
    const input = request({ [name.toLowerCase()]: name.toLowerCase() === "host" ? host : "fixed" });
    input.rawHeaders.push(name, "second"); denied(boundary(), input, "INGRESS_HEADERS_REJECTED");
  });
  it.each([ { forwarded: "for=127.0.0.1" }, { "x-forwarded-host": "other.ts.net" }, { "x-forwarded-proto": "http" },
    { "x-forwarded-for": "100.64.0.1, 127.0.0.1" }, { "x-forwarded-port": "443" }, { "tailscale-funnel-request": "?1" } ])("rejects ambiguous forwarding/private-mode conflict %j", (headers) => {
    denied(boundary(), request(headers), "INGRESS_HEADERS_REJECTED");
  });
  it("accepts pinned Serve forwarding shape without deriving a principal or selecting profile", () => {
    const input = request({ origin: "https://" + host, "x-forwarded-host": host, "x-forwarded-proto": "https", "x-forwarded-for": "100.64.0.2",
      "tailscale-user-login": "pretend-admin", "tailscale-app-capabilities": "pretend-permission" });
    expect(boundary().assertRequest(input)).toBeUndefined();
    expect(Object.keys(boundary()).sort()).toEqual(["authority", "origin"]);
    denied(new TailscaleIngressBoundary(host), input, "INGRESS_CLOSED");
  });
  it("does not rewrite credentials, origin or forwarding into a local request", () => {
    const input = request({ origin: "https://" + host, cookie: "sentinel", "x-forwarded-proto": "https" }, "POST");
    const before = JSON.stringify({ headers: input.headers, rawHeaders: input.rawHeaders }); boundary().assertRequest(input);
    expect(JSON.stringify({ headers: input.headers, rawHeaders: input.rawHeaders })).toBe(before);
  });
});
