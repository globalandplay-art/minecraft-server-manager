import { Value } from "@sinclair/typebox/value";
import { expect, it } from "vitest";
import { accessOperationSchema, operationSchema, resourceOperationSchema, accessMutationRequestSchema, accessOperationResponseSchema } from "../src/index.js";

const access = { schemaVersion: 1, id: "5babd7fe-c96b-4938-917d-01def3ab4d80",
  resource: { kind: "manager-access", provider: "tailscale" }, action: "enable", state: "created",
  createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z", errorCode: null };
const server = { id: "old-operation", serverId: "test", kind: "start", state: "queued", step: "queued",
  progress: null, createdAt: access.createdAt, updatedAt: access.updatedAt, result: null, error: null };

it("bounds Access mutation and safe operation response without accepting paths, commands or ports", () => {
  const body = { revision: access.id, confirm: true };
  expect(Value.Check(accessMutationRequestSchema, body)).toBe(true);
  for (const invalid of [{ ...body, confirm: false }, { ...body, targetPort: 25575 }, { ...body, command: "serve" },
    { ...body, path: "private" }, { ...body, revision: "unknown" }]) expect(Value.Check(accessMutationRequestSchema, invalid)).toBe(false);
  const response = { data: access, meta: { mode: "mock", requestId: access.id, generatedAt: access.createdAt } };
  expect(Value.Check(accessOperationResponseSchema, response)).toBe(true);
  expect(Value.Check(accessOperationResponseSchema, { ...response, data: { ...access, idempotencyKey: "private" } })).toBe(false);
});

it("keeps legacy server operations valid and strictly separates opt-in Manager operations", () => {
  expect(Value.Check(operationSchema, server)).toBe(true);
  expect(Value.Check(resourceOperationSchema, { resource: { kind: "server" }, operation: server })).toBe(true);
  expect(Value.Check(resourceOperationSchema, { resource: { kind: "manager-access" }, operation: access })).toBe(true);
  expect(Value.Check(resourceOperationSchema, { resource: { kind: "server" }, operation: access })).toBe(false);
  expect(Value.Check(resourceOperationSchema, { resource: { kind: "manager-access" }, operation: server })).toBe(false);
  expect(Value.Check(operationSchema, access)).toBe(false);
});
it("rejects fake server binding, unknown provider/version/state and raw diagnostic fields", () => {
  for (const value of [{ ...access, serverId: "fake" }, { ...access, schemaVersion: 2 },
    { ...access, resource: { kind: "manager-access", provider: "unknown" } },
    { ...access, state: "unknown" }, { ...access, errorCode: "raw-secret-message" },
    { ...access, stderr: "synthetic-secret" }]) expect(Value.Check(accessOperationSchema, value)).toBe(false);
});
