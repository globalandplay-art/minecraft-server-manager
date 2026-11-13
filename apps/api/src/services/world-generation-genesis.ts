import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { syncRestoreDirectory } from "./restore-files.js";
import { sealGenerationCompletion, inspectGenerationCompletion } from "./world-generation-completion.js";
import type { verifyGenerationCurrentState } from "./world-generation-current-state.js";
import { generationSlotProofDigest } from "./world-generation-slot.js";
import { inspectGenerationGenesisSnapshot } from "./world-library-store.js";

type Proof = Awaited<ReturnType<typeof verifyGenerationCurrentState>>;
const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Generation genesis requires inspection", "generation-genesis-unverified", true);

/** Dedicated backend lease only. Preserve original catalog bytes after verified
 * completion; never migrate the catalog, settle a receipt or release recovery.
 * Partial or conflicting evidence is retained, not repaired or overwritten. */
export async function sealGenerationGenesis(managerRoot: string, initial: Proof,
  observe: () => Promise<Proof>, authorize: () => undefined) {
  return sealGenesisCore(managerRoot, initial, observe, authorize);
}

export async function sealGenerationCompletionAndGenesis(managerRoot: string, initial: Proof,
  observe: () => Promise<Proof>, authorize: () => undefined) {
  const completion = await sealGenerationCompletion(managerRoot, initial, observe, authorize);
  return sealGenesisCore(managerRoot, await observe(), observe, authorize, completion);
}

async function sealGenesisCore(managerRoot: string, initial: Proof,
  observe: () => Promise<Proof>, authorize: () => undefined,
  retained?: Awaited<ReturnType<typeof sealGenerationCompletion>>) {
  let source: Awaited<ReturnType<typeof readPrivatePropertiesFile>> | undefined;
  const guard = () => {
    if (typeof authorize !== "function" || typeof observe !== "function") throw fail();
    const result: unknown = authorize();
    if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw fail(); }
  };
  try {
    const expected = generationSlotProofDigest(initial), initialSlot = structuredClone(initial.slot);
    guard(); const current = await observe(); guard();
    if (current.slot.state !== "active" || generationSlotProofDigest(current) !== expected ||
        JSON.stringify(current.slot) !== JSON.stringify(initialSlot) ||
        !/^[a-z0-9][a-z0-9-]{0,62}$/u.test(current.serverId) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(current.operationId)) throw fail();
    const directory = path.join(path.resolve(managerRoot), "active-worlds");
    const prefix = `${current.serverId}.${current.operationId}.generation-slot`;
    const completionFile = path.join(directory, prefix + ".completion.json");
    const file = path.join(directory, `${current.serverId}.${current.operationId}.generation-genesis.json`);
    const directoryIdentity = await backupDirectoryIdentity(directory); guard();
    // Missing completion must not cause this entry point to create one or CAS.
    const originalCompletion = await readPrivatePropertiesFile(completionFile, 4096);
    const completedProof = inspectGenerationCompletion(originalCompletion.bytes);
    originalCompletion.bytes.fill(0); guard();
    if (completedProof.proofDigest !== generationSlotProofDigest(current)) throw fail();
    const verified = retained ?? await sealGenerationCompletion(managerRoot, current, observe, authorize, { existingOnly: true }); guard();
    if (verified.serverId !== current.serverId || verified.operationId !== current.operationId ||
        verified.worldId !== current.worldId || verified.installedSlot.checksum !== current.slot.checksum ||
        verified.installedSlot.identity !== current.slot.identity) throw fail();
    if (verified.completion.checksum !== originalCompletion.checksum || verified.completion.identity !== originalCompletion.identity) throw fail();
    if (retained) {
      try { await lstat(path.join(directory, prefix + ".tmp")); throw fail(); } catch (error) {
        if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
      }
      for (const [linkedFile, expected] of [[path.join(directory, prefix + ".json"), verified.casIntent],
        [path.join(directory, `${current.serverId}.json`), verified.installedSlot]] as const) {
        const linked = await readPrivatePropertiesFile(linkedFile, 4096);
        try {
          if (linked.checksum !== expected.checksum || linked.identity !== expected.identity) throw fail();
        } finally { linked.bytes.fill(0); }
        guard();
      }
    }
    source = await readPrivatePropertiesFile(path.join(path.resolve(managerRoot), "world-library", current.serverId, "state.json"), 1024 * 1024);
    const seed = inspectGenerationGenesisSnapshot(source.bytes, { serverId: current.serverId, catalogRevision: current.catalogRevision,
      worldId: current.worldId, executionOperationId: current.operationId, recordDigest: current.recordDigest });
    // Completion confirmation already performed a full current-state recheck.
    // Bind the copied catalog here and retain a NEW full recheck after writing.
    guard();
    if (await backupDirectoryIdentity(directory) !== directoryIdentity) throw fail();
    let exists = false;
    try { await lstat(file); exists = true; } catch (error) {
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    guard(); let identity: string;
    if (exists) {
      const saved = await readPrivatePropertiesFile(file, 1024 * 1024);
      try { if (!saved.bytes.equals(source.bytes)) throw fail(); identity = saved.identity; }
      finally { saved.bytes.fill(0); }
    } else {
      const handle = await open(file, "wx", 0o600);
      try {
        await handle.writeFile(source.bytes); await handle.sync(); const stat = await handle.stat();
        identity = createHash("sha256").update(`${stat.dev}\0${stat.ino}\0${stat.birthtimeMs}`).digest("hex");
      } finally { await handle.close(); }
      await syncRestoreDirectory(directory);
    }
    guard(); await current.recheck(); guard();
    const completion = await readPrivatePropertiesFile(completionFile, 4096);
    completion.bytes.fill(0);
    if (completion.checksum !== originalCompletion.checksum || completion.identity !== originalCompletion.identity ||
        await backupDirectoryIdentity(directory) !== directoryIdentity) throw fail();
    for (const [linkedFile, expected] of [[path.join(directory, prefix + ".json"), verified.casIntent],
      [path.join(directory, `${current.serverId}.json`), verified.installedSlot]] as const) {
      const linked = await readPrivatePropertiesFile(linkedFile, 4096); linked.bytes.fill(0); guard();
      if (linked.checksum !== expected.checksum || linked.identity !== expected.identity) throw fail();
    }
    try { await lstat(path.join(directory, prefix + ".tmp")); throw fail(); } catch (error) {
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    const saved = await readPrivatePropertiesFile(file, 1024 * 1024);
    try {
      if (saved.identity !== identity || saved.checksum !== seed.catalogRevision || !saved.bytes.equals(source.bytes)) throw fail();
      guard();
      return { phase: "genesis-evidence-awaiting-readiness" as const, inspectionOnly: true as const,
        recoveryRequired: true as const, seed, snapshot: { checksum: saved.checksum, identity: saved.identity },
        completion: verified.completion };
    } finally { saved.bytes.fill(0); }
  } catch { throw fail(); }
  finally { source?.bytes.fill(0); }
}
