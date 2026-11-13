import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { RuntimeOperationContext } from "../infra/runtime-contract.js";
import type { BackupService } from "./backup-service.js";
import { DomainError } from "./domain-errors.js";
import type { OperationAdmission, OperationService } from "./operation-service.js";
import type { OperationStore, StoredOperation } from "./operation-store.js";
import type { TransactionJournalStore } from "./transaction-journal.js";
import type { WorldLibraryStore } from "./world-library-store.js";
import { readGenerationExecutionTarget, type GenerationExecutionTarget } from "./world-generation-execution.js";
import { captureGenerationOwnedLaunch, observeWorldGenerationCandidate } from "./world-generation-observation.js";
import { verifyWorldGenerationPreparation } from "./world-generation-prepared.js";
import { readGenerationBirth } from "./world-generation-birth.js";
import { verifyGenerationCurrentState } from "./world-generation-current-state.js";
import { commitGenerationSlot } from "./world-generation-slot.js";
import { sealGenerationCompletion } from "./world-generation-completion.js";
import { sealGenerationGenesis, sealGenerationCompletionAndGenesis } from "./world-generation-genesis.js";
import { sealGenerationReference } from "./world-generation-reference-issuer.js";
import { publishInitialGenerationMaturity } from "./world-generation-maturity-publication.js";
import { verifyInitialMatureGenerationCurrentState, verifyPublishedInitialWorldBaseline } from "./world-generation-mature-current-state.js";
import { worldLifecycleFingerprint, type WorldLifecycleReceipt } from "./world-lifecycle-receipt.js";
import { prepareOwnedWorldLaunch, requestOwnedWorldStop, verifyStartupOwnedWorldRevision, type captureOwnedWorldLifecycle } from "./world-owned-lifecycle.js";
import { matchesWorldGenerationSettlement, type WorldGenerationSettlement } from "./world-generation-settlement.js";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Generation requires inspection", "generation-run-unverified", true);
const cleanupBlocked = () => new DomainError(409, "CLEANUP_BLOCKED", "Owned generation cleanup is not confirmed", "generation-cleanup-unverified", true);
type Owner = { promise: Promise<void>; resolve: () => void; controller: AbortController; safe: boolean };
type GenerationProof = Awaited<ReturnType<typeof verifyGenerationCurrentState>>;

/** First-generation runner. Birth-only by default; trusted app opt-in can
 * mount authenticated routes and publish pending catalog evidence. No recovery release.
 * A consumed attempt is never replayed; uncertain cleanup retains its owner. */
