import { createHash } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { worldGenerationTargetSchema } from "@mcsm/contracts";
import type { StoredOperation } from "./operation-store.js";
import { DomainError } from "./domain-errors.js";

const uuid = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" });
const sha = Type.String({ pattern: "^[0-9a-f]{64}$" });
export const worldGenerationExecutionSchema = Type.Object({ schemaVersion: Type.Literal(1),
  serverId: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,62}$" }), executionOperationId: uuid,
  preparationOperationId: uuid, preparationTransactionId: uuid,
  worldId: Type.String({ pattern: "^worldv2-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }),
  preparedRecordDigest: sha, registeredExecutionDigest: sha, requestDigest: sha, keyDigest: sha
}, { additionalProperties: false });
export type WorldGenerationExecution = Static<typeof worldGenerationExecutionSchema>;
const targetSchema = worldGenerationTargetSchema;
export type GenerationExecutionTarget = Static<typeof targetSchema>;
export function readGenerationExecutionTarget(value: unknown): GenerationExecutionTarget {
  if (!Value.Check(targetSchema, value)) throw new DomainError(409, "RECOVERY_REQUIRED", "Generation target requires inspection", "generation-target-unverified", true);
  return structuredClone(value);
}
export const generationKeyDigest = (key: string) => createHash("sha256").update(key.toLowerCase()).digest("hex");

/** Canonical semantic request, never arbitrary paths or commands. */
export function generationExecutionRequest(value: Pick<WorldGenerationExecution, "preparationOperationId" | "preparationTransactionId" | "worldId" | "preparedRecordDigest" | "registeredExecutionDigest">) {
  return { action: "generate-world", preparationOperationId: value.preparationOperationId, preparationTransactionId: value.preparationTransactionId,
    worldId: value.worldId, preparedRecordDigest: value.preparedRecordDigest, registeredExecutionDigest: value.registeredExecutionDigest };
}
export function generationExecutionFingerprint(value: Omit<WorldGenerationExecution, "requestDigest" | "keyDigest">) {
  return createHash("sha256").update(`${value.serverId}\nworld-create\n${JSON.stringify(generationExecutionRequest(value))}`).digest("hex");
}
export function readGenerationExecution(value: unknown): WorldGenerationExecution {
  if (!Value.Check(worldGenerationExecutionSchema, value) || value.executionOperationId === value.preparationOperationId ||
      value.requestDigest !== generationExecutionFingerprint(value)) {
    throw new DomainError(409, "RECOVERY_REQUIRED", "World generation execution requires inspection", "generation-execution-unverified", true);
  }
  return structuredClone(value);
}
export function validGenerationExecutionReceipt(record: StoredOperation): boolean {
  try {
    const value = readGenerationExecution(record.worldGenerationExecution);
    return record.operation.kind === "world-create" && record.operation.serverId === value.serverId && record.operation.id === value.executionOperationId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(record.idempotencyKey) &&
      record.requestFingerprint === value.requestDigest && generationKeyDigest(record.idempotencyKey) === value.keyDigest;
  } catch { return false; }
}
