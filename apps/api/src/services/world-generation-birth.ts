import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { DomainError } from "./domain-errors.js";
import { readGenerationExecution, worldGenerationExecutionSchema } from "./world-generation-execution.js";

const sha = Type.String({ pattern: "^[0-9a-f]{64}$" });
export const generationBirthSchema = Type.Object({
  schemaVersion: Type.Literal(1), evidence: Type.Literal("owned-vanilla-26.3-normal-exit"),
  execution: worldGenerationExecutionSchema,
  launchId: Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }),
  candidate: Type.Object({ directoryIdentity: sha, objectIdentity: sha, levelIdentity: sha, checksumSha256: sha,
    version: Type.Literal("26.3"), dataVersion: Type.Literal(5023) }, { additionalProperties: false }),
  properties: Type.Object({ checksum: sha, identity: sha,
    timestampDigest: Type.Union([sha, Type.Null()]) }, { additionalProperties: false })
}, { additionalProperties: false });
export type GenerationBirth = Static<typeof generationBirthSchema>;
/** Strict metadata only. The writer still requires live owned/physical proof. */
export function readGenerationBirth(value: unknown): GenerationBirth {
  if (!Value.Check(generationBirthSchema, value)) throw new DomainError(409, "RECOVERY_REQUIRED", "World birth requires inspection", "generation-birth-unverified", true);
  readGenerationExecution(value.execution);
  return structuredClone(value);
}
