import { createHash } from "node:crypto";
import { lstat, open, rename } from "node:fs/promises";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { worldIdentity } from "./active-world-state-store.js";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { syncRestoreDirectory } from "./restore-files.js";
import type { verifyGenerationCurrentState } from "./world-generation-current-state.js";

type Proof = Awaited<ReturnType<typeof verifyGenerationCurrentState>>;
const sha = Type.String({ pattern: "^[0-9a-f]{64}$" });
const identity = Type.Object({ checksum: sha, identity: sha }, { additionalProperties: false });
const intentSchema = Type.Object({ schemaVersion: Type.Literal(1), phase: Type.Literal("generation-slot-cas"),
  serverId: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,62}$" }),
  executionOperationId: Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }),
  proofDigest: sha, directoryIdentity: sha, before: identity, after: identity
}, { additionalProperties: false });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Generation slot commit requires inspection", "generation-slot-unverified", true);
/** Strict historical metadata only, not an installed-slot/current-state proof. */
export function inspectGenerationSlotIntent(bytes: Uint8Array): Static<typeof intentSchema> {
  if (bytes.byteLength > 4096) throw fail();
  const copy = Buffer.from(bytes);
  try {
    const text = copy.toString("utf8"), value: unknown = JSON.parse(text);
    if (!copy.equals(Buffer.from(text, "utf8")) || !Value.Check(intentSchema, value) || text !== JSON.stringify(value) + "\n") throw fail();
    return structuredClone(value);
  } catch { throw fail(); } finally { copy.fill(0); }
}
// The slot and its controls digest necessarily change during this one CAS.
// Everything else, including parent/birth/receipts/tree/registration, must not.
export const generationSlotProofDigest = (proof: Proof) => hash({ phase: proof.phase, serverId: proof.serverId, operationId: proof.operationId,
  preparationOperationId: proof.preparationOperationId, preparationTransactionId: proof.preparationTransactionId,
  worldId: proof.worldId, catalogRevision: proof.catalogRevision, receiptDigest: proof.receiptDigest,
  recordDigest: proof.recordDigest, birthChecksum: proof.birthChecksum, birthIdentity: proof.birthIdentity,
  currentTreeChecksum: proof.currentTreeChecksum, registeredExecutionDigest: proof.registeredExecutionDigest,
  nonSlotControlsDigest: proof.nonSlotControlsDigest });
