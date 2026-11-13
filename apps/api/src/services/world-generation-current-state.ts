import { createHash } from "node:crypto";
import path from "node:path";
import type { AdapterRegistry } from "../adapters/registry.js";
import { worldIdentity, type ProtectedGenerationRecovery } from "./active-world-state-store.js";
import { backupDirectoryIdentity, directoryObjectIdentity } from "./backup-identity.js";
import type { BackupService } from "./backup-service.js";
import { DomainError } from "./domain-errors.js";
import type { OperationStore } from "./operation-store.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { inventoryRestoreTree, restoreFilesChecksum } from "./restore-files.js";
import type { TransactionJournalStore } from "./transaction-journal.js";
import { supportsVanillaWorldLayout } from "./world-compatibility.js";
import { verifyWorldGenerationPreparation, type GenerationPreparationLibrary } from "./world-generation-prepared.js";
import { parseWorldMetadata } from "./world-inventory-service.js";
import type { WorldLibraryStore } from "./world-library-store.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Published generation requires inspection", "generation-current-state-unverified", true);
export type GenerationCurrentStateLibrary = GenerationPreparationLibrary & Pick<WorldLibraryStore, "readPublishedGenerationEvidence">;

/** Read-only FIRST published generation proof. Caller holds an instance lease.
 * No slot write, receipt settlement, startup permission or recovery release.
 * Birth bytes are still exact here; later legitimate saves need a separately
 * reviewed completion/lifecycle policy, not an expanded birth hash exception. */
export async function verifyGenerationCurrentState(registry: AdapterRegistry, managerRoot: string,
  library: GenerationCurrentStateLibrary, journal: TransactionJournalStore, receipts: Pick<OperationStore, "list">,
  backups: Pick<BackupService, "exportSource">, serverId: string, protection?: ProtectedGenerationRecovery) {
  const adapter = registry.getLocal(serverId);
  if (!adapter || adapter.plan.serverInfo.type !== "vanilla" || adapter.plan.serverInfo.minecraftVersion !== "26.3") throw fail();
  const binding = { serverId, rootPath: adapter.plan.rootPath }, expectedProtection = protection && structuredClone(protection);
  const registration = () => {
    const identity = adapter.getRegisteredExecutionIdentity?.();
    if (registry.getLocal(serverId) !== adapter || !identity) throw fail();
    return hash(identity);
  };
  const observe = async () => {
    await adapter.revalidateBeforeStart();
    const evidence = await library.readPublishedGenerationEvidence(binding, journal, receipts), birth = evidence.birth.value;
    const execution = birth.execution, g = evidence.prepared.reservation;
    if (execution.serverId !== serverId || registration() !== execution.registeredExecutionDigest) throw fail();
    // Use actual birth properties bytes, NOT the preparation checksum or a new
    // timestamp exemption. Runtime recoveryRequired is still rejected by proof.
    const controls = await verifyWorldGenerationPreparation(registry, managerRoot, library, journal, backups, serverId,
      { execution, receipts, published: true, currentProperties: birth.properties });
    if (expectedProtection && (expectedProtection.kind !== "protected-pending-generation" || expectedProtection.serverId !== serverId ||
        expectedProtection.worldId !== worldIdentity(serverId, g.nextName) ||
        expectedProtection.levelName !== g.nextName || controls.activeProof.state !== "pending-generation" ||
        expectedProtection.slotChecksum !== controls.activeProof.checksum || expectedProtection.slotIdentity !== controls.activeProof.identity ||
        expectedProtection.propertiesChecksum !== controls.propertiesProof.checksum || expectedProtection.propertiesIdentity !== controls.propertiesProof.identity)) throw fail();
    const target = path.join(binding.rootPath, g.nextName), candidate = birth.candidate;
    if (await backupDirectoryIdentity(target) !== candidate.directoryIdentity || await directoryObjectIdentity(target) !== candidate.objectIdentity) throw fail();
    const level = await readPrivatePropertiesFile(path.join(target, "level.dat"), 8 * 1024 * 1024);
    try {
      const metadata = parseWorldMetadata(level.bytes);
      if (level.identity !== candidate.levelIdentity || level.checksum !== candidate.checksumSha256 || !metadata.readable ||
          metadata.version !== "26.3" || metadata.dataVersion !== 5023) throw fail();
    } finally { level.bytes.fill(0); }
    const tree = await inventoryRestoreTree(target);
    if (!supportsVanillaWorldLayout(tree, { readable: true, version: "26.3", dataVersion: 5023 })) throw fail();
    const treeChecksum = restoreFilesChecksum(tree);
    await controls.recheck();
    if (restoreFilesChecksum(await inventoryRestoreTree(target)) !== treeChecksum || registration() !== execution.registeredExecutionDigest ||
        hash(await library.readPublishedGenerationEvidence(binding, journal, receipts)) !== hash(evidence)) throw fail();
    const finalLevel = await readPrivatePropertiesFile(path.join(target, "level.dat"), 8 * 1024 * 1024);
    try { if (finalLevel.identity !== candidate.levelIdentity || finalLevel.checksum !== candidate.checksumSha256) throw fail(); }
    finally { finalLevel.bytes.fill(0); }
    if (await backupDirectoryIdentity(target) !== candidate.directoryIdentity || await directoryObjectIdentity(target) !== candidate.objectIdentity) throw fail();
    return { evidence, slot: controls.activeProof, currentTreeChecksum: treeChecksum, controlsDigest: controls.controlsDigest,
      nonSlotControlsDigest: controls.nonSlotControlsDigest,
      registeredExecutionDigest: execution.registeredExecutionDigest };
  };
  try {
    const initial = await observe(), execution = initial.evidence.birth.value.execution;
    const recheck = async () => { try { if (hash(await observe()) !== hash(initial)) throw fail(); } catch { throw fail(); } };
    return { phase: "published-generation-current-state" as const, serverId, operationId: execution.executionOperationId,
      preparationOperationId: execution.preparationOperationId, preparationTransactionId: execution.preparationTransactionId,
      worldId: execution.worldId, catalogRevision: initial.evidence.prepared.catalogRevision,
      receiptDigest: initial.evidence.receiptDigest,
      recordDigest: execution.preparedRecordDigest, birthChecksum: initial.evidence.birth.checksum, birthIdentity: initial.evidence.birth.identity,
      currentTreeChecksum: initial.currentTreeChecksum, controlsDigest: initial.controlsDigest, slot: structuredClone(initial.slot),
      worldDirectoryIdentity: initial.evidence.birth.value.candidate.directoryIdentity,
      levelName: initial.evidence.prepared.reservation.nextName,
      nonSlotControlsDigest: initial.nonSlotControlsDigest,
      registeredExecutionDigest: initial.registeredExecutionDigest, recheck };
  } catch { throw fail(); }
}
