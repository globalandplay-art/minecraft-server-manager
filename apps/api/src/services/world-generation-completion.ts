import { lstat, open } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { syncRestoreDirectory } from "./restore-files.js";
import { commitGenerationSlot, generationSlotProofDigest } from "./world-generation-slot.js";
import type { verifyGenerationCurrentState } from "./world-generation-current-state.js";

type Proof = Awaited<ReturnType<typeof verifyGenerationCurrentState>>;
const sha = Type.String({ pattern: "^[0-9a-f]{64}$" });
const uuid = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" });
const fileProof = Type.Object({ checksum: sha, identity: sha }, { additionalProperties: false });
const schema = Type.Object({ schemaVersion: Type.Literal(1), phase: Type.Literal("generation-completion-evidence"),
  serverId: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,62}$" }), executionOperationId: uuid,
  preparationOperationId: uuid, preparationTransactionId: uuid,
  worldId: Type.String({ pattern: "^worldv2-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }),
  proofDigest: sha, catalogRevision: sha, recordDigest: sha, receiptDigest: sha,
  birth: fileProof, slot: fileProof, intent: fileProof
}, { additionalProperties: false });
const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Generation completion evidence requires inspection", "generation-completion-unverified", true);
/** Strict metadata parser only; no current-state or recovery authority. */
export function inspectGenerationCompletion(bytes: Uint8Array): Static<typeof schema> {
  if (bytes.byteLength > 4096) throw fail();
  const copy = Buffer.from(bytes);
  try {
    const text = copy.toString("utf8"), value: unknown = JSON.parse(text);
    if (!copy.equals(Buffer.from(text, "utf8")) || !Value.Check(schema, value) || text !== JSON.stringify(value) + "\n") throw fail();
    return structuredClone(value);
  } catch { throw fail(); } finally { copy.fill(0); }
}
const exists = async (file: string) => {
  try { await lstat(file); return true; }
  catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return false; throw error; }
};

/** Backend-only, under the dedicated mutation lease and owner lifetime.
 * Append-only completion evidence; never rewrites the original operation
 * receipts, updates active snapshots, clears causes or confers readiness. */
export async function sealGenerationCompletion(managerRoot: string, initial: Proof,
  observe: () => Promise<Proof>, authorize: () => undefined, options?: { existingOnly: true }) {
  const guard = () => {
    if (typeof authorize !== "function" || typeof observe !== "function") throw fail();
    const result: unknown = authorize();
    if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw fail(); }
  };
  const expected = generationSlotProofDigest(initial), expectedSlot = structuredClone(initial.slot);
  const read = async (file: string) => {
    const saved = await readPrivatePropertiesFile(file, 4096);
    try { return { text: saved.bytes.toString("utf8"), checksum: saved.checksum, identity: saved.identity }; }
    finally { saved.bytes.fill(0); }
  };
  try {
    guard(); let current = await observe(); guard();
    if (generationSlotProofDigest(current) !== expected || JSON.stringify(current.slot) !== JSON.stringify(expectedSlot) ||
        !/^[a-z0-9][a-z0-9-]{0,62}$/u.test(current.serverId) || !/^[0-9a-f-]{36}$/u.test(current.operationId)) throw fail();
    const directory = path.join(path.resolve(managerRoot), "active-worlds"), prefix = `${current.serverId}.${current.operationId}.generation-slot`;
    const file = path.join(directory, prefix + ".completion.json"), stage = path.join(directory, prefix + ".tmp");
    const directoryIdentity = await backupDirectoryIdentity(directory); guard();
    // Probe BEFORE the helper: even partial completion forbids CAS/replay.
    const existing = await exists(file); guard();
    if (options?.existingOnly && !existing) throw fail();
    if (existing && current.slot.state !== "active") throw fail();
    const installed = await commitGenerationSlot(managerRoot, current, observe, authorize); guard();
    current = await observe(); guard();
    if (generationSlotProofDigest(current) !== installed.proofDigest || current.slot.state !== "active" ||
        current.slot.identity !== installed.slot.identity || current.slot.checksum !== installed.slot.checksum) throw fail();
    const payload = { schemaVersion: 1 as const, phase: "generation-completion-evidence" as const,
      serverId: current.serverId, executionOperationId: current.operationId,
      preparationOperationId: current.preparationOperationId, preparationTransactionId: current.preparationTransactionId,
      worldId: current.worldId, proofDigest: installed.proofDigest, catalogRevision: current.catalogRevision,
      recordDigest: current.recordDigest, receiptDigest: current.receiptDigest,
      birth: { checksum: current.birthChecksum, identity: current.birthIdentity },
      slot: structuredClone(installed.slot), intent: structuredClone(installed.intent) };
    if (!Value.Check(schema, payload)) throw fail();
    const text = JSON.stringify(payload) + "\n";
    let identity: string;
    if (existing) {
      const saved = await read(file); guard(); const value: unknown = JSON.parse(saved.text);
      if (!Value.Check(schema, value) || saved.text !== text) throw fail();
      identity = saved.identity;
    } else {
      await current.recheck(); guard();
      if (await backupDirectoryIdentity(directory) !== directoryIdentity) throw fail();
      guard(); const output = await open(file, "wx", 0o600);
      try {
        await output.writeFile(text, "utf8"); await output.sync(); const stat = await output.stat();
        identity = createHash("sha256").update(`${stat.dev}\0${stat.ino}\0${stat.birthtimeMs}`).digest("hex");
      } finally { await output.close(); }
      await syncRestoreDirectory(directory); guard();
    }
    // A completion file alone is never a success signal: re-prove intent,
    // original receipt binding, exact installed slot and the complete world.
    await current.recheck(); guard();
    const intent = await read(path.join(directory, prefix + ".json")); guard();
    if (intent.checksum !== installed.intent.checksum || intent.identity !== installed.intent.identity) throw fail();
    if (await backupDirectoryIdentity(directory) !== directoryIdentity) throw fail();
    const slot = await read(path.join(directory, `${current.serverId}.json`)); guard();
    if (slot.checksum !== installed.slot.checksum || slot.identity !== installed.slot.identity) throw fail();
    const final = await read(file); guard();
    if (final.identity !== identity || final.text !== text || await exists(stage)) throw fail();
    guard();
    return { phase: "completion-evidence-awaiting-readiness" as const, inspectionOnly: true as const, recoveryRequired: true as const,
      serverId: current.serverId, operationId: current.operationId, worldId: current.worldId,
      completion: { checksum: final.checksum, identity: final.identity },
      casIntent: structuredClone(installed.intent), installedSlot: structuredClone(installed.slot) };
  } catch { throw fail(); }
}
