import { lstat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { generationGenesisReferenceSchema, generationReferenceObjectsSchema } from "./world-generation-reference-schema.js";
export { generationGenesisReferenceSchema, generationReferenceObjectsSchema } from "./world-generation-reference-schema.js";
export type { GenerationGenesisReference } from "./world-generation-reference-schema.js";
import { Value } from "@sinclair/typebox/value";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { readGenerationBirth } from "./world-generation-birth.js";
import { inspectGenerationCompletion } from "./world-generation-completion.js";
import { inspectGenerationSlotIntent } from "./world-generation-slot.js";
import { inspectGenerationGenesisSnapshot } from "./world-library-store.js";

const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Generation historical reference requires inspection", "generation-reference-unverified", true);
// Per-call stability witness only. This does not change or retroactively
// strengthen the historical numeric identity format stored by older writers.
export async function generationReferenceObjectWitness(file: string): Promise<string> {
  const value = await lstat(file, { bigint: true });
  if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1n) throw fail();
  return createHash("sha256").update(`${value.dev}\0${value.ino}\0${value.birthtimeNs}`).digest("hex");
}

/** Read-only historical link inspection, under the caller's instance lease.
 * Expected binding comes from the registered backend instance, never HTTP paths.
 * Does NOT verify parent journal/receipt provenance, current world content or
 * ordinary lifecycle. Never opens a write handle or releases a recovery gate.
 * A future mature catalog must authenticate this reference before using it. */
