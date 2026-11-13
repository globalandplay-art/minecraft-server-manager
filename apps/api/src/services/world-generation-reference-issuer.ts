import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { DomainError } from "./domain-errors.js";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { syncRestoreDirectory } from "./restore-files.js";
import { generationGenesisReferenceSchema, generationReferenceObjectsSchema } from "./world-generation-reference-schema.js";
import { generationReferenceObjectWitness,
  inspectGenerationGenesisReference } from "./world-generation-genesis-reference.js";
import { generationSlotProofDigest } from "./world-generation-slot.js";
import type { verifyGenerationCurrentState } from "./world-generation-current-state.js";

type Proof = Awaited<ReturnType<typeof verifyGenerationCurrentState>>;
type Binding = { serverId: string; rootPath: string; registeredExecutionDigest: string };
const sha = Type.String({ pattern: "^[0-9a-f]{64}$" });
const issuerProofSchema = Type.Object({ checksum: sha, objectIdentity: sha }, { additionalProperties: false });
const schema = Type.Object({ schemaVersion: Type.Literal(2), phase: Type.Literal("issued-generation-genesis-reference"),
  reference: generationGenesisReferenceSchema, catalogId: Type.String({ pattern: "^[0-9a-f-]{36}$" }),
  rootIdentity: sha, registeredExecutionDigest: sha, directoryIdentity: sha, libraryIdentity: sha,
  proofDigest: sha, receiptDigest: sha, objects: generationReferenceObjectsSchema
}, { additionalProperties: false });
type Issued = Static<typeof schema>;
const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Generation reference issuance requires inspection", "generation-reference-issuer-unverified", true);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const witness = (value: { dev: bigint; ino: bigint; birthtimeNs: bigint }) =>
  createHash("sha256").update(`${value.dev}\0${value.ino}\0${value.birthtimeNs}`).digest("hex");
const paths = (manager: string, server: string, execution: string) => {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/u.test(server) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(execution)) throw fail();
  const directory = path.join(path.resolve(manager), "active-worlds"), prefix = `${server}.${execution}`;
  return { directory, file: path.join(directory, prefix + ".generation-reference.json"),
    stage: path.join(directory, prefix + ".generation-slot.tmp"),
    snapshot: path.join(directory, prefix + ".generation-genesis.json"),
    completion: path.join(directory, prefix + ".generation-slot.completion.json") };
};
function guardOf(authorize: () => undefined) {
  return () => {
    if (typeof authorize !== "function") throw fail();
    const result: unknown = authorize();
    if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw fail(); }
  };
}
async function readAnchor(file: string) {
  const object = await generationReferenceObjectWitness(file), saved = await readPrivatePropertiesFile(file, 8192);
  try {
    if (await generationReferenceObjectWitness(file) !== object) throw fail();
    const text = saved.bytes.toString("utf8"), value: unknown = JSON.parse(text);
    if (!saved.bytes.equals(Buffer.from(text, "utf8")) || !Value.Check(schema, value) || text !== JSON.stringify(value) + "\n") throw fail();
    return { value, proof: { checksum: saved.checksum, objectIdentity: object } };
  } finally { saved.bytes.fill(0); }
}
function payload(inspection: Awaited<ReturnType<typeof inspectGenerationGenesisReference>>): Issued {
  return { schemaVersion: 2, phase: "issued-generation-genesis-reference", reference: inspection.reference,
    catalogId: inspection.seed.catalogId, rootIdentity: inspection.rootIdentity,
    registeredExecutionDigest: inspection.seed.registeredExecutionDigest, directoryIdentity: inspection.directoryIdentity,
    libraryIdentity: inspection.libraryIdentity, proofDigest: inspection.proofDigest, receiptDigest: inspection.receiptDigest,
    objects: inspection.objects };
}
async function finalBoundaries(managerRoot: string, location: ReturnType<typeof paths>, value: Issued, binding: Binding) {
  if (await backupDirectoryIdentity(location.directory) !== value.directoryIdentity ||
      await backupDirectoryIdentity(path.join(path.resolve(managerRoot), "world-library")) !== value.libraryIdentity ||
      await backupDirectoryIdentity(binding.rootPath) !== value.rootIdentity) throw fail();
  try { await lstat(location.stage); throw fail(); } catch (error) {
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
  }
}

/** An exact durable anchor proof is mandatory: detached schema-v2 data is NOT
 * issuer provenance. Still historical-only, never current content/readiness. */
