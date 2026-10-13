import { describe, expect, it } from "vitest";
import { decodeAccessDisabledRecord, encodeAccessDisabledRecord } from "../src/services/access-record-codec.js";

const record = { schemaVersion: 1 as const, provider: "tailscale" as const, rootIdentity: "a".repeat(64),
  revision: "5babd7fe-c96b-4938-917d-01def3ab4d80", desiredEnabled: false as const,
  managementMode: "external" as const, ownedRoute: null, operationId: null, ownershipRevision: null };

describe("private disabled Access record codec", () => {
  it("round-trips a bounded record without observing or enabling a provider", () => {
    const bytes = encodeAccessDisabledRecord(record);
    expect(bytes.length).toBeLessThan(4096);
    expect(decodeAccessDisabledRecord(bytes, "tailscale", record.rootIdentity)).toEqual(record);
    const cloudflare = { ...record, provider: "cloudflare" as const };
    expect(decodeAccessDisabledRecord(encodeAccessDisabledRecord(cloudflare), "cloudflare", record.rootIdentity)).toEqual(cloudflare);
  });
  it("rejects wrong provider/root and unsafe or ambiguous bytes with fixed safe errors", () => {
    const valid = encodeAccessDisabledRecord(record);
    for (const bytes of [Buffer.alloc(0), Buffer.alloc(4097), Buffer.from("{"),
      Buffer.from(valid.toString().replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')),
      Buffer.from(" " + valid.toString()),
      Buffer.from(JSON.stringify({ ...record, schemaVersion: 2 })),
      Buffer.from(JSON.stringify({ ...record, desiredEnabled: true })),
      Buffer.from(JSON.stringify({ ...record, secret: "synthetic-sensitive-marker" }))]) {
      expect(() => decodeAccessDisabledRecord(bytes, "tailscale", record.rootIdentity)).toThrow("Access record validation failed.");
    }
    expect(() => decodeAccessDisabledRecord(valid, "cloudflare", record.rootIdentity)).toThrow("Access record validation failed.");
    expect(() => decodeAccessDisabledRecord(valid, "tailscale", "b".repeat(64))).toThrow("Access record validation failed.");
    expect(() => encodeAccessDisabledRecord({ ...record, rootIdentity: "invalid" })).toThrow("Access record validation failed.");
  });
});
