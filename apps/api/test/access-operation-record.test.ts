import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { accessHash, decodeAccessCheckpoint, encodeAccessCheckpoint, verifyAccessChain, type AccessCheckpoint } from "../src/services/access-operation-record.js";

const first = (): AccessCheckpoint => ({ schemaVersion: 1, sequence: 0, previousHash: null,
  rootIdentity: "a".repeat(64), directoryIdentity: "b".repeat(64), idempotencyHash: "c".repeat(64), requestHash: "d".repeat(64),
  configurationRevision: randomUUID(), observedRevision: "e".repeat(64), ownershipRevision: "f".repeat(64), previousEnabled: false,
  operation: { schemaVersion: 1, id: randomUUID(), resource: { kind: "manager-access", provider: "tailscale" }, action: "enable",
    state: "intent_persisted", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), errorCode: null } });
it("rejects ambiguous bytes, unknown versions, oversized records and extra private fields", () => {
  const record = first(); const bytes = encodeAccessCheckpoint(record);
  expect(decodeAccessCheckpoint(bytes)).toEqual(record);
  for (const input of [Buffer.concat([bytes, Buffer.from(" ")]), Buffer.from("x".repeat(4097)),
    Buffer.from(JSON.stringify({ ...record, schemaVersion: 2 })), Buffer.from(JSON.stringify({ ...record, path: "private" })),
    Buffer.from(bytes.toString().replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'))]) {
    expect(() => decodeAccessCheckpoint(input)).toThrow("Access operation storage is unavailable.");
  }
});
it.each(["provider", "root", "request", "sequence", "link", "transition", "error"])("rejects checkpoint %s drift even with syntactically valid JSON", (fault) => {
  const before = first(); const after: AccessCheckpoint = { ...before, sequence: 1, previousHash: accessHash(encodeAccessCheckpoint(before)),
    operation: { ...before.operation, resource: { ...before.operation.resource }, state: "applying" } };
  if (fault === "provider") after.operation.resource.provider = "cloudflare";
  if (fault === "root") after.rootIdentity = "0".repeat(64);
  if (fault === "request") after.requestHash = "0".repeat(64);
  if (fault === "sequence") after.sequence = 2;
  if (fault === "link") after.previousHash = "0".repeat(64);
  if (fault === "transition") after.operation.state = "succeeded";
  if (fault === "error") after.operation.errorCode = "ACCESS_CONFLICT";
  expect(() => verifyAccessChain([before, after])).toThrow("Access operation storage is unavailable.");
});
