import { createHash } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { StoredOperation } from "./operation-store.js";

const uuid = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" });
const sha = Type.String({ pattern: "^[0-9a-f]{64}$" });
const binding = { schemaVersion: Type.Literal(1), serverId: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,62}$" }),
  worldId: Type.String({ pattern: "^worldv2-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }),
  catalogRevision: sha, worldRevision: sha, rootIdentity: sha, worldDirectoryIdentity: sha, registeredExecutionDigest: sha,
  runNonce: uuid, startOperationId: uuid, requestDigest: sha, keyDigest: sha };
export const worldLifecycleReceiptSchema = Type.Union([
  Type.Object({ ...binding, action: Type.Literal("start"), launchId: Type.Union([uuid, Type.Null()]) }, { additionalProperties: false }),
  Type.Object({ ...binding, action: Type.Literal("stop"), launchId: uuid, startReceiptDigest: sha }, { additionalProperties: false })
]);
export type WorldLifecycleReceipt = Static<typeof worldLifecycleReceiptSchema>;
const launchSealSchema = Type.Object({
  schemaVersion: Type.Literal(1), startOperationId: uuid, launchId: uuid, intentDigest: sha
}, { additionalProperties: false });
export type WorldLifecycleLaunchSeal = Static<typeof launchSealSchema>;
export function validWorldLifecycleLaunchSeal(value: unknown): value is WorldLifecycleLaunchSeal {
  return Value.Check(launchSealSchema, value);
}
const stopSealSchema = Type.Object({
  schemaVersion: Type.Literal(1), stopOperationId: uuid, stopIntentDigest: sha,
  treeChecksum: sha, propertiesChecksum: sha, propertiesIdentity: sha, levelIdentity: sha
}, { additionalProperties: false });
export type WorldLifecycleStopSeal = Static<typeof stopSealSchema>;
export function validWorldLifecycleStopSeal(value: unknown): value is WorldLifecycleStopSeal {
  return Value.Check(stopSealSchema, value);
}
const stopConfirmationFields = { stopOperationId: uuid, evidenceDigest: sha };
const stopConfirmationSchema = Type.Union([
  Type.Object({ schemaVersion: Type.Literal(1), ...stopConfirmationFields }, { additionalProperties: false }),
  Type.Object({ schemaVersion: Type.Literal(2), ...stopConfirmationFields, journalDigest: sha }, { additionalProperties: false })
]);
export type WorldLifecycleStopConfirmation = Static<typeof stopConfirmationSchema>;
export function validWorldLifecycleStopConfirmation(value: unknown): value is WorldLifecycleStopConfirmation {
  return Value.Check(stopConfirmationSchema, value);
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Private semantic target only. Server-created nonce/start ID/launch observation
 * are deliberately excluded from a start request's idempotency fingerprint.
 * This validator does not prove that a launch occurred or its files are safe. */
export function worldLifecycleRequest(value: WorldLifecycleReceipt) {
  return { action: "world-lifecycle", kind: value.action, worldId: value.worldId, catalogRevision: value.catalogRevision,
    worldRevision: value.worldRevision, rootIdentity: value.rootIdentity, worldDirectoryIdentity: value.worldDirectoryIdentity,
    registeredExecutionDigest: value.registeredExecutionDigest,
    ...(value.action === "stop" ? { runNonce: value.runNonce, startOperationId: value.startOperationId,
      launchId: value.launchId, startReceiptDigest: value.startReceiptDigest } : {}) };
}
export function worldLifecycleFingerprint(value: WorldLifecycleReceipt): string {
  return hash(`${value.serverId}\n${value.action}\n${JSON.stringify(worldLifecycleRequest(value))}`);
}
export function validWorldLifecycleReceipt(record: StoredOperation): boolean {
  const value = record.worldLifecycle;
  if (!Value.Check(worldLifecycleReceiptSchema, value) || record.worldGenerationExecution !== undefined ||
      typeof record.idempotencyKey !== "string" || !Value.Check(uuid, record.idempotencyKey.toLowerCase()) || record.operation.serverId !== value.serverId || record.operation.kind !== value.action ||
      !Value.Check(uuid, record.operation.id) || (value.action === "start" ? record.operation.id !== value.startOperationId : record.operation.id === value.startOperationId)) return false;
  return value.requestDigest === worldLifecycleFingerprint(value) && record.requestFingerprint === value.requestDigest &&
    value.keyDigest === hash(record.idempotencyKey.toLowerCase());
}

export function matchesWorldLifecycleStop(parent: StoredOperation, record: StoredOperation, launch: WorldLifecycleLaunchSeal): boolean {
  const start = parent.worldLifecycle, stop = record.worldLifecycle;
  return validWorldLifecycleReceipt(parent) && validWorldLifecycleReceipt(record) &&
    start?.action === "start" && start.launchId === null && parent.operation.state === "running" &&
    parent.operation.step === "running" && parent.operation.result === null && parent.operation.error === null && stop?.action === "stop" &&
    parent.operation.id === stop.startOperationId && hash(JSON.stringify(parent)) === stop.startReceiptDigest &&
    (["serverId", "worldId", "catalogRevision", "worldRevision", "rootIdentity", "worldDirectoryIdentity", "registeredExecutionDigest", "runNonce"] as const)
      .every(field => start[field] === stop[field]) && validWorldLifecycleLaunchSeal(launch) &&
    launch.startOperationId === stop.startOperationId && launch.launchId === stop.launchId && launch.intentDigest === stop.startReceiptDigest;
}
