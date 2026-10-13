import { Value } from "@sinclair/typebox/value";
import { expect, it } from "vitest";
import { tailscaleStatusResponseSchema, tailscalePreflightRequestSchema, tailscaleControlResponseSchema } from "../src/index.js";
const response = { data: { state: "disabled", desiredEnabled: false, observedEnabled: null, observedServeMode: "unknown", managementMode: "external",
  dependency: "unknown", tailnet: "unknown", https: "unknown", target: "unconfigured", lastCheckedAt: null, lastErrorCode: null,
  connectionUrl: null, remoteVerifiedAt: null, capabilities: { preflight: true, enable: false, disable: false } },
  meta: { requestId: "test", mode: "mock", generatedAt: "2026-10-13T00:00:00Z" } };
it("only accepts strict empty preflight with no paths, commands or ports", () => {
  expect(Value.Check(tailscalePreflightRequestSchema, {})).toBe(true);
  for (const value of [null, [], { path: "private" }, { command: "serve reset" }, { targetPort: 25575 }]) expect(Value.Check(tailscalePreflightRequestSchema, value)).toBe(false);
});
it("control response exposes no route target, private proof or remote verification", () => {
  const control = { data: { state: "unavailable", revision: null, observedEnabled: null, recoveryOperationId: null,
    enableAllowed: false, disableAllowed: false, connectionUrl: null, remoteVerifiedAt: null,
    lastErrorCode: "TAILSCALE_ATOMIC_CONTROL_UNAVAILABLE" }, meta: response.meta };
  expect(Value.Check(tailscaleControlResponseSchema, control)).toBe(true);
  for (const changed of [{ targetPort: 25575 }, { owningProof: {} }, { hostname: "private.ts.net" },
    { connectionUrl: "https://invented.ts.net" }, { remoteVerifiedAt: "2026-10-13T00:00:00Z" }, { revision: "private/path" }]) {
    expect(Value.Check(tailscaleControlResponseSchema, { ...control, data: { ...control.data, ...changed } })).toBe(false);
  }
});
it("forbids invented URL, verification, enabling and diagnostic secrets", () => {
  expect(Value.Check(tailscaleStatusResponseSchema, response)).toBe(true);
  for (const changed of [{ connectionUrl: "https://invented.ts.net" }, { remoteVerifiedAt: "2026-10-13T00:00:00Z" }, { desiredEnabled: true },
    { absolutePath: "private" }, { lastErrorCode: "secret path" }, { capabilities: { preflight: true, enable: true, disable: false } }]) {
    expect(Value.Check(tailscaleStatusResponseSchema, { ...response, data: { ...response.data, ...changed } })).toBe(false);
  }
});
