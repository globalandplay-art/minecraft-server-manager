import { Type, type Static } from "@sinclair/typebox";

// Leaf schemas: keep eager validation metadata outside the store/issuer import cycle.
const sha = Type.String({ pattern: "^[0-9a-f]{64}$" });
const uuid = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" });
const fileProof = Type.Object({ checksum: sha, identity: sha }, { additionalProperties: false });
export const generationGenesisReferenceSchema = Type.Object({ schemaVersion: Type.Literal(1),
  serverId: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,62}$" }), executionOperationId: uuid,
  worldId: Type.String({ pattern: "^worldv2-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }),
  recordDigest: sha, snapshot: fileProof, completion: fileProof
}, { additionalProperties: false });
export type GenerationGenesisReference = Static<typeof generationGenesisReferenceSchema>;
export const generationReferenceObjectsSchema = Type.Object({ snapshot: sha, completion: sha, intent: sha,
  birth: sha, execution: sha, anchor: sha }, { additionalProperties: false });