const binding = generationSlotProofDigest;
const missing = (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
async function exists(file: string) { try { await lstat(file); return true; } catch (error) { if (missing(error)) return false; throw error; } }
const openedIdentity = (value: { dev: number; ino: number; birthtimeMs: number }) =>
  createHash("sha256").update(`${value.dev}\0${value.ino}\0${value.birthtimeMs}`).digest("hex");

/** Unmounted backend writer. The caller MUST retain the instance's dedicated
 * mutation lease and lifetime across the entire call, including failed cleanup.
 * observe performs a NEW full current-state proof (not an old pending recheck).
 * No snapshot, receipt, recovery cause or lifecycle permission is changed here.
 * Any uncertain file is retained; no automatic rollback or replay occurs. */
export async function commitGenerationSlot(managerRoot: string, initial: Proof,
  observe: () => Promise<Proof>, authorize: () => undefined) {
  const guard = () => {
    if (typeof authorize !== "function" || typeof observe !== "function") throw fail();
    const result: unknown = authorize();
    if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw fail(); }
  };
  const captured = { ...initial, slot: structuredClone(initial.slot) }, expected = binding(captured);
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/u.test(captured.serverId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(captured.operationId)) throw fail();
  const directory = path.join(path.resolve(managerRoot), "active-worlds"), slot = path.join(directory, `${captured.serverId}.json`);
  const prefix = path.join(directory, `${captured.serverId}.${captured.operationId}.generation-slot`);
  const stage = prefix + ".tmp", intentFile = prefix + ".json";
  const read = async (file: string) => {
    const value = await readPrivatePropertiesFile(file, 4096);
    try { return { text: value.bytes.toString("utf8"), checksum: value.checksum, identity: value.identity }; }
    finally { value.bytes.fill(0); }
  };
  const slotValue = (text: string, state: "active" | "pending-generation") => {
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || Object.keys(value).length !== 5 ||
        Object.keys(value).some(key => !["schemaVersion", "serverId", "state", "levelName", "worldId"].includes(key)) ||
        (text !== JSON.stringify(value) && text !== JSON.stringify(value) + "\n") || value.schemaVersion !== 1 ||
        value.serverId !== captured.serverId || value.state !== state || typeof value.levelName !== "string" ||
        value.worldId !== worldIdentity(captured.serverId, value.levelName)) throw fail();
    return value;
  };
  const sameFile = (value: { checksum: string; identity: string }, expected: { checksum: string; identity: string }) => {
    if (value.checksum !== expected.checksum || value.identity !== expected.identity) throw fail();
  };
  try {
    guard(); const directoryIdentity = await backupDirectoryIdentity(directory); guard();
    // Returned proofs are mutable data, not capabilities. Obtain an independent
    // trusted observation before touching ANY stage/intent or caller-derived slot.
    const beforeProof = await observe(); guard();
    if (binding(beforeProof) !== expected || beforeProof.slot.state !== captured.slot.state) throw fail();
    sameFile(beforeProof.slot, captured.slot); await beforeProof.recheck(); guard();
    // All backend entry points obey the completion fence, not only its writer.
    if (captured.slot.state === "pending-generation" && await exists(prefix + ".completion.json")) throw fail();
    let current = await read(slot); guard(); sameFile(current, captured.slot);
    let intent, intentIdentity: string;
    if (await exists(intentFile)) {
      const saved = await read(intentFile); guard(); const value: unknown = JSON.parse(saved.text);
      if (!Value.Check(intentSchema, value) || saved.text !== JSON.stringify(value) + "\n") throw fail();
      intent = value; intentIdentity = saved.identity;
    } else {
      if (captured.slot.state !== "pending-generation" || await exists(stage)) throw fail();
      const before = slotValue(current.text, "pending-generation"), payload = JSON.stringify({ ...before, state: "active" }) + "\n";
      guard(); const output = await open(stage, "wx", 0o600);
      let stageIdentity: string;
      try { await output.writeFile(payload, "utf8"); await output.sync(); stageIdentity = openedIdentity(await output.stat()); }
      finally { await output.close(); }
      guard(); const staged = await read(stage); guard();
      if (staged.text !== payload || staged.identity !== stageIdentity) throw fail();
      intent = { schemaVersion: 1 as const, phase: "generation-slot-cas" as const, serverId: captured.serverId,
        executionOperationId: captured.operationId, proofDigest: expected, directoryIdentity,
        before: { checksum: current.checksum, identity: current.identity }, after: { checksum: staged.checksum, identity: staged.identity } };
      if (!Value.Check(intentSchema, intent)) throw fail();
      guard(); const handle = await open(intentFile, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify(intent) + "\n", "utf8"); await handle.sync(); intentIdentity = openedIdentity(await handle.stat()); }
      finally { await handle.close(); }
      await syncRestoreDirectory(directory); guard();
      const saved = await read(intentFile); guard();
      if (saved.text !== JSON.stringify(intent) + "\n" || saved.identity !== intentIdentity) throw fail();
    }
    const recheckIntent = async () => {
      const saved = await read(intentFile); guard();
      if (saved.identity !== intentIdentity || saved.text !== JSON.stringify(intent) + "\n" || await backupDirectoryIdentity(directory) !== directoryIdentity) throw fail();
      guard();
      return { checksum: saved.checksum, identity: saved.identity };
    };
    if (intent.serverId !== captured.serverId || intent.executionOperationId !== captured.operationId ||
        intent.proofDigest !== expected || intent.directoryIdentity !== directoryIdentity) throw fail();
    await recheckIntent();
    if (captured.slot.state === "pending-generation") {
      sameFile(current, intent.before);
      const staged = await read(stage); guard(); sameFile(staged, intent.after);
      const before = slotValue(current.text, "pending-generation"); slotValue(staged.text, "active");
      if (staged.text !== JSON.stringify({ ...before, state: "active" }) + "\n") throw fail();
      await beforeProof.recheck(); guard();
      await recheckIntent();
      sameFile(await read(stage), intent.after); guard();
      if (await exists(prefix + ".completion.json")) throw fail();
      current = await read(slot); guard(); sameFile(current, intent.before);
      guard(); await rename(stage, slot);
      await syncRestoreDirectory(directory); guard();
    } else if (captured.slot.state !== "active" || await exists(stage)) throw fail();
    const installed = await read(slot); guard(); sameFile(installed, intent.after); slotValue(installed.text, "active");
    const after = await observe(); guard();
    if (binding(after) !== expected || after.slot.state !== "active") throw fail();
    sameFile(after.slot, intent.after); await after.recheck(); guard();
    const finalIntent = await recheckIntent(); sameFile(await read(slot), intent.after);
    if (await exists(stage)) throw fail(); guard();
    return { inspectionOnly: true as const, recoveryRequired: true as const, serverId: captured.serverId,
      operationId: captured.operationId, worldId: captured.worldId, slotState: "active" as const, slot: structuredClone(intent.after),
      proofDigest: expected, intent: finalIntent };
  } catch { throw fail(); }
}
