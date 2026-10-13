import { accessOperationSchema, type AccessOperation } from "@mcsm/contracts";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { createHash } from "node:crypto";
import { DomainError } from "./domain-errors.js";

const digest = Type.String({ pattern: "^[0-9a-f]{64}$" });
const uuid = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" });
export const accessCheckpointSchema = Type.Object({
  schemaVersion: Type.Literal(1), sequence: Type.Integer({ minimum: 0, maximum: 63 }),
  rootIdentity: digest, directoryIdentity: digest, previousHash: Type.Union([digest, Type.Null()]),
  idempotencyHash: digest, requestHash: digest, configurationRevision: uuid,
  observedRevision: digest, ownershipRevision: digest, previousEnabled: Type.Boolean(), operation: accessOperationSchema
}, { additionalProperties: false });
export type AccessCheckpoint = Static<typeof accessCheckpointSchema>;
const receiptSchema = Type.Object({ schemaVersion: Type.Literal(1), rootIdentity: digest,
  directoryIdentity: digest, operationId: uuid, genesisHash: digest }, { additionalProperties: false });
export type AccessAdmissionReceipt = Static<typeof receiptSchema>;
const namespaceSchema = Type.Object({ schemaVersion: Type.Literal(1), rootIdentity: digest,
  directoryIdentity: digest }, { additionalProperties: false });
export type AccessNamespaceReceipt = Static<typeof namespaceSchema>;
export const accessUnsafe = () => new DomainError(503, "ACCESS_PRIVATE_UNSAFE", "Access operation storage is unavailable.");
export const accessHash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
export const accessUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);

function encode<T>(schema: Parameters<typeof Value.Check>[0], value: T): Buffer {
  if (!Value.Check(schema, value)) throw accessUnsafe();
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > 4096) throw accessUnsafe();
  return bytes;
}
function decode<T>(schema: Parameters<typeof Value.Check>[0], bytes: Buffer): T {
  if (!bytes.length || bytes.length > 4096) throw accessUnsafe();
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { throw accessUnsafe(); }
  if (!Value.Check(schema, value) || !Buffer.from(JSON.stringify(value)).equals(bytes)) throw accessUnsafe();
  return value as T;
}
export const encodeAccessCheckpoint = (record: AccessCheckpoint) => encode(accessCheckpointSchema, record);
export const decodeAccessCheckpoint = (bytes: Buffer) => decode<AccessCheckpoint>(accessCheckpointSchema, bytes);
export const encodeAdmissionReceipt = (record: AccessAdmissionReceipt) => encode(receiptSchema, record);
export const decodeAdmissionReceipt = (bytes: Buffer) => decode<AccessAdmissionReceipt>(receiptSchema, bytes);
export const encodeNamespaceReceipt = (record: AccessNamespaceReceipt) => encode(namespaceSchema, record);
export const decodeNamespaceReceipt = (bytes: Buffer) => decode<AccessNamespaceReceipt>(namespaceSchema, bytes);

export const accessTerminal = (state: AccessOperation["state"]) => ["succeeded", "failed", "conflict"].includes(state);
export function verifyAccessChain(chain: readonly AccessCheckpoint[]): void {
  const first = chain[0];
  if (!first || first.sequence !== 0 || first.previousHash !== null || first.operation.state !== "intent_persisted" || first.operation.errorCode !== null) throw accessUnsafe();
  const transitions: Partial<Record<AccessOperation["state"], readonly AccessOperation["state"][]>> = {
    intent_persisted: ["applying", "recovery_required"], applying: ["verifying", "recovery_required"],
    verifying: ["succeeded", "recovery_required"], recovery_required: ["succeeded", "failed", "conflict"]
  };
  for (let i = 0; i < chain.length; i++) {
    const record = chain[i]!;
    if (record.sequence !== i || record.rootIdentity !== first.rootIdentity || record.directoryIdentity !== first.directoryIdentity ||
      record.idempotencyHash !== first.idempotencyHash || record.requestHash !== first.requestHash ||
      record.configurationRevision !== first.configurationRevision || record.observedRevision !== first.observedRevision ||
      record.ownershipRevision !== first.ownershipRevision || record.operation.id !== first.operation.id ||
      record.previousEnabled !== first.previousEnabled ||
      record.operation.resource.provider !== first.operation.resource.provider || record.operation.action !== first.operation.action ||
      record.operation.createdAt !== first.operation.createdAt) throw accessUnsafe();
    if (i > 0) {
      const before = chain[i - 1]!;
      if (record.previousHash !== accessHash(encodeAccessCheckpoint(before)) ||
        !transitions[before.operation.state]?.includes(record.operation.state) || record.operation.updatedAt < before.operation.updatedAt) throw accessUnsafe();
    }
    if (record.operation.state === "recovery_required" && record.operation.errorCode !== "ACCESS_RECOVERY_REQUIRED") throw accessUnsafe();
    if (["intent_persisted", "applying", "verifying", "succeeded"].includes(record.operation.state) && record.operation.errorCode !== null) throw accessUnsafe();
  }
}
