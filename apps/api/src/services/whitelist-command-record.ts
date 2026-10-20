import { createHash } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { DomainError } from "./domain-errors.js";

const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const uuid = Type.String({ pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$" });
const stamp = Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$" });
const object = <T extends Record<string, Parameters<typeof Type.Object>[0][string]>>(fields: T) => Type.Object(fields, { additionalProperties: false });
const state = Type.Union([Type.Literal("intent-persisted"), Type.Literal("dispatch-intent"),
  Type.Literal("response-recorded"), Type.Literal("recovery-required")]);
const request = object({ action: Type.Union([Type.Literal("add"), Type.Literal("remove")]),
  name: Type.String({ pattern: "^[A-Za-z0-9_]{3,16}$" }), revision: hash, confirm: Type.Literal(true) });
const rconEvidence = object({ rulesId: Type.Literal("vanilla-26.3-rcon-v1"),
  response: Type.String({ minLength: 1, maxLength: 512 }), runtimeNamesHash: hash,
  afterGuardId: uuid, afterGuardReceiptHash: hash });
export type WhitelistRconEvidence = Static<typeof rconEvidence>;
export const whitelistCommandRecordSchema = object({
  schemaVersion: Type.Literal(1), sequence: Type.Integer({ minimum: 0, maximum: 31 }), previousHash: Type.Union([hash, Type.Null()]),
  managerRootIdentity: hash, directoryIdentity: hash, operationId: uuid,
  serverId: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,62}$" }), idempotencyHash: hash, requestHash: hash,
  request, serverRootIdentity: hash, runtimeId: uuid, guardReceiptHash: hash,
  state, responseHash: Type.Union([hash, Type.Null()]), createdAt: stamp, updatedAt: stamp,
  rconEvidence: Type.Optional(rconEvidence)
});
export type WhitelistCommandRecord = Static<typeof whitelistCommandRecordSchema>;
const namespaceSchema = object({ schemaVersion: Type.Literal(1), managerRootIdentity: hash, directoryIdentity: hash });
export type WhitelistCommandNamespace = Static<typeof namespaceSchema>;
const anchorSchema = object({ schemaVersion: Type.Literal(1), managerRootIdentity: hash, directoryIdentity: hash,
  operationId: uuid, genesisHash: hash });
export type WhitelistCommandAnchor = Static<typeof anchorSchema>;
const witnessSchema = object({ schemaVersion: Type.Literal(1), managerRootIdentity: hash, directoryIdentity: hash,
  operationId: uuid, sequence: Type.Integer({ minimum: 1, maximum: 31 }), checkpointHash: hash });
export type WhitelistCommandWitness = Static<typeof witnessSchema>;
export const whitelistCommandUnsafe = () => new DomainError(503, "WHITELIST_COMMAND_STORAGE_UNSAFE", "白名单操作凭证不可安全读取");
export const whitelistCommandHash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
export const whitelistRconEvidenceHash = (binding: Pick<WhitelistCommandRecord, "operationId" | "serverId" | "requestHash" | "runtimeId" | "guardReceiptHash">,
  evidence: WhitelistRconEvidence) => whitelistCommandHash(JSON.stringify(["whitelist-rcon-evidence-v1", binding.operationId,
    binding.serverId, binding.requestHash, binding.runtimeId, binding.guardReceiptHash, evidence]));
export const whitelistCommandRequestHash = (serverId: string, body: WhitelistCommandRecord["request"]) =>
  whitelistCommandHash(JSON.stringify(["whitelist-command-v1", serverId, body.action, body.name, body.revision, body.confirm]));
function encode(schema: Parameters<typeof Value.Check>[0], value: unknown): Buffer {
  if (!Value.Check(schema, value)) throw whitelistCommandUnsafe();
  const bytes = Buffer.from(JSON.stringify(value));
  if (!bytes.length || bytes.length > 4096) throw whitelistCommandUnsafe();
  return bytes;
}
function decode<T>(schema: Parameters<typeof Value.Check>[0], bytes: Buffer): T {
  try {
    if (!bytes.length || bytes.length > 4096) throw whitelistCommandUnsafe();
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!encode(schema, value).equals(bytes)) throw whitelistCommandUnsafe();
    return value as T;
  } catch { throw whitelistCommandUnsafe(); }
}
export const encodeWhitelistCommand = (record: WhitelistCommandRecord) => encode(whitelistCommandRecordSchema, record);
export const decodeWhitelistCommand = (bytes: Buffer) => decode<WhitelistCommandRecord>(whitelistCommandRecordSchema, bytes);
export const encodeWhitelistNamespace = (value: WhitelistCommandNamespace) => encode(namespaceSchema, value);
export const decodeWhitelistNamespace = (bytes: Buffer) => decode<WhitelistCommandNamespace>(namespaceSchema, bytes);
export const encodeWhitelistAnchor = (value: WhitelistCommandAnchor) => encode(anchorSchema, value);
export const decodeWhitelistAnchor = (bytes: Buffer) => decode<WhitelistCommandAnchor>(anchorSchema, bytes);
export const encodeWhitelistWitness = (value: WhitelistCommandWitness) => encode(witnessSchema, value);
export const decodeWhitelistWitness = (bytes: Buffer) => decode<WhitelistCommandWitness>(witnessSchema, bytes);

