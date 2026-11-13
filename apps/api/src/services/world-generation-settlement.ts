import { createHash } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { worldStopConfirmation, type readWorldLifecycleStopEvidence } from "./operation-store.js";
import { matchesWorldLifecycleStop, validWorldLifecycleStopSeal, type WorldLifecycleStopConfirmation } from "./world-lifecycle-receipt.js";

const sha = Type.String({ pattern: "^[0-9a-f]{64}$" });
const uuid = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" });
const object = Type.Object({ checksum: sha, objectIdentity: sha }, { additionalProperties: false });
const schema = Type.Object({
  schemaVersion: Type.Literal(1), phase: Type.Literal("first-managed-generation-settled"),
  serverId: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,62}$" }),
  worldId: Type.String({ pattern: "^worldv2-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }),
  rootIdentity: sha, worldDirectoryIdentity: sha, registeredExecutionDigest: sha,
  preparationOperationId: uuid, executionOperationId: uuid, startOperationId: uuid, stopOperationId: uuid,
  lifecycleDigest: sha, confirmationDigest: sha, journalDigest: sha,
  catalogId: uuid, catalog: object, genesis: object,
  revision: Type.Object({ treeChecksum: sha, propertiesChecksum: sha, propertiesIdentity: sha, levelIdentity: sha },
    { additionalProperties: false })
}, { additionalProperties: false });

/** Historical completion evidence only. A valid shape is not admission,
 * current-world proof, a terminal projection or permission to clear recovery. */
export type WorldGenerationSettlement = Static<typeof schema>;
export function validWorldGenerationSettlement(value: unknown): value is WorldGenerationSettlement {
  if (!Value.Check(schema, value)) return false;
  return new Set([value.preparationOperationId, value.executionOperationId,
    value.startOperationId, value.stopOperationId]).size === 4;
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Strict readback comparison, not an issuer. The caller must independently
 * verify catalog/genesis, journal, physical state and exact recovery scope
 * under the existing instance lease before publishing or consuming this data. */
export function matchesWorldGenerationSettlement(value: unknown,
  evidence: NonNullable<Awaited<ReturnType<typeof readWorldLifecycleStopEvidence>>>,
  confirmation: WorldLifecycleStopConfirmation): value is WorldGenerationSettlement {
  if (!validWorldGenerationSettlement(value) || confirmation.schemaVersion !== 2) return false;
  const stop = evidence.stop.worldLifecycle;
  if (stop?.action !== "stop" || !matchesWorldLifecycleStop(evidence.start, evidence.stop, evidence.launch) ||
      evidence.stop.operation.state !== "running" || evidence.stop.operation.step !== "running" ||
      evidence.stop.operation.result !== null || evidence.stop.operation.error !== null ||
      !validWorldLifecycleStopSeal(evidence.revision) || evidence.revision.stopOperationId !== value.stopOperationId ||
      evidence.revision.stopIntentDigest !== digest(evidence.stop)) return false;
  const expected = worldStopConfirmation(evidence, confirmation.journalDigest);
  return digest(expected) === digest(confirmation) && value.serverId === stop.serverId && value.worldId === stop.worldId &&
    value.rootIdentity === stop.rootIdentity && value.worldDirectoryIdentity === stop.worldDirectoryIdentity &&
    value.registeredExecutionDigest === stop.registeredExecutionDigest &&
    value.startOperationId === evidence.start.operation.id && value.stopOperationId === evidence.stop.operation.id &&
    value.lifecycleDigest === digest(evidence) && value.confirmationDigest === digest(confirmation) &&
    value.journalDigest === confirmation.journalDigest && value.catalog.checksum === stop.catalogRevision &&
    (["treeChecksum", "propertiesChecksum", "propertiesIdentity", "levelIdentity"] as const)
      .every(field => value.revision[field] === evidence.revision[field]);
}