export class WorldGenerationService {
  #closing = false;
  readonly #owners = new Set<Owner>();
  readonly #managedLaunches = new Map<string, {
    record: StoredOperation; levelName: string; proof: ReturnType<typeof captureOwnedWorldLifecycle>;
  }>();
  constructor(private readonly registry: AdapterRegistry, private readonly operations: OperationService,
    private readonly journal: TransactionJournalStore, private readonly backups: Pick<BackupService, "exportSource">,
    private readonly managerRoot: string, private readonly library: WorldLibraryStore,
    private readonly receipts: Pick<OperationStore, "list" | "read" | "readWorldLaunchSeal" | "readWorldStopSeal" |
      "readWorldStopConfirmation" | "createWorldGenerationSettlement" | "readWorldGenerationSettlement">,
    private readonly publishCatalog = false) {}

  /** Unmounted read-only composition. No proof callback escapes its lease. */
  async inspectPublished(serverId: string, executionId: string, authorize: OperationAdmission) {
    return this.withRecoveryOwner(authorize, async admission => this.operations.runGenerationInspection(serverId, executionId, async protection => {
      const proof = await verifyGenerationCurrentState(this.registry, this.managerRoot, this.library, this.journal,
        this.receipts, this.backups, serverId, protection);
      admission();
      if (proof.operationId !== executionId) throw fail();
      await proof.recheck(); admission();
      return { inspectionOnly: true as const, recoveryRequired: true as const, serverId,
        operationId: executionId, worldId: proof.worldId, catalogRevision: proof.catalogRevision,
        slotState: proof.slot.state };
    }, admission));
  }

  /** Dedicated historical evidence issuance only. This does not publish a
   * normal catalog, project terminal records, or clear any recovery cause. */
  async recordFirstManagedStopSettlement(serverId: string, stopOperationId: string, authorize: OperationAdmission) {
    return this.withRecoveryOwner(authorize, async admission => {
      const adapter = this.registry.getLocal(serverId), identity = adapter?.getRegisteredExecutionIdentity?.();
      const evidence = await this.operations.readStartupWorldStopCandidate(serverId);
      const store = this.receipts;
      if (!adapter || !identity || !evidence || evidence.stop.operation.id !== stopOperationId ||
          !store.readWorldStopConfirmation || !store.createWorldGenerationSettlement || !store.readWorldGenerationSettlement) throw fail();
      const registered = digest(identity), binding = { serverId, rootPath: adapter.plan.rootPath }, runtime = adapter.getRuntime();
      const guard = (): undefined => {
        admission();
        const current = adapter.getRegisteredExecutionIdentity?.();
        if (this.registry.getLocal(serverId) !== adapter || adapter.getRuntime() !== runtime || adapter.plan.rootPath !== binding.rootPath ||
            !current || digest(current) !== registered) throw fail();
        return undefined;
      };
      guard();
      const initial = await this.library.inspectStoppedInitialGeneration(binding, registered, this.journal, store, evidence, guard);
      let recorded: WorldGenerationSettlement | undefined;
      await verifyStartupOwnedWorldRevision(this.registry, this.operations, serverId, initial.levelName, guard,
        async (target, assertCurrent) => {
          guard(); assertCurrent();
          const current = await this.library.inspectStoppedInitialGeneration(binding, registered, this.journal, store, evidence, assertCurrent);
          if (!target.historicalGeneration || target.worldId !== initial.worldId || target.catalogRevision !== initial.catalog.checksum ||
              digest(current) !== digest(initial)) throw fail();
          guard(); assertCurrent();
        }, stopOperationId, async (current, assertCurrent) => {
          guard(); assertCurrent();
          const confirmation = await store.readWorldStopConfirmation!(stopOperationId), stop = current.stop.worldLifecycle;
          if (confirmation.schemaVersion !== 2 || stop?.action !== "stop") throw fail();
          const value: WorldGenerationSettlement = {
            schemaVersion: 1, phase: "first-managed-generation-settled", serverId, worldId: initial.worldId,
            rootIdentity: stop.rootIdentity, worldDirectoryIdentity: stop.worldDirectoryIdentity, registeredExecutionDigest: registered,
            preparationOperationId: initial.preparationOperationId, executionOperationId: initial.executionOperationId,
            startOperationId: current.start.operation.id, stopOperationId,
            lifecycleDigest: digest(current), confirmationDigest: digest(confirmation), journalDigest: confirmation.journalDigest,
            catalogId: initial.catalogId, catalog: initial.catalog, genesis: initial.genesis,
            revision: { treeChecksum: current.revision.treeChecksum, propertiesChecksum: current.revision.propertiesChecksum,
              propertiesIdentity: current.revision.propertiesIdentity, levelIdentity: current.revision.levelIdentity }
          };
          if (!matchesWorldGenerationSettlement(value, current, confirmation)) throw fail();
          guard(); assertCurrent();
          try { await store.createWorldGenerationSettlement!(value); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
          const saved = await store.readWorldGenerationSettlement!(stopOperationId);
          if (digest(saved) !== digest(value) || !matchesWorldGenerationSettlement(saved, current, confirmation)) throw fail();
          guard(); assertCurrent(); recorded = structuredClone(saved);
        });
      guard();
      if (!recorded) throw fail();
      return { serverId, stopOperationId, worldId: recorded.worldId, historicalEvidenceRecorded: true as const,
        recoveryRequired: true as const };
    });
  }

  /** Explicit authenticated opt-in confirmation; no recovery release. */
  async finalizePublishedGeneration(serverId: string, executionId: string, authorize: OperationAdmission) {
    return this.withRecoveryOwner(authorize, async admission => {
      const adapter = this.registry.getLocal(serverId);
      const identity = adapter?.getRegisteredExecutionIdentity?.();
      if (!adapter || !identity) throw fail();
      const registered = digest(identity);
      const mature = await this.library.inspectInitialGenerationMaturity(
        { serverId, rootPath: adapter.plan.rootPath }, registered, this.journal, this.receipts, admission
      ).catch(() => undefined);
      admission();
      const currentIdentity = adapter.getRegisteredExecutionIdentity?.();
      if (this.registry.getLocal(serverId) !== adapter || !currentIdentity || digest(currentIdentity) !== registered) throw fail();
      if (mature) {
        if (mature.catalog.generationGenesis.executionOperationId !== executionId) throw fail();
        return this.publishInitialMaturity(serverId, executionId, mature.catalog.generationGenesis.issuer, admission);
      }
      await this.withPublishedSlotWriter(serverId, executionId, admission, async (before, observe, guard) => {
        return sealGenerationCompletionAndGenesis(this.managerRoot, before, observe, guard);
      });
      const issued = await this.sealPublishedGenesisReference(serverId, executionId, admission);
      return this.publishInitialMaturity(serverId, executionId, issued.issuer, admission);
    });
  }

  async commitPublishedSlot(serverId: string, executionId: string, authorize: OperationAdmission) {
    return this.withPublishedSlotWriter(serverId, executionId, authorize,
      (before, observe, guard) => commitGenerationSlot(this.managerRoot, before, observe, guard));
  }

  /** Append-only completion evidence, still recovery-gated and unmounted. */
  async sealPublishedCompletion(serverId: string, executionId: string, authorize: OperationAdmission) {
    return this.withPublishedSlotWriter(serverId, executionId, authorize,
      (before, observe, guard) => sealGenerationCompletion(this.managerRoot, before, observe, guard));
  }

  /** Preserve fixed genesis bytes; no readiness or ordinary mutation authority. */
  async sealPublishedGenesis(serverId: string, executionId: string, authorize: OperationAdmission) {
    return this.withPublishedSlotWriter(serverId, executionId, authorize,
      (before, observe, guard) => sealGenerationGenesis(this.managerRoot, before, observe, guard));
  }

  /** Explicit immutable reference issuance, still unmounted and recovery-gated. */
  async sealPublishedGenesisReference(serverId: string, executionId: string, authorize: OperationAdmission) {
    return this.withPublishedSlotWriter(serverId, executionId, authorize,
      (before, observe, guard) => sealGenerationReference(this.managerRoot, before, {
        serverId, rootPath: this.registry.getLocal(serverId)!.plan.rootPath,
        registeredExecutionDigest: before.registeredExecutionDigest }, observe, guard));
  }

  /** Detached initial schema7 candidate, NOT a publication/startup capability. */
  async prepareInitialMaturity(serverId: string, executionId: string, issuerProof: unknown, authorize: OperationAdmission) {
    let retainedIssuer: unknown;
    try { retainedIssuer = structuredClone(issuerProof); } catch { throw fail(); }
    return this.withPublishedSlotWriter(serverId, executionId, authorize, async (before, _observe, guard) => {
      const result = await this.library.prepareInitialGenerationMaturity({ serverId, rootPath: this.registry.getLocal(serverId)!.plan.rootPath },
        before.catalogRevision, executionId, retainedIssuer, before.registeredExecutionDigest, this.journal, this.receipts, guard);
      await before.recheck(); guard();
      return result;
    });
  }

  /** Explicit metadata publication/confirmation only, never a readiness release. */
  async publishInitialMaturity(serverId: string, executionId: string, issuerProof: unknown, authorize: OperationAdmission) {
    let retainedIssuer: unknown;
    try { retainedIssuer = structuredClone(issuerProof); } catch { throw fail(); }
    return this.withRecoveryOwner(authorize, admission => this.operations.runGenerationSlotCommit(serverId, executionId, async (_protection, assertLease) => {
      const adapter = this.registry.getLocal(serverId); if (!adapter) throw fail();
      const guard = (): undefined => { assertLease(); admission(); if (this.registry.getLocal(serverId) !== adapter) throw fail(); return undefined; };
      const binding = { serverId, rootPath: adapter.plan.rootPath };
      return publishInitialGenerationMaturity(this.managerRoot, binding, executionId, retainedIssuer,
        () => verifyGenerationCurrentState(this.registry, this.managerRoot, this.library, this.journal, this.receipts, this.backups, serverId),
        before => this.library.prepareInitialGenerationMaturity(binding, before.catalogRevision, executionId, retainedIssuer,
          before.registeredExecutionDigest, this.journal, this.receipts, guard),
        () => verifyInitialMatureGenerationCurrentState(this.registry, this.managerRoot, this.library, this.journal, this.receipts,
          this.backups, serverId, guard), guard);
    }, admission));
  }

  /** Inspects the first-launch target while the generation causes still own
   * the instance. The lease and physical verifier stay inside this method. */
  async inspectFirstManagedStart(serverId: string, executionId: string, authorize: OperationAdmission) {
    return this.withRecoveryOwner(authorize, admission => this.operations.runGenerationSlotCommit(serverId, executionId,
      async (_protection, assertLease) => {
        const guard = (): undefined => { assertLease(); admission(); return undefined; };
        const proof = await verifyPublishedInitialWorldBaseline(this.registry, this.managerRoot, this.library, this.journal,
          this.receipts, this.backups, serverId, guard);
        if (proof.operationId !== executionId) throw fail();
        guard();
        return { serverId, executionOperationId: executionId, worldId: proof.worldId, catalogRevision: proof.catalogRevision,
          registeredExecutionDigest: proof.registeredExecutionDigest, stoppedTreeChecksum: proof.currentTreeChecksum,
          inspectionOnly: true as const, recoveryRequired: true as const };
      }, admission));
  }

  async stageFirstManagedStart(serverId: string, executionId: string, idempotencyKey: string, authorize: OperationAdmission,
    onLaunch?: Parameters<typeof prepareOwnedWorldLaunch>[5]) {
    return this.withRecoveryOwner(authorize, (admission, signal) => this.operations.stageFirstManagedWorldStart(serverId, executionId, async assertLease => {
      const guard = (): undefined => { assertLease(); admission(); return undefined; };
      let persisted: StoredOperation | undefined;
      const receipts = { list: async () => {
        guard();
        const records = await this.receipts.list();
        guard();
        const lifecycle = records.filter(record => record.operation.serverId === serverId && record.worldLifecycle !== undefined);
        if (!persisted) {
          if (lifecycle.length) throw fail();
          return records;
        }
        if (lifecycle.length !== 1 || digest(lifecycle[0]) !== digest(persisted)) throw fail();
        return records.filter(record => record.operation.id !== persisted!.operation.id);
      } };
      const proof = await verifyPublishedInitialWorldBaseline(this.registry, this.managerRoot, this.library, this.journal,
        receipts, this.backups, serverId, guard);
      if (proof.operationId !== executionId) throw fail();
      const id = randomUUID(), now = new Date();
      const start: WorldLifecycleReceipt = { schemaVersion: 1, action: "start", launchId: null, startOperationId: id,
        serverId, worldId: proof.worldId, catalogRevision: proof.catalogRevision, worldRevision: proof.currentTreeChecksum,
        rootIdentity: proof.rootIdentity, worldDirectoryIdentity: proof.worldDirectoryIdentity,
        registeredExecutionDigest: proof.registeredExecutionDigest, runNonce: randomUUID(), requestDigest: "",
        keyDigest: createHash("sha256").update(idempotencyKey.toLowerCase()).digest("hex") };
      start.requestDigest = worldLifecycleFingerprint(start);
      const recheck = async (saved?: StoredOperation) => {
        persisted = saved;
        try { await proof.recheck(); } finally { persisted = undefined; }
      };
      let launchRecord: StoredOperation | undefined;
      const launch = onLaunch && prepareOwnedWorldLaunch(this.registry, this.operations, start, () => {
        if (!launchRecord) throw fail();
        return recheck(launchRecord);
      }, guard, async (witness, seal) => {
        if (!launchRecord) throw fail();
        await onLaunch(witness, seal);
        guard();
        this.#managedLaunches.set(serverId, { record: structuredClone(launchRecord), levelName: proof.levelName, proof: witness });
      });
      if (launch) launch.guard();
      return { recheck, ...(launch ? { signal, dispatch: (saved: StoredOperation) => {
        launchRecord = saved;
        return launch.dispatch;
      } } : {}),
        record: { operation: { id, serverId, kind: "start", state: "queued", step: "queued", progress: null, result: null, error: null,
        createdAt: now.toISOString(), updatedAt: now.toISOString() }, idempotencyKey, requestFingerprint: start.requestDigest,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), worldLifecycle: start } };
    }, admission));
  }

  async stopFirstManagedWorld(serverId: string, startOperationId: string, idempotencyKey: string, authorize: OperationAdmission) {
    return this.withRecoveryOwner(authorize, async (admission, _signal, retain) => {
      const launch = this.#managedLaunches.get(serverId), parent = launch?.record.worldLifecycle;
      if (!launch || parent?.action !== "start" || launch.record.operation.id !== startOperationId) throw fail();
      const guard = (): undefined => {
        admission();
        if (this.#managedLaunches.get(serverId) !== launch) throw fail();
        return undefined;
      };
      guard();
      const id = randomUUID(), now = new Date().toISOString();
      const stop: WorldLifecycleReceipt = { ...parent, action: "stop", launchId: launch.proof.launchId,
        startReceiptDigest: digest(launch.record),
        keyDigest: createHash("sha256").update(idempotencyKey.toLowerCase()).digest("hex") };
      stop.requestDigest = worldLifecycleFingerprint(stop);
      const record: StoredOperation = { operation: { id, serverId, kind: "stop", state: "queued", step: "queued",
        createdAt: now, updatedAt: now, progress: null, error: null, result: null },
        idempotencyKey, requestFingerprint: stop.requestDigest, expiresAt: launch.record.expiresAt, worldLifecycle: stop };
      let sealed = false;
      const accepted = await requestOwnedWorldStop(this.registry, this.operations, record, launch.levelName, launch.proof, guard,
        async result => { await result.recheck(); guard(); sealed = true; });
      const completion = this.operations.ownedStopCompletion(id);
      retain(completion);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([completion, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(cleanupBlocked()), 5000);
        })]);
      } finally { if (timer) clearTimeout(timer); }
      guard();
      if (this.operations.getServerState(serverId).activeOperationId === id) throw cleanupBlocked();
      if (!sealed) throw fail();
      this.#managedLaunches.delete(serverId);
      return accepted;
    });
  }

  async startFirstManagedWorld(serverId: string, executionId: string, idempotencyKey: string, authorize: OperationAdmission) {
    if (this.registry.getLocal(serverId)?.getRuntime().supportsStopAdmission !== true) throw fail();
    return this.stageFirstManagedStart(serverId, executionId, idempotencyKey, authorize, async () => {});
  }

  private async withPublishedSlotWriter<T>(serverId: string, executionId: string, authorize: OperationAdmission,
    action: (before: GenerationProof, observe: () => Promise<GenerationProof>, guard: OperationAdmission) => Promise<T>): Promise<T> {
    return this.withRecoveryOwner(authorize, async admission => this.operations.runGenerationSlotCommit(serverId, executionId, async (protection, assertLease) => {
      const observe = () => verifyGenerationCurrentState(this.registry, this.managerRoot, this.library, this.journal,
        this.receipts, this.backups, serverId);
      let before = await observe(); admission(); assertLease();
      if (before.operationId !== executionId) throw fail();
      if (before.slot.state === "pending-generation" && protection) {
        before = await verifyGenerationCurrentState(this.registry, this.managerRoot, this.library, this.journal,
          this.receipts, this.backups, serverId, protection);
        admission(); assertLease();
      }
      // An active slot is observation only until the helper proves that this
      // exact durable intent installed its original stage. No intent => reject.
      return action(before, observe, () => { assertLease(); admission(); });
    }, admission));
  }

  private async withRecoveryOwner<T>(authorize: OperationAdmission,
    action: (admission: OperationAdmission, signal: AbortSignal, retain: (completion: Promise<void>) => void) => Promise<T>): Promise<T> {
    let resolve!: () => void;
    const owner: Owner = { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve(),
      controller: new AbortController(), safe: true };
    const admission = (): undefined => {
      if (this.#closing || owner.controller.signal.aborted || typeof authorize !== "function") throw fail();
      const result: unknown = authorize();
      if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw fail(); }
    };
    admission(); this.#owners.add(owner);
    let retained: Promise<void> | undefined;
    const retain = (completion: Promise<void>) => {
      if (retained) throw fail();
      retained = completion;
    };
    try {
      const result = await action(admission, owner.controller.signal, retain);
      admission(); return result;
    } finally {
      const release = () => { this.#owners.delete(owner); owner.resolve(); };
      if (retained) void retained.then(release, release);
      else release();
    }
  }

  async executionTarget(serverId: string, authorize: OperationAdmission) {
    return this.withRecoveryOwner(authorize, async admission => {
      const adapter = this.registry.getLocal(serverId);
      const identity = adapter?.getRegisteredExecutionIdentity?.();
      if (!adapter || !identity) throw fail();
      const registeredExecutionDigest = digest(identity);
      const proof = await verifyWorldGenerationPreparation(this.registry, this.managerRoot, this.library,
        this.journal, this.backups, serverId);
      await proof.recheck();
      const currentIdentity = adapter.getRegisteredExecutionIdentity?.();
      if (this.registry.getLocal(serverId) !== adapter || !currentIdentity || digest(currentIdentity) !== registeredExecutionDigest) throw fail();
      admission();
      return {
        preparationOperationId: proof.reservation.operationId,
        preparationTransactionId: proof.reservation.transactionId,
        worldId: proof.reservation.worldId,
        preparedRecordDigest: proof.recordDigest,
        registeredExecutionDigest
      };
    });
  }

  async generate(serverId: string, key: string, value: unknown, authorize: OperationAdmission) {
    const target = readGenerationExecutionTarget(value);
    if (typeof authorize !== "function") throw fail();
    const admission = (): undefined => {
      if (this.#closing) throw fail();
      const result: unknown = authorize();
      if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw fail(); }
    };
    let owner: Owner | undefined;
    return this.operations.requestGenerationExecution(serverId, key, target, ctx => {
      if (!owner) throw fail();
      return this.execute(serverId, target, ctx, admission, owner);
    }, async () => {
      const proof = await verifyWorldGenerationPreparation(this.registry, this.managerRoot, this.library, this.journal, this.backups, serverId);
      if (proof.recordDigest !== target.preparedRecordDigest || proof.reservation.worldId !== target.worldId) throw fail();
      this.executionIdentity(serverId, target);
    }, admission, () => {
      admission();
      this.executionIdentity(serverId, target);
      let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; });
      owner = { promise, resolve, safe: true, controller: new AbortController() }; this.#owners.add(owner);
      const held = owner;
      return () => {
        if (!held.safe) throw cleanupBlocked();
        this.#owners.delete(held); held.resolve(); return undefined;
      };
    });
  }

  async close(): Promise<void> {
    this.#closing = true;
    for (const owner of this.#owners) owner.controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([Promise.all([...this.#owners].map(owner => owner.promise)), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(cleanupBlocked()), 5000);
    })]); } finally { if (timer) clearTimeout(timer); }
  }

  private executionIdentity(serverId: string, target: GenerationExecutionTarget) {
    const adapter = this.registry.getLocal(serverId), identity = adapter?.getRegisteredExecutionIdentity?.();
    if (!adapter || !identity || digest(identity) !== target.registeredExecutionDigest) throw fail();
    const runtime = adapter.getRuntime();
    if (runtime.supportsSpawnAdmission !== true || !runtime.getOwnedLaunchObservation || !runtime.stopOwnedForRecovery) throw fail();
    return adapter;
  }

  private async execute(serverId: string, target: GenerationExecutionTarget, ctx: RuntimeOperationContext, admission: OperationAdmission, owner: Owner) {
    const adapter = this.executionIdentity(serverId, target), runtime = adapter.getRuntime();
    if (runtime.supportsSpawnAdmission !== true || !runtime.getOwnedLaunchObservation || !runtime.stopOwnedForRecovery) throw fail();
    const binding = { serverId, rootPath: adapter.plan.rootPath };
    const previous = runtime.getOwnedLaunchObservation()?.launchId ?? null;
    let launched = false, recordingFailed = false, stopAttempted = false;
    let closeDeadline: number | undefined;
    let cleanupLaunch: { launchId: string; processId: number | null } | undefined;
    const cleanupContext: RuntimeOperationContext = { operationId: ctx.operationId, signal: new AbortController().signal,
      // Receipt failure must not prevent the owned stop command. The durable
      // generation gate already exists; any recording failure still rejects run.
      onStep: async step => { try { return await ctx.onStep(step); } catch { recordingFailed = true; return this.operations.get(ctx.operationId)!; } } };
    const owned = () => {
      const current = runtime.getOwnedLaunchObservation?.();
      if (!current || current.launchId === previous || current.serverId !== serverId || current.ownerOperationId !== ctx.operationId ||
          !Number.isSafeInteger(current.processId) || current.processId! <= 0) throw cleanupBlocked();
      if (cleanupLaunch && (current.launchId !== cleanupLaunch.launchId || current.processId !== cleanupLaunch.processId)) throw cleanupBlocked();
      cleanupLaunch ??= { launchId: current.launchId, processId: current.processId };
      return current;
    };
    const waitClosed = async (launchId: string, processId: number | null) => {
      const deadline = closeDeadline ??= performance.now() + 5000;
      for (;;) {
        const current = owned();
        if (current.launchId !== launchId || current.processId !== processId) throw cleanupBlocked();
        if (current.exited === true && current.closed === true) { owner.safe = true; return; }
        if (performance.now() >= deadline) throw cleanupBlocked();
        await delay(25);
      }
    };
    const stopOwned = async () => {
      const current = owned();
      if (!current.exited && !stopAttempted) { stopAttempted = true; await runtime.stopOwnedForRecovery!(cleanupContext, ctx.operationId); }
      await waitClosed(current.launchId, current.processId);
    };
    const assertOpen = () => { admission(); if (owner.controller.signal.aborted || ctx.signal.aborted) throw fail(); };
    try {
      const before = await verifyWorldGenerationPreparation(this.registry, this.managerRoot, this.library, this.journal, this.backups, serverId);
      const records = await this.receipts.list(), execution = records.find(record => record.operation.id === ctx.operationId)?.worldGenerationExecution;
      if (!execution || execution.preparedRecordDigest !== before.recordDigest) throw fail();
      await before.recheck(); assertOpen();
      const seal = await this.library.sealGenerationExecution(binding, before.catalogRevision, execution, this.journal, this.receipts);
      if (seal.alreadySealed) throw fail();
      const options = { execution, receipts: this.receipts, requireRunning: true };
      const sealed = await verifyWorldGenerationPreparation(this.registry, this.managerRoot, this.library, this.journal, this.backups, serverId, options);
      if (sealed.controlsDigest !== before.controlsDigest || sealed.recordDigest !== before.recordDigest || digest(sealed.reservation) !== digest(before.reservation)) throw fail();
      await adapter.revalidateBeforeStart();
      if (this.executionIdentity(serverId, target) !== adapter || adapter.getRuntime() !== runtime) throw fail();
      // Reconfirm persisted ownership at the dispatch boundary. A successful
      // earlier seal does not authorize dispatch after receipt replacement.
      const dispatchSeal = await this.library.readGenerationExecutionSeal(binding, this.journal, this.receipts);
      if (digest(dispatchSeal.execution) !== digest(execution) || dispatchSeal.catalogRevision !== sealed.catalogRevision) throw fail();
      const dispatchRecords = (await this.receipts.list()).filter(record => record.operation.id === ctx.operationId);
      if (dispatchRecords.length !== 1 || dispatchRecords[0]?.operation.state !== "running" ||
          digest(dispatchRecords[0]?.worldGenerationExecution ?? null) !== digest(execution)) throw fail();
      await sealed.recheck();
      if (this.executionIdentity(serverId, target) !== adapter || adapter.getRuntime() !== runtime) throw fail();
      assertOpen();
      await adapter.start({ ...ctx, signal: AbortSignal.any([ctx.signal, owner.controller.signal]), beforeSpawn: () => {
        assertOpen();
        if (this.executionIdentity(serverId, target) !== adapter || adapter.getRuntime() !== runtime) throw fail();
        owner.safe = false;
        launched = true;
        return undefined;
      } });
      owned();
      const witness = captureGenerationOwnedLaunch(this.registry, serverId, execution, previous);
      await stopOwned(); witness.assertStopped(); assertOpen(); if (recordingFailed) throw fail();
      const after = await verifyWorldGenerationPreparation(this.registry, this.managerRoot, this.library, this.journal, this.backups, serverId, { ...options, afterStop: before.propertiesProof });
      if (after.controlsDigest !== before.controlsDigest || after.recordDigest !== before.recordDigest) throw fail();
      const candidate = await observeWorldGenerationCandidate(this.registry, serverId, before.reservation, before.propertiesProof);
      await after.recheck();
      await this.library.readGenerationExecutionSeal(binding, this.journal, this.receipts);
      witness.assertStopped(); assertOpen();
      if (candidate.worldId !== target.worldId) throw fail();
      const { directoryIdentity, objectIdentity, levelIdentity, checksumSha256, version, dataVersion } = candidate;
      const birth = readGenerationBirth({ schemaVersion: 1, evidence: "owned-vanilla-26.3-normal-exit", execution,
        launchId: witness.launchId, candidate: { directoryIdentity, objectIdentity, levelIdentity, checksumSha256, version, dataVersion },
        properties: after.propertiesProof });
      const recheckLive = async () => {
        witness.assertStopped(); assertOpen();
        const current = await observeWorldGenerationCandidate(this.registry, serverId, before.reservation, before.propertiesProof);
        if (digest(current) !== digest(candidate) || this.executionIdentity(serverId, target) !== adapter) throw fail();
        witness.assertStopped(); assertOpen();
      };
      await this.library.sealGenerationBirth(binding, birth, this.journal, this.receipts, recheckLive, () => {
        witness.assertStopped(); assertOpen();
        if (this.executionIdentity(serverId, target) !== adapter) throw fail();
        return undefined;
      });
      await after.recheck(); await recheckLive();
      await ctx.onStep("generation-birth-awaiting-catalog-publication");
      if (this.publishCatalog) {
        await this.library.publishGenerationBirth(binding, birth, this.journal, this.receipts, recheckLive, () => {
          witness.assertStopped(); assertOpen(); return undefined;
        });
        const published = await verifyWorldGenerationPreparation(this.registry, this.managerRoot, this.library, this.journal, this.backups,
          serverId, { ...options, afterStop: before.propertiesProof, published: true });
        if (published.controlsDigest !== before.controlsDigest) throw fail();
        await published.recheck(); await recheckLive();
        await ctx.onStep("generation-catalog-awaiting-recovery-verification");
      }
      // Pending catalog publication never clears the persistent generation gate.
    } catch (error) {
      if (launched && !owner.safe) {
        try { await stopOwned(); } catch { throw cleanupBlocked(); }
      }
      throw error;
    }
  }
}