export async function inspectIssuedGenerationReference(managerRoot: string, serverId: string, executionId: string,
  expected: Binding, inputProof: unknown, authorize: () => undefined) {
  try {
    if (!Value.Check(issuerProofSchema, inputProof)) throw fail();
    const proof = structuredClone(inputProof), binding = structuredClone(expected), guard = guardOf(authorize);
    guard(); const location = paths(managerRoot, serverId, executionId), before = await readAnchor(location.file); guard();
    if (!same(before.proof, proof) || before.value.reference.serverId !== serverId ||
        before.value.reference.executionOperationId !== executionId) throw fail();
    const inspection = await inspectGenerationGenesisReference(managerRoot, before.value.reference, binding, authorize); guard();
    if (!same(payload(inspection), before.value)) throw fail();
    const after = await readAnchor(location.file); guard();
    if (!same(after, before)) throw fail();
    await finalBoundaries(managerRoot, location, after.value, binding); guard();
    return { phase: "issued-historical-genesis-only" as const, inspectionOnly: true as const, recoveryRequired: true as const,
      issuer: proof, reference: after.value, seed: inspection.seed, installedSlot: structuredClone(inspection.installedSlot),
      birthEvidence: structuredClone(inspection.birthEvidence) };
  } catch { throw fail(); }
}

/** Dedicated instance writer lease/lifetime REQUIRED. A fresh full active proof
 * plus EXISTING snapshot/completion is mandatory. No CAS, missing-evidence repair,
 * catalog migration, operation settlement or recovery release occurs here.
 * Strong object provenance begins at this issuance, not before legacy records. */
export async function sealGenerationReference(managerRoot: string, initial: Proof, expected: Binding,
  observe: () => Promise<Proof>, authorize: () => undefined) {
  try {
    const binding = structuredClone(expected), guard = guardOf(authorize), initialDigest = generationSlotProofDigest(initial), initialSlot = structuredClone(initial.slot);
    guard(); if (typeof observe !== "function") throw fail(); const current = await observe(); guard();
    if (current.slot.state !== "active" || generationSlotProofDigest(current) !== initialDigest || !same(current.slot, initialSlot) ||
        current.serverId !== binding.serverId || current.registeredExecutionDigest !== binding.registeredExecutionDigest) throw fail();
    const location = paths(managerRoot, current.serverId, current.operationId);
    const readLink = async (file: string, limit: number) => {
      const object = await generationReferenceObjectWitness(file), value = await readPrivatePropertiesFile(file, limit);
      try { guard(); if (await generationReferenceObjectWitness(file) !== object) throw fail();
        return { proof: { checksum: value.checksum, identity: value.identity }, object }; }
      finally { value.bytes.fill(0); }
    };
    const snapshot = await readLink(location.snapshot, 1024 * 1024), completion = await readLink(location.completion, 4096);
    const reference = { schemaVersion: 1 as const, serverId: current.serverId, executionOperationId: current.operationId,
      worldId: current.worldId, recordDigest: current.recordDigest, snapshot: snapshot.proof, completion: completion.proof };
    if (reference.snapshot.checksum !== current.catalogRevision) throw fail();
    const before = await inspectGenerationGenesisReference(managerRoot, reference, binding, authorize); guard();
    if (before.objects.snapshot !== snapshot.object || before.objects.completion !== completion.object ||
        before.proofDigest !== initialDigest || before.receiptDigest !== current.receiptDigest ||
        before.installedSlot.checksum !== current.slot.checksum || before.installedSlot.identity !== current.slot.identity) throw fail();
    const value = payload(before), text = JSON.stringify(value) + "\n";
    if (!Value.Check(schema, value)) throw fail();
    let existing = false;
    try { await lstat(location.file); existing = true; } catch (error) {
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    if (await backupDirectoryIdentity(location.directory) !== before.directoryIdentity) throw fail();
    guard(); let object: string;
    if (existing) {
      const previous = await readAnchor(location.file); guard();
      if (!same(previous.value, value)) throw fail(); object = previous.proof.objectIdentity;
    } else {
      guard(); const handle = await open(location.file, "wx", 0o600);
      try { await handle.writeFile(text, "utf8"); await handle.sync(); object = witness(await handle.stat({ bigint: true })); }
      finally { await handle.close(); }
      await syncRestoreDirectory(location.directory);
    }
    guard(); await current.recheck(); guard();
    const final = await inspectGenerationGenesisReference(managerRoot, reference, binding, authorize); guard();
    if (!same(payload(final), value)) throw fail();
    const anchor = await readAnchor(location.file); guard();
    if (anchor.proof.objectIdentity !== object || !same(anchor.value, value)) throw fail();
    await finalBoundaries(managerRoot, location, anchor.value, binding); guard();
    return { phase: "issued-reference-awaiting-readiness" as const, inspectionOnly: true as const, recoveryRequired: true as const,
      issuer: anchor.proof, reference: anchor.value };
  } catch { throw fail(); }
}
