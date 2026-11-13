import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import { generationReferenceObjectWitness } from "./world-generation-genesis-reference.js";
import { generationSlotProofDigest } from "./world-generation-slot.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { syncRestoreDirectory } from "./restore-files.js";
import type { verifyGenerationCurrentState } from "./world-generation-current-state.js";
import type { verifyInitialMatureGenerationCurrentState } from "./world-generation-mature-current-state.js";
import type { WorldLibraryStore } from "./world-library-store.js";
import { assertMaturitySameDevice, renameMaturityCatalog, validateMaturityFenceSync } from "./world-generation-maturity-io.js";

type Source = Awaited<ReturnType<typeof verifyGenerationCurrentState>>;
type Target = Awaited<ReturnType<typeof verifyInitialMatureGenerationCurrentState>>;
type Prepared = Awaited<ReturnType<WorldLibraryStore["prepareInitialGenerationMaturity"]>>;
const sha = Type.String({ pattern: "^[0-9a-f]{64}$" });
const uuid = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" });
const fileSchema = Type.Object({ checksum: sha, objectIdentity: sha }, { additionalProperties: false });
const schema = Type.Object({ schemaVersion: Type.Literal(1), phase: Type.Literal("generation-maturity-catalog-cas"),
  serverId: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,62}$" }), executionOperationId: uuid,
  worldId: Type.String({ pattern: "^worldv2-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }),
  catalogId: uuid, rootIdentity: sha, issuer: fileSchema, birthProofDigest: sha,
  directories: Type.Object({ catalog: sha, staging: sha, library: sha, root: sha }, { additionalProperties: false }),
  before: fileSchema, after: fileSchema
}, { additionalProperties: false });
const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Initial maturity publication requires inspection", "generation-maturity-publication-unverified", true);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const missing = (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
async function exists(file: string) { try { await lstat(file); return true; } catch (error) { if (missing(error)) return false; throw error; } }
const object = (value: { dev: bigint; ino: bigint; birthtimeNs: bigint }) =>
  createHash("sha256").update(`${value.dev}\0${value.ino}\0${value.birthtimeNs}`).digest("hex");
async function read(file: string, limit: number) {
  const identity = await generationReferenceObjectWitness(file), saved = await readPrivatePropertiesFile(file, limit);
  try { if (await generationReferenceObjectWitness(file) !== identity) throw fail();
    return { text: saved.bytes.toString("utf8"), checksum: saved.checksum, objectIdentity: identity }; }
  finally { saved.bytes.fill(0); }
}

/** Backend-only under the dedicated instance lease/owner. Atomic metadata CAS,
 * never world/start permission or receipt/recovery settlement. Unknown evidence
 * is retained. Fixed stage is outside the strict catalog directory. */
export async function publishInitialGenerationMaturity(managerRoot: string, binding: { serverId: string; rootPath: string },
  executionId: string, inputIssuer: unknown, inspect6: () => Promise<Source>, prepare6: (proof: Source) => Promise<Prepared>,
  inspect7: () => Promise<Target>, authorize: () => undefined) {
  try {
    const retained = structuredClone(binding), issuer = structuredClone(inputIssuer);
    const guard = () => { if (typeof authorize !== "function") throw fail(); const result: unknown = authorize();
      if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw fail(); } };
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/u.test(retained.serverId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(executionId) ||
        !Value.Check(fileSchema, issuer)) throw fail();
    guard(); const staging = path.join(path.resolve(managerRoot), "active-worlds"), library = path.join(path.resolve(managerRoot), "world-library");
    const catalog = path.join(library, retained.serverId), target = path.join(catalog, "state.json");
    const prefix = path.join(staging, `${retained.serverId}.${executionId}.generation-maturity`), stage = prefix + ".tmp", intentFile = prefix + ".json";
    const directories = async () => ({ catalog: await backupDirectoryIdentity(catalog), staging: await backupDirectoryIdentity(staging),
      library: await backupDirectoryIdentity(library), root: await backupDirectoryIdentity(retained.rootPath) });
    const baselineDirectories = await directories(); guard();
    const directoryControls = () => [{ directory: catalog, identity: baselineDirectories.catalog },
      { directory: staging, identity: baselineDirectories.staging }, { directory: library, identity: baselineDirectories.library },
      { directory: retained.rootPath, identity: baselineDirectories.root }];
    const originalStage = path.join(staging, `${retained.serverId}.${executionId}.generation-slot.tmp`);
    const initial = await read(target, 1024 * 1024), version: unknown = JSON.parse(initial.text).schemaVersion;
    const hasIntent = await exists(intentFile), hasStage = await exists(stage); guard();
    if (![6, 7].includes(version as number) || (version === 7 && (!hasIntent || hasStage)) || (version === 6 && hasStage !== hasIntent)) throw fail();
    let intent: typeof schema.static, intentProof: { checksum: string; objectIdentity: string };
    const loadIntent = async () => {
      const saved = await read(intentFile, 8192), value: unknown = JSON.parse(saved.text);
      if (!Value.Check(schema, value) || saved.text !== JSON.stringify(value) + "\n" ||
          value.serverId !== retained.serverId || value.executionOperationId !== executionId || !equal(value.issuer, issuer) ||
          !equal(value.directories, baselineDirectories)) throw fail();
      return { value, proof: { checksum: saved.checksum, objectIdentity: saved.objectIdentity } };
    };
    if (version === 6) {
      const source = await inspect6(); guard();
      if (source.serverId !== retained.serverId || source.operationId !== executionId || source.slot.state !== "active" || source.catalogRevision !== initial.checksum) throw fail();
      const prepared = structuredClone(await prepare6(source)); guard();
      const candidate = prepared.candidate, text = JSON.stringify(candidate) + "\n", checksum = createHash("sha256").update(text).digest("hex");
      if (text.length > 1024 * 1024 || candidate.schemaVersion !== 7 || candidate.serverId !== retained.serverId ||
          candidate.generationGenesis.worldId !== source.worldId || candidate.generationGenesis.executionOperationId !== executionId ||
          !equal(candidate.generationGenesis.issuer, issuer) || prepared.expectedCatalog.checksum !== initial.checksum ||
          prepared.expectedCatalog.objectIdentity !== initial.objectIdentity) throw fail();
      if (!hasIntent) {
        if (!equal(await directories(), baselineDirectories)) throw fail(); guard();
        const handle = await open(stage, "wx", 0o600); let stagedObject: string;
        try { await handle.writeFile(text, "utf8"); await handle.sync(); stagedObject = object(await handle.stat({ bigint: true })); }
        finally { await handle.close(); }
        await syncRestoreDirectory(staging); guard();
        const saved = await read(stage, 1024 * 1024);
        if (saved.text !== text || saved.objectIdentity !== stagedObject) throw fail();
        intent = { schemaVersion: 1, phase: "generation-maturity-catalog-cas", serverId: retained.serverId, executionOperationId: executionId,
          worldId: source.worldId, catalogId: candidate.catalogId, rootIdentity: candidate.rootIdentity, issuer,
          birthProofDigest: generationSlotProofDigest(source), directories: baselineDirectories,
          before: { checksum: initial.checksum, objectIdentity: initial.objectIdentity }, after: { checksum, objectIdentity: stagedObject } };
        if (!Value.Check(schema, intent)) throw fail(); guard();
        const output = await open(intentFile, "wx", 0o600); let opened: string;
        try { await output.writeFile(JSON.stringify(intent) + "\n", "utf8"); await output.sync(); opened = object(await output.stat({ bigint: true })); }
        finally { await output.close(); }
        await syncRestoreDirectory(staging); guard();
        const loaded = await loadIntent(); if (loaded.proof.objectIdentity !== opened || !equal(loaded.value, intent)) throw fail(); intentProof = loaded.proof;
      } else {
        const loaded = await loadIntent(); intent = loaded.value; intentProof = loaded.proof;
      }
      if (intent.worldId !== source.worldId || intent.catalogId !== candidate.catalogId || intent.rootIdentity !== candidate.rootIdentity ||
          intent.birthProofDigest !== generationSlotProofDigest(source) || intent.before.checksum !== initial.checksum ||
          intent.before.objectIdentity !== initial.objectIdentity || intent.after.checksum !== checksum) throw fail();
      const staged = await read(stage, 1024 * 1024), current = await read(target, 1024 * 1024), linked = await loadIntent();
      if (staged.text !== text || staged.checksum !== intent.after.checksum || staged.objectIdentity !== intent.after.objectIdentity ||
          current.checksum !== intent.before.checksum || current.objectIdentity !== intent.before.objectIdentity ||
          !equal(linked.proof, intentProof) || !equal(linked.value, intent) || !equal(await directories(), baselineDirectories)) throw fail();
      const stageStat = await lstat(stage, { bigint: true }), sourceStat = await lstat(target, { bigint: true });
      assertMaturitySameDevice(sourceStat.dev, stageStat.dev);
      if (object(stageStat) !== intent.after.objectIdentity || object(sourceStat) !== intent.before.objectIdentity) throw fail();
      await source.recheck();
      validateMaturityFenceSync([{ file: target, limit: 1024 * 1024, ...intent.before },
        { file: stage, limit: 1024 * 1024, ...intent.after }, { file: intentFile, limit: 8192, ...intentProof }],
      directoryControls(), catalog, [originalStage]);
      guard(); await renameMaturityCatalog(stage, target);
    } else {
      const loaded = await loadIntent(); intent = loaded.value; intentProof = loaded.proof;
    }
    await syncRestoreDirectory(catalog); await syncRestoreDirectory(staging); guard();
    const proof = await inspect7(); guard();
    if (proof.operationId !== executionId || proof.worldId !== intent.worldId || proof.catalogId !== intent.catalogId ||
        proof.rootIdentity !== intent.rootIdentity || !equal(proof.issuer, issuer) || proof.birthProofDigest !== intent.birthProofDigest ||
        proof.genesisCatalogRevision !== intent.before.checksum || proof.catalogRevision !== intent.after.checksum ||
        proof.catalogObjectIdentity !== intent.after.objectIdentity) throw fail();
    const finalIntent = await loadIntent(), installed = await read(target, 1024 * 1024);
    if (!equal(finalIntent.proof, intentProof) || !equal(finalIntent.value, intent) || installed.checksum !== intent.after.checksum ||
        installed.objectIdentity !== intent.after.objectIdentity || !equal(await directories(), baselineDirectories) || await exists(stage)) throw fail();
    await proof.recheck();
    validateMaturityFenceSync([{ file: target, limit: 1024 * 1024, ...intent.after }, { file: intentFile, limit: 8192, ...intentProof }],
      directoryControls(), catalog, [stage, originalStage]);
    guard();
    return { phase: "initial-maturity-catalog-installed" as const, inspectionOnly: true as const, recoveryRequired: true as const,
      catalogPublicationVerified: true as const, serverId: retained.serverId, operationId: executionId, worldId: intent.worldId,
      catalog: structuredClone(intent.after), intent: structuredClone(intentProof) };
  } catch { throw fail(); }
}

