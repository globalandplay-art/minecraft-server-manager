import { randomUUID } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { DomainError } from "./domain-errors.js";
import { validNewWorldName } from "./world-create-plan-service.js";

const uuid = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" });
const worldId = Type.String({ pattern: "^worldv2-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" });
const hash = Type.String({ pattern: "^[0-9a-f]{64}$" });
export const worldGenerationReservationSchema = Type.Object({
  schemaVersion: Type.Literal(1), state: Type.Literal("reserved"),
  serverId: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,62}$" }),
  operationId: uuid, transactionId: uuid, worldId, previousWorldId: worldId,
  catalogId: uuid, catalogRevision: hash, rootIdentity: hash,
  previousName: Type.String({ minLength: 1, maxLength: 128 }),
  nextName: Type.String({ minLength: 1, maxLength: 64 }),
  propertiesBefore: hash, propertiesAfter: hash, activeStateRevision: hash,
  guardBackupId: uuid
}, { additionalProperties: false });
export type WorldGenerationReservation = Static<typeof worldGenerationReservationSchema>;
type Approval = Omit<WorldGenerationReservation, "schemaVersion" | "state" | "worldId">;
const invalid = () => new DomainError(409, "RECOVERY_REQUIRED", "World generation identity requires inspection", "world-generation-identity-unverified", true);

/** In-memory proposal only. The existing journal must persist and read back this
 * exact UUID before configuration writes; this helper grants no write/start authority. */
export function proposeWorldGenerationReservation(approval: Approval): WorldGenerationReservation {
  const proposal = { ...structuredClone(approval), schemaVersion: 1, state: "reserved", worldId: `worldv2-${randomUUID()}` };
  return readWorldGenerationReservation(proposal);
}

/** Never synthesize a physical directory identity for a world not yet born. */
export function readWorldGenerationReservation(value: unknown): WorldGenerationReservation {
  if (!Value.Check(worldGenerationReservationSchema, value) || !validNewWorldName(value.nextName) ||
      value.previousName === "." || value.previousName === ".." || /[\\/:<>"|?*\u0000-\u001f\u007f]/u.test(value.previousName) ||
      /[. ]$/u.test(value.previousName) || value.previousName.toLowerCase() === value.nextName.toLowerCase() ||
      value.previousWorldId === value.worldId || value.propertiesBefore === value.propertiesAfter) throw invalid();
  return structuredClone(value);
}

/** Closed classification, not recovery or success. Even complete level.dat
 * observation is only eligible for future bounded physical verification. */
export function classifyWorldGenerationObservation(value: unknown, observation: {
  serverId: string; worldId: string; transactionId: string;
  propertiesRevision: string; activeName: string; target: "absent" | "partial" | "level-data-present" | "unsafe";
}): "awaiting-explicit-start" | "birth-verification-required" | "inspection-required" {
  let reservation: WorldGenerationReservation;
  try { reservation = readWorldGenerationReservation(value); } catch { return "inspection-required"; }
  if (observation.serverId !== reservation.serverId || observation.worldId !== reservation.worldId ||
      observation.transactionId !== reservation.transactionId || observation.propertiesRevision !== reservation.propertiesAfter ||
      observation.activeName !== reservation.nextName) return "inspection-required";
  if (observation.target === "absent") return "awaiting-explicit-start";
  if (observation.target === "level-data-present") return "birth-verification-required";
  return "inspection-required";
}