/** Storage states deliberately have no success/terminal/recovery-clear transition.
 * A hash of a guard or response is only a binding, not proof of its semantics. */
export function verifyWhitelistCommandChain(chain: readonly WhitelistCommandRecord[]): void {
  const first = chain[0];
  if (!first || chain.length > 32 || first.sequence !== 0 || first.previousHash !== null ||
    first.state !== "intent-persisted" || first.responseHash !== null || first.createdAt !== first.updatedAt) throw whitelistCommandUnsafe();
  const transitions: Record<WhitelistCommandRecord["state"], readonly WhitelistCommandRecord["state"][]> = {
    "intent-persisted": ["dispatch-intent", "recovery-required"], "dispatch-intent": ["response-recorded", "recovery-required"],
    "response-recorded": ["recovery-required"], "recovery-required": []
  };
  for (let i = 0; i < chain.length; i++) {
    const record = chain[i]!; encodeWhitelistCommand(record);
    if (record.sequence !== i || [record.createdAt, record.updatedAt].some((time) => !Number.isFinite(Date.parse(time)) || new Date(time).toISOString() !== time) ||
      record.requestHash !== whitelistCommandRequestHash(record.serverId, record.request) || record.updatedAt < record.createdAt) throw whitelistCommandUnsafe();
    const binding = (row: WhitelistCommandRecord) => JSON.stringify([row.managerRootIdentity, row.directoryIdentity, row.operationId,
      row.serverId, row.idempotencyHash, row.requestHash, row.request, row.serverRootIdentity, row.runtimeId, row.guardReceiptHash, row.createdAt]);
    if (binding(record) !== binding(first)) throw whitelistCommandUnsafe();
    if ((record.state === "intent-persisted" || record.state === "dispatch-intent") && record.responseHash !== null ||
      record.state === "response-recorded" && record.responseHash === null) throw whitelistCommandUnsafe();
    if (record.rconEvidence && (!["response-recorded", "recovery-required"].includes(record.state) ||
      record.responseHash !== whitelistRconEvidenceHash(record, record.rconEvidence))) throw whitelistCommandUnsafe();
    if (i > 0) {
      const prior = chain[i - 1]!;
      if (record.previousHash !== whitelistCommandHash(encodeWhitelistCommand(prior)) || !transitions[prior.state].includes(record.state) ||
        record.updatedAt < prior.updatedAt || (prior.responseHash !== null && record.responseHash !== prior.responseHash) ||
        (record.state !== "response-recorded" && record.responseHash !== prior.responseHash) ||
        (record.state !== "response-recorded" && JSON.stringify(record.rconEvidence) !== JSON.stringify(prior.rconEvidence))) throw whitelistCommandUnsafe();
    }
  }
}