/** Startup metadata observation ONLY. No rename, fsync, repair or confirmation.
 * Caller supplies an already verified initial7 descriptor; the final callback
 * rechecks its immutable journal/receipt provenance before the sync close. */
export async function inspectInitialMaturityPublicationMetadata(managerRoot: string,
  binding: { serverId: string; rootPath: string }, expected: { executionOperationId: string; worldId: string;
    catalogId: string; rootIdentity: string; issuer: { checksum: string; objectIdentity: string };
    genesisCatalogRevision: string; birthProofDigest: string; catalog: { checksum: string; objectIdentity: string } },
  beforeFence: () => Promise<void>, authorize: () => undefined) {
  try {
    const retained = structuredClone(binding), input = structuredClone(expected);
    const guard = () => { if (typeof authorize !== "function" || typeof beforeFence !== "function") throw fail();
      const result: unknown = authorize(); if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw fail(); } };
    if (!Value.Check(schema.properties.serverId, retained.serverId) || !Value.Check(uuid, input.executionOperationId) ||
        !Value.Check(fileSchema, input.issuer) || !Value.Check(fileSchema, input.catalog)) throw fail();
    guard();
    const staging = path.join(path.resolve(managerRoot), "active-worlds"), library = path.join(path.resolve(managerRoot), "world-library");
    const catalog = path.join(library, retained.serverId), file = path.join(catalog, "state.json");
    const prefix = path.join(staging, `${retained.serverId}.${input.executionOperationId}.generation-maturity`);
    const saved = await read(prefix + ".json", 8192), intent: unknown = JSON.parse(saved.text); guard();
    if (!Value.Check(schema, intent) || saved.text !== JSON.stringify(intent) + "\n" || intent.serverId !== retained.serverId ||
        intent.executionOperationId !== input.executionOperationId || intent.worldId !== input.worldId || intent.catalogId !== input.catalogId ||
        intent.rootIdentity !== input.rootIdentity || !equal(intent.issuer, input.issuer) || intent.birthProofDigest !== input.birthProofDigest ||
        intent.before.checksum !== input.genesisCatalogRevision || !equal(intent.after, input.catalog)) throw fail();
    const directories = [{ directory: catalog, identity: intent.directories.catalog }, { directory: staging, identity: intent.directories.staging },
      { directory: library, identity: intent.directories.library }, { directory: retained.rootPath, identity: intent.directories.root }];
    if (intent.directories.root !== input.rootIdentity) throw fail();
    const target = await read(file, 1024 * 1024); guard();
    if (JSON.parse(target.text).schemaVersion !== 7 || target.checksum !== input.catalog.checksum || target.objectIdentity !== input.catalog.objectIdentity) throw fail();
    await beforeFence();
    validateMaturityFenceSync([{ file, limit: 1024 * 1024, ...input.catalog },
      { file: prefix + ".json", limit: 8192, checksum: saved.checksum, objectIdentity: saved.objectIdentity }], directories, catalog,
    [prefix + ".tmp", path.join(staging, `${retained.serverId}.${input.executionOperationId}.generation-slot.tmp`)]);
    guard();
    return { phase: "published-maturity-metadata-only" as const, inspectionOnly: true as const, recoveryRequired: true as const,
      publicationObserved: true as const, durabilityVerified: false as const,
      intent: { checksum: saved.checksum, objectIdentity: saved.objectIdentity } };
  } catch { throw fail(); }
}