export async function inspectGenerationGenesisReference(managerRoot: string, input: unknown,
  expected: { serverId: string; rootPath: string; registeredExecutionDigest: string }, authorize: () => undefined) {
  const guard = () => {
    if (typeof authorize !== "function") throw fail();
    const result: unknown = authorize();
    if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw fail(); }
  };
  try {
    if (!Value.Check(generationGenesisReferenceSchema, input)) throw fail();
    const reference = structuredClone(input), binding = structuredClone(expected); guard();
    if (reference.serverId !== binding.serverId) throw fail();
    const root = path.resolve(managerRoot), directory = path.join(root, "active-worlds"), library = path.join(root, "world-library");
    const prefix = `${reference.serverId}.${reference.executionOperationId}.generation-slot`;
    const paths = { snapshot: path.join(directory, `${reference.serverId}.${reference.executionOperationId}.generation-genesis.json`),
      completion: path.join(directory, prefix + ".completion.json"), intent: path.join(directory, prefix + ".json"),
      birth: path.join(library, `${reference.serverId}.generation-birth.json`),
      execution: path.join(library, `${reference.serverId}.generation-execution.json`),
      anchor: path.join(library, `${reference.serverId}.identity.json`) };
    const directoryIdentity = await backupDirectoryIdentity(directory), libraryIdentity = await backupDirectoryIdentity(library);
    const registeredRoot = await backupDirectoryIdentity(binding.rootPath); guard();
    const seen: { file: string; limit: number; checksum: string; identity: string; object: string }[] = [];
    const read = async <T>(file: string, limit: number, parse: (bytes: Buffer) => T) => {
      const object = await generationReferenceObjectWitness(file); guard();
      const saved = await readPrivatePropertiesFile(file, limit);
      try { if (await generationReferenceObjectWitness(file) !== object) throw fail();
        guard(); const value = parse(saved.bytes); seen.push({ file, limit, checksum: saved.checksum, identity: saved.identity, object });
        return { value, checksum: saved.checksum, identity: saved.identity }; }
      finally { saved.bytes.fill(0); }
    };
    const snapshot = await read(paths.snapshot, 1024 * 1024, bytes => inspectGenerationGenesisSnapshot(bytes, {
      serverId: reference.serverId, catalogRevision: reference.snapshot.checksum, worldId: reference.worldId,
      executionOperationId: reference.executionOperationId, recordDigest: reference.recordDigest }));
    const seed = snapshot.value;
    if (snapshot.identity !== reference.snapshot.identity || seed.rootIdentity !== registeredRoot ||
        seed.registeredExecutionDigest !== binding.registeredExecutionDigest) throw fail();
    const completion = await read(paths.completion, 4096, inspectGenerationCompletion), completed = completion.value;
    if (completion.checksum !== reference.completion.checksum || completion.identity !== reference.completion.identity ||
        completed.serverId !== seed.serverId || completed.executionOperationId !== seed.executionOperationId ||
        completed.worldId !== seed.worldId || completed.catalogRevision !== seed.catalogRevision || completed.recordDigest !== seed.recordDigest ||
        completed.preparationOperationId !== seed.preparationOperationId || completed.preparationTransactionId !== seed.preparationTransactionId ||
        completed.birth.checksum !== seed.birthChecksum || completed.birth.identity !== seed.birthIdentity) throw fail();
    const intent = await read(paths.intent, 4096, inspectGenerationSlotIntent), cas = intent.value;
    if (intent.checksum !== completed.intent.checksum || intent.identity !== completed.intent.identity ||
        cas.serverId !== seed.serverId || cas.executionOperationId !== seed.executionOperationId || cas.proofDigest !== completed.proofDigest ||
        cas.directoryIdentity !== directoryIdentity || cas.after.checksum !== completed.slot.checksum || cas.after.identity !== completed.slot.identity) throw fail();
    const birth = await read(paths.birth, 4096, bytes => {
      const text = bytes.toString("utf8"), value = readGenerationBirth(JSON.parse(text));
      if (!bytes.equals(Buffer.from(text, "utf8")) || text !== JSON.stringify(value) + "\n") throw fail();
      return value;
    });
    const execution = await read(paths.execution, 4096, () => undefined);
    await read(paths.anchor, 4096, bytes => {
      const value = { schemaVersion: 1, serverId: seed.serverId, catalogId: seed.catalogId, rootIdentity: seed.rootIdentity };
      if (!bytes.equals(Buffer.from(JSON.stringify(value) + "\n", "utf8"))) throw fail();
    });
    if (birth.checksum !== seed.birthChecksum || birth.identity !== seed.birthIdentity ||
        birth.value.execution.executionOperationId !== seed.executionOperationId || birth.value.candidate.directoryIdentity !== seed.directoryIdentity ||
        createHash("sha256").update(JSON.stringify(birth.value.execution) + "\n").digest("hex") !== seed.executionAnchorChecksum ||
        execution.checksum !== seed.executionAnchorChecksum) throw fail();
    // Current active slot and mutable catalog intentionally are NOT historical
    // dependencies: later reviewed transitions may legitimately change them.
    for (const previous of seen) {
      if (await generationReferenceObjectWitness(previous.file) !== previous.object) throw fail(); guard();
      const saved = await readPrivatePropertiesFile(previous.file, previous.limit);
      try { guard(); if (saved.checksum !== previous.checksum || saved.identity !== previous.identity ||
          await generationReferenceObjectWitness(previous.file) !== previous.object) throw fail(); }
      finally { saved.bytes.fill(0); }
    }
    if (await backupDirectoryIdentity(directory) !== directoryIdentity || await backupDirectoryIdentity(library) !== libraryIdentity ||
        await backupDirectoryIdentity(binding.rootPath) !== registeredRoot) throw fail();
    try { await lstat(path.join(directory, prefix + ".tmp")); throw fail(); } catch (error) {
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    guard();
    const objects = Object.fromEntries(Object.entries(paths).map(([key, file]) => [key, seen.find(item => item.file === file)?.object]));
    if (!Value.Check(generationReferenceObjectsSchema, objects)) throw fail();
    return { phase: "historical-genesis-links-only" as const, inspectionOnly: true as const, recoveryRequired: true as const, reference, seed,
      receiptDigest: completed.receiptDigest, proofDigest: completed.proofDigest, objects,
      installedSlot: structuredClone(completed.slot),
      birthEvidence: { value: structuredClone(birth.value), checksum: birth.checksum, identity: birth.identity },
      directoryIdentity, libraryIdentity, rootIdentity: registeredRoot };
  } catch { throw fail(); }
}
