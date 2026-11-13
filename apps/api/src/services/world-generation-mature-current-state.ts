import { createHash } from "node:crypto";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { BackupService } from "./backup-service.js";
import { DomainError } from "./domain-errors.js";
import type { OperationStore } from "./operation-store.js";
import type { TransactionJournalStore } from "./transaction-journal.js";
import type { WorldLibraryStore } from "./world-library-store.js";
import { verifyGenerationCurrentState, type GenerationCurrentStateLibrary } from "./world-generation-current-state.js";
import { generationSlotProofDigest } from "./world-generation-slot.js";
import { inspectInitialMaturityPublicationMetadata } from "./world-generation-maturity-publication.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Initial mature world requires physical inspection", "initial-mature-current-state-unverified", true);

/** FIRST schema7 physical evidence only, under the caller's instance lease.
 * Exact birth/guard/registration/stopped/tree rules remain unchanged. No normal
 * gameplay-save exemption, publication authenticity, ready or recovery release.
 * The private historical view and old recheck never escape an observation. */
export async function verifyInitialMatureGenerationCurrentState(registry: AdapterRegistry, managerRoot: string,
  library: WorldLibraryStore, journal: TransactionJournalStore, receipts: Pick<OperationStore, "list">,
  backups: Pick<BackupService, "exportSource">, serverId: string, authorize: () => undefined) {
  const adapter = registry.getLocal(serverId);
  if (!adapter) throw fail();
  const guard = () => {
    if (typeof authorize !== "function" || registry.getLocal(serverId) !== adapter) throw fail();
    const result: unknown = authorize();
    if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw fail(); }
  };
  const observe = async () => {
    guard(); const registration = adapter.getRegisteredExecutionIdentity?.();
    if (!registration) throw fail();
    const binding = { serverId, rootPath: adapter.plan.rootPath }, registeredExecutionDigest = hash(registration);
    const source = await library.readInitialMaturePublishedEvidence(binding, registeredExecutionDigest, journal, receipts, authorize); guard();
    let open = true;
    const assertView = () => { guard(); if (!open) throw fail(); };
    const view: GenerationCurrentStateLibrary = {
      readPublishedGenerationEvidence: async () => { assertView(); return structuredClone(source); },
      readPublishedGenerationPreparation: async () => { assertView(); return structuredClone(source.prepared); },
      readPreparedGeneration: async () => { throw fail(); },
      readSealedGenerationPreparation: async () => { throw fail(); }
    };
    try {
      const proof = await verifyGenerationCurrentState(registry, managerRoot, view, journal, receipts, backups, serverId); guard();
      if (proof.slot.state !== "active" || proof.slot.checksum !== source.maturity.installedSlot.checksum ||
          proof.slot.identity !== source.maturity.installedSlot.identity ||
          proof.registeredExecutionDigest !== registeredExecutionDigest ||
          generationSlotProofDigest(proof) !== source.maturity.birthProofDigest) throw fail();
      const final = await library.readInitialMaturePublishedEvidence(binding, registeredExecutionDigest, journal, receipts, authorize); guard();
      if (hash(final) !== hash(source) || hash(adapter.getRegisteredExecutionIdentity?.()) !== registeredExecutionDigest) throw fail();
      const status = await adapter.getStatus(); guard();
      if (status.state !== "stopped" || status.ownership !== "none" || status.recoveryRequired ||
          hash(adapter.getRegisteredExecutionIdentity?.()) !== registeredExecutionDigest) throw fail();
      // Discard the old closure. Every public recheck below rebuilds a new view.
      return { ...proof, recheck: undefined, phase: "initial-mature-generation-current-state" as const,
        genesisCatalogRevision: proof.catalogRevision, catalogRevision: source.maturity.revision,
        catalogObjectIdentity: source.maturity.objectIdentity, issuer: structuredClone(source.maturity.issuer),
        catalogId: source.prepared.reservation.catalogId, rootIdentity: source.prepared.reservation.rootIdentity,
        birthProofDigest: generationSlotProofDigest(proof), inspectionOnly: true as const,
        recoveryRequired: true as const, catalogPublicationVerified: false as const };
    } finally { open = false; }
  };
  try {
    const baseline = await observe(), originalDigest = hash(baseline);
    return { ...baseline, recheck: async () => {
      try { if (hash(await observe()) !== originalDigest) throw fail(); } catch { throw fail(); }
    } };
  } catch { throw fail(); }
}

/** Read-only baseline for the first managed start. The caller holds the
 * generation lease and must obtain separate permission to dispatch. */
export async function verifyPublishedInitialWorldBaseline(
  registry: AdapterRegistry, managerRoot: string, library: WorldLibraryStore, journal: TransactionJournalStore,
  receipts: Pick<OperationStore, "list">, backups: Pick<BackupService, "exportSource">, serverId: string, authorize: () => undefined
) {
  const adapter = registry.getLocal(serverId);
  if (!adapter) throw fail();
  const binding = { serverId, rootPath: adapter.plan.rootPath };
  const guard = (): undefined => {
    if (registry.getLocal(serverId) !== adapter || adapter.plan.rootPath !== binding.rootPath) throw fail();
    return authorize();
  };
  const proof = await verifyInitialMatureGenerationCurrentState(registry, managerRoot, library, journal, receipts, backups, serverId, guard);
  const publication = {
    executionOperationId: proof.operationId, worldId: proof.worldId, catalogId: proof.catalogId,
    rootIdentity: proof.rootIdentity, issuer: structuredClone(proof.issuer), genesisCatalogRevision: proof.genesisCatalogRevision,
    birthProofDigest: proof.birthProofDigest, catalog: { checksum: proof.catalogRevision, objectIdentity: proof.catalogObjectIdentity }
  };
  const observePublication = () => inspectInitialMaturityPublicationMetadata(managerRoot, binding, publication, proof.recheck, guard);
  const { intent } = await observePublication();
  const recheck = async () => {
    const current = await observePublication();
    if (hash(current.intent) !== hash(intent)) throw fail();
    guard();
  };
  return { ...proof, recheck };
}
