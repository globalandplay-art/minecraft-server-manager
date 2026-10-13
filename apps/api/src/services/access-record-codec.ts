import { accessDisabledRecordSchema, type AccessDisabledRecord } from "@mcsm/contracts";
import { Value } from "@sinclair/typebox/value";
import { Type, type Static } from "@sinclair/typebox";
import { DomainError } from "./domain-errors.js";

const unsafe = () => new DomainError(503, "ACCESS_PRIVATE_UNSAFE", "Access record validation failed.");

function canonical(record: AccessDisabledRecord): string {
  return JSON.stringify({ schemaVersion: record.schemaVersion, provider: record.provider,
    rootIdentity: record.rootIdentity, revision: record.revision, desiredEnabled: record.desiredEnabled,
    managementMode: record.managementMode, ownedRoute: record.ownedRoute,
    operationId: record.operationId, ownershipRevision: record.ownershipRevision });
}

/** Pure codec. Callers must separately verify private ACL, identities, locks and publication. */
export function encodeAccessDisabledRecord(record: AccessDisabledRecord): Buffer {
  if (!Value.Check(accessDisabledRecordSchema, record)) throw unsafe();
  return Buffer.from(canonical(record), "utf8");
}

export function decodeAccessDisabledRecord(bytes: Buffer, provider: AccessDisabledRecord["provider"],
  rootIdentity: string): AccessDisabledRecord {
  if (bytes.length === 0 || bytes.length > 4096) throw unsafe();
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { throw unsafe(); }
  if (!Value.Check(accessDisabledRecordSchema, value) || value.provider !== provider ||
    value.rootIdentity !== rootIdentity || !Buffer.from(canonical(value), "utf8").equals(bytes)) throw unsafe();
  return value;
}

/** Backend-only immutable expectation receipt, published before the configuration. */
const receiptSchema = Type.Object({ schemaVersion: Type.Literal(1),
  provider: Type.Union([Type.Literal("tailscale"), Type.Literal("cloudflare")]),
  rootIdentity: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  directoryIdentity: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  revision: Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }),
  checksum: Type.String({ pattern: "^[0-9a-f]{64}$" })
}, { additionalProperties: false });
export type AccessExpectation = Static<typeof receiptSchema>;
function canonicalReceipt(record: AccessExpectation): string {
  return JSON.stringify({ schemaVersion: record.schemaVersion, provider: record.provider,
    rootIdentity: record.rootIdentity, directoryIdentity: record.directoryIdentity,
    revision: record.revision, checksum: record.checksum });
}
export function encodeAccessExpectation(record: AccessExpectation): Buffer {
  if (!Value.Check(receiptSchema, record)) throw unsafe();
  return Buffer.from(canonicalReceipt(record), "utf8");
}
export function decodeAccessExpectation(bytes: Buffer, provider: AccessExpectation["provider"], rootIdentity: string): AccessExpectation {
  if (bytes.length === 0 || bytes.length > 4096) throw unsafe();
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { throw unsafe(); }
  if (!Value.Check(receiptSchema, value) || value.provider !== provider || value.rootIdentity !== rootIdentity ||
    !Buffer.from(canonicalReceipt(value), "utf8").equals(bytes)) throw unsafe();
  return value;
}
