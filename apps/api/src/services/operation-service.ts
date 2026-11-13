import { createHash, randomUUID } from "node:crypto";

import type { Operation } from "@mcsm/contracts";

import type { Clock } from "../clock.js";
import type { RuntimeOperationContext } from "../infra/runtime-contract.js";
import { DomainError } from "./domain-errors.js";
import { readWorldLifecycleStopEvidence, worldStopConfirmation, type OperationStore, type StoredOperation } from "./operation-store.js";
import type { JournalScanResult } from "./transaction-journal.js";
import { worldIdentity, type ProtectedGenerationRecovery } from "./active-world-state-store.js";
import { generationExecutionRequest, generationKeyDigest, readGenerationExecution, readGenerationExecutionTarget, validGenerationExecutionReceipt,
  type GenerationExecutionTarget } from "./world-generation-execution.js";
import { matchesWorldLifecycleStop, validWorldLifecycleLaunchSeal, validWorldLifecycleReceipt, validWorldLifecycleStopSeal,
  type WorldLifecycleLaunchSeal, type WorldLifecycleStopSeal } from "./world-lifecycle-receipt.js";

const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
type LifecycleKind = "start" | "stop" | "restart";
type FirstManagedStartPlan = { record: StoredOperation; recheck: (persisted?: StoredOperation) => Promise<void>;
  dispatch?: (persisted: StoredOperation) => OwnedWorldStartDispatch; signal?: AbortSignal };
type OwnedWorldStartDispatch = (context: Pick<RuntimeOperationContext, "operationId" | "signal"> & {
  beforeSpawn: () => undefined; verifyBeforeSpawn: () => Promise<void>;
  sealLaunch: (launchId: string, assertRunning: OperationAdmission) => Promise<WorldLifecycleLaunchSeal>;
}) => Promise<void>;
const unverifiedOwnedStart = () => new DomainError(409, "RECOVERY_REQUIRED", "World start intent requires inspection", "world-start-intent-unverified", true);
type StoppedRevision = Omit<WorldLifecycleStopSeal, "schemaVersion" | "stopOperationId" | "stopIntentDigest">;
const recordDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Trusted backend checks only; Promise-returning callbacks are not an admission boundary. */
export type OperationAdmission = () => undefined;

/** Trusted backend observation only; never an HTTP DTO or caller-supplied token. */
export type ReplacementOutcomeProof = {
  serverId: string; operationId: string; transactionId: string; worldId: string;
  journalDigest: string; recordDigest: string; catalogRevision: string;
  phase: "current-state"; recheck: () => Promise<void>;
  verifiedImports?: readonly { operationId: string; transactionId: string; worldId: string; recordDigest: string }[];
};
type OperationListener = (operation: Operation) => void;

export interface OperationServerState {
  readonly activeOperationId: string | null;
  readonly recoveryRequired: boolean;
}

export class OperationService {
  readonly #store: OperationStore;
  readonly #clock: Clock;
  readonly #records = new Map<string, StoredOperation>();
  readonly #idempotency = new Map<string, StoredOperation>();
  readonly #activeByServer = new Map<string, string>();
  readonly #recoveryServers = new Set<string>();
  readonly #recoveryCauses = new Map<string, Set<string>>();
  readonly #listeners = new Set<OperationListener>();
  readonly #exclusiveLocks = new Set<string>();
  #generationStartupScan: JournalScanResult | undefined;
  readonly #generationSlots = new Map<string, { parentId: string; executionId: string; protection: ProtectedGenerationRecovery }>();
  readonly #unregistered = new Set<string>();
  readonly #startupStops = new Map<string, { startId: string; stopId: string; digest: string }>();
  readonly #firstManagedStarts = new Map<string, { operationId: string; causes: readonly string[] }>();
  readonly #ownedStopTasks = new Map<string, Promise<void>>();
  unregister(serverId: string): void {
    if (!this.#exclusiveLocks.has(serverId)) throw new Error('Instance removal requires exclusive admission');
    this.#unregistered.add(serverId);
  }
  isUnregistered(serverId: string): boolean { return this.#unregistered.has(serverId); }
  private assertRegistered(serverId: string): void {
    if (this.#unregistered.has(serverId)) throw new DomainError(404, 'SERVER_NOT_FOUND', '实例已从 LT 移除');
  }
  readonly #verifiedTerminalOperations = new Set<string>();
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(
    store: OperationStore,
    clock: Clock,
    private readonly transactionRecovery?: { initialize(bindLocation?: boolean): Promise<JournalScanResult>; scanExisting?(): Promise<JournalScanResult> }
  ) {
    this.#store = store;
    this.#clock = clock;
  }

  async initialize(check = () => {}): Promise<void> {
    this.#startupStops.clear();
    this.#firstManagedStarts.clear();
    this.#generationStartupScan = undefined; this.#generationSlots.clear();
    try { await this.initializeState(check); }
    catch (error) { this.#startupStops.clear(); this.#generationStartupScan = undefined; this.#generationSlots.clear(); throw error; }
  }

  /** A matching persisted chain is an inspection candidate, never readiness. */
  async readStartupWorldStopCandidate(serverId: string) {
    const candidate = this.#startupStops.get(serverId);
    if (!candidate) return undefined;
    const evidence = await readWorldLifecycleStopEvidence(this.#store, candidate.startId, candidate.stopId);
    if (!evidence || this.#startupStops.get(serverId) !== candidate || recordDigest(evidence) !== candidate.digest) return undefined;
    return structuredClone(evidence);
  }

  async runStartupWorldStopInspection<T>(serverId: string, admission: OperationAdmission,
    inspect: (assertCurrent: OperationAdmission, historicalGeneration: boolean,
      checkConfirmation: (evidence: NonNullable<Awaited<ReturnType<typeof readWorldLifecycleStopEvidence>>>,
        write: boolean, requireSchema2?: boolean) => Promise<boolean>) => Promise<T>,
    allowHistoricalGeneration = false): Promise<T> {
    const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "World stop evidence requires inspection", "world-stop-startup-unverified", true);
    const candidate = this.#startupStops.get(serverId);
    if (!candidate) throw fail();
    const lifecycleCauses = [`world-lifecycle-unverified:${candidate.startId}`, `world-lifecycle-unverified:${candidate.stopId}`];
    let scope: string | undefined;
    let historicalGeneration = false;
    const checkScope = () => {
      const result: unknown = admission();
      if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw fail(); }
      this.assertRegistered(serverId);
      const causes = this.#recoveryCauses.get(serverId);
      if (this.#startupStops.get(serverId) !== candidate || this.#activeByServer.has(serverId) ||
          !causes || lifecycleCauses.some(cause => !causes.has(cause))) throw fail();
      const current = JSON.stringify([...causes].sort());
      if (scope !== undefined) {
        if (current !== scope) throw fail();
        return;
      }
      if (causes.size !== 2) {
        const scan = this.#generationStartupScan;
        const parents = scan?.records.filter(record => record.intent.serverId === serverId) ?? [];
        const parent = parents[0], generation = parent?.intent.worldChange?.generation;
        const stop = this.#records.get(candidate.stopId)?.worldLifecycle;
        if (!allowHistoricalGeneration || !scan || scan.recoveryServerIds.has(serverId) ||
            scan.issues.some(issue => !issue.serverId || issue.serverId === serverId) || parents.length !== 1 ||
            parent?.schemaVersion !== 14 || parent.state !== "committed" || !generation || stop?.action !== "stop" ||
            stop.worldId !== generation.worldId || stop.rootIdentity !== generation.rootIdentity) throw fail();
        const executions = [...this.#records.values()].filter(record => record.worldGenerationExecution?.serverId === serverId);
        const execution = executions[0], binding = execution?.worldGenerationExecution;
        if (executions.length !== 1 || !execution || !validGenerationExecutionReceipt(execution) || !binding ||
            binding.worldId !== stop.worldId || binding.registeredExecutionDigest !== stop.registeredExecutionDigest ||
            binding.preparationOperationId !== parent.intent.operationId || binding.preparationTransactionId !== parent.transactionId ||
            binding.preparedRecordDigest !== recordDigest(parent)) throw fail();
        const ids = [parent.intent.operationId, execution.operation.id];
        const allowed = new Set([...lifecycleCauses, `generation-slot:${ids[0]}`,
          ...ids.flatMap(id => [`generation-unverified:${id}`, `operation:${id}`, `journal:${id}`])]);
        if (ids.some(id => !causes.has(`generation-unverified:${id}`)) || [...causes].some(cause => !allowed.has(cause))) throw fail();
        historicalGeneration = true;
      }
      scope = current;
    };
    await this.#mutate(async () => {
      checkScope();
      if (this.#exclusiveLocks.has(serverId)) throw fail();
      this.#exclusiveLocks.add(serverId);
    });
    let open = true, succeeded = false;
    const assertCurrent = (): undefined => {
      checkScope();
      if (!open || !this.#exclusiveLocks.has(serverId)) throw fail();
      return undefined;
    };
    const checkConfirmation = async (evidence: NonNullable<Awaited<ReturnType<typeof readWorldLifecycleStopEvidence>>>, write: boolean,
      requireSchema2 = false) => {
      const expected = worldStopConfirmation(evidence);
      const { createWorldStopConfirmation, readWorldStopConfirmation } = this.#store;
      if (expected.stopOperationId !== candidate.stopId) throw fail();
      if (!readWorldStopConfirmation) {
        if (write) throw fail();
        return false;
      }
      const checkEvidence = async () => {
        assertCurrent();
        let journalDigest: string | undefined;
        if (this.transactionRecovery?.scanExisting) {
          const scopedJournal = (scan: JournalScanResult) => scan.records.filter(record => record.intent.serverId === serverId)
            .map(recordDigest).sort();
          const baseline = this.#generationStartupScan;
          let current: JournalScanResult;
          try { current = await this.transactionRecovery.scanExisting(); }
          catch { throw fail(); }
          const records = scopedJournal(current);
          if (!baseline?.locationIdentity || current.locationIdentity !== baseline.locationIdentity ||
              current.recoveryServerIds.has(serverId) ||
              current.issues.some(issue => !issue.serverId || issue.serverId === serverId) ||
              recordDigest(records) !== recordDigest(scopedJournal(baseline))) throw fail();
          journalDigest = recordDigest({ locationIdentity: current.locationIdentity, records });
        } else if (historicalGeneration) throw fail();
        let scoped: StoredOperation[];
        try { scoped = (await this.#store.list()).filter(record => record.operation.serverId === serverId && record.worldLifecycle !== undefined); }
        catch { throw fail(); }
        if (scoped.length !== 2 ||
            !scoped.some(record => record.operation.id === candidate.startId && recordDigest(record) === recordDigest(evidence.start)) ||
            !scoped.some(record => record.operation.id === candidate.stopId && recordDigest(record) === recordDigest(evidence.stop))) throw fail();
        const current = await this.readStartupWorldStopCandidate(serverId);
        if (!current || recordDigest(worldStopConfirmation(current)) !== recordDigest(expected)) throw fail();
        assertCurrent();
        return journalDigest;
      };
      let created = false;
      if (write) {
        if (!createWorldStopConfirmation) throw fail();
        const journalDigest = await checkEvidence();
        if (journalDigest === undefined) throw fail();
        try {
          await createWorldStopConfirmation.call(this.#store, worldStopConfirmation(evidence, journalDigest));
          created = true;
        }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw fail(); }
      }
      const journalDigest = await checkEvidence();
      try {
        const saved = await readWorldStopConfirmation.call(this.#store, candidate.stopId);
        if (saved.stopOperationId !== expected.stopOperationId || saved.evidenceDigest !== expected.evidenceDigest ||
            (saved.schemaVersion === 2 && saved.journalDigest !== journalDigest) ||
            ((created || requireSchema2) && saved.schemaVersion !== 2)) throw fail();
      } catch (error) {
        assertCurrent();
        if (!write && (error as NodeJS.ErrnoException).code === "ENOENT") {
          await checkEvidence();
          return false;
        }
        throw fail();
      }
      assertCurrent();
      return true;
    };
    try {
      const result = await inspect(assertCurrent, historicalGeneration, checkConfirmation);
      succeeded = true;
      return result;
    } finally {
      await this.#mutate(async () => {
        try { if (succeeded) assertCurrent(); }
        finally { open = false; this.#exclusiveLocks.delete(serverId); }
      });
    }
  }

  private async initializeState(check: () => void): Promise<void> {
    check();
    await this.#store.initialize();
    const [stored, transactionScan] = await Promise.all([
      this.#store.list(),
      this.transactionRecovery?.initialize(true)
    ]);
    const now = this.#clock.now();
    check();
    const activationKeys = new Map<string, string>();
    const lifecycleByServer = new Map<string, StoredOperation[]>();
    for (const record of stored) if (record.worldLifecycle !== undefined) {
      if (!validWorldLifecycleReceipt(record)) throw new DomainError(409, "RECOVERY_REQUIRED", "World lifecycle receipt requires inspection", "world-lifecycle-receipt-unverified", true);
      // No revision-consumption verifier exists yet. Even terminal tags remain
      // blocked; preserve raw evidence instead of normalizing it on restart.
      this.#addRecovery(record.operation.serverId, `world-lifecycle-unverified:${record.operation.id}`);
      const scope = lifecycleByServer.get(record.operation.serverId) ?? [];
      scope.push(record);
      lifecycleByServer.set(record.operation.serverId, scope);
    }
    for (const [serverId, scope] of lifecycleByServer) {
      if (scope.length !== 2) continue;
      const start = scope.find(record => record.worldLifecycle?.action === "start");
      const stop = scope.find(record => record.worldLifecycle?.action === "stop");
      if (!start || !stop) continue;
      const startId = start.operation.id, stopId = stop.operation.id;
      const evidence = await readWorldLifecycleStopEvidence(this.#store, startId, stopId);
      check();
      if (evidence && recordDigest(evidence.start) === recordDigest(start) && recordDigest(evidence.stop) === recordDigest(stop)) {
        this.#startupStops.set(serverId, { startId, stopId, digest: recordDigest(evidence) });
      }
    }
    for (const record of stored) if (record.worldGenerationExecution !== undefined && !validGenerationExecutionReceipt(record)) {
      throw new DomainError(409, "RECOVERY_REQUIRED", "World generation execution receipt requires inspection", "generation-execution-receipt-invalid", true);
    }
    const lifecycleScopes = new Set(stored.filter(record => record.worldLifecycle).map(record =>
      `${record.operation.serverId}:${record.operation.kind}:${record.idempotencyKey.toLowerCase()}`));
    const protectedScope = (record: StoredOperation) => {
      if (record.operation.kind === "world-create") return this.#generationScope(record.operation.serverId, record.idempotencyKey);
      const normalized = `${record.operation.serverId}:${record.operation.kind}:${record.idempotencyKey.toLowerCase()}`;
      return lifecycleScopes.has(normalized) ? normalized : this.#idempotencyScope(record);
    };
    const protectedScopes = new Set(stored.filter(record => ["world-activate", "world-replace"].includes(record.operation.kind) || record.worldGenerationExecution || record.worldLifecycle)
      .map(protectedScope));
    for (const record of stored) if (protectedScopes.has(protectedScope(record))) {
      const scope = protectedScope(record), previous = activationKeys.get(scope);
      if (previous !== undefined && previous !== record.operation.id) {
        throw new DomainError(409, "RECOVERY_REQUIRED", "World activation request history is ambiguous", "world-activation-idempotency-collision", true);
      }
      activationKeys.set(scope, record.operation.id);
    }
    for (const record of transactionScan?.records ?? []) {
      if (record.schemaVersion === 14 || record.intent.worldChange?.generation) {
        this.#verifiedTerminalOperations.delete(record.intent.operationId);
        this.#addRecovery(record.intent.serverId, `generation-unverified:${record.intent.operationId}`);
        this.requireTransactionRecovery(record.intent.serverId, record.intent.operationId);
      }
      if (record.intent.worldReplacement) {
        this.#verifiedTerminalOperations.delete(record.intent.operationId);
        this.#addRecovery(record.intent.serverId, `replacement-unverified:${record.intent.operationId}`);
      }
      if (["active", "recovery-required"].includes(record.state)) this.#addRecovery(record.intent.serverId, `journal:${record.intent.operationId}`);
    }
    for (const issue of transactionScan?.issues ?? []) if (issue.serverId) this.#addRecovery(issue.serverId, `issue:${issue.fileName}`);
    const journalOwners = new Map<string, string[]>();
    for (const record of transactionScan?.records ?? []) {
      const owners = journalOwners.get(record.intent.operationId) ?? [];
      owners.push(record.intent.serverId); journalOwners.set(record.intent.operationId, owners);
    }
    for (const [operationId, owners] of journalOwners) if (owners.length > 1) {
      for (const serverId of owners) this.#addRecovery(serverId, `issue:duplicate-operation:${operationId}`);
    }
    // A duplicate operation can affect an earlier owner that has no own issue row.
    // Preserve the scanner's complete fail-closed set while retaining precise
    // journal causes for otherwise resolvable restore/rollback transactions.
    for (const serverId of transactionScan?.recoveryServerIds ?? []) {
      if (!this.#recoveryServers.has(serverId)) this.#addRecovery(serverId, "issue:journal-scan");
    }
    const storedById = new Map(stored.map((record) => [record.operation.id, record.operation]));
    for (const record of transactionScan?.records ?? []) {
      if (!(record.intent.restore || record.intent.worldChange || record.intent.worldImport || record.intent.worldLibraryImport || record.intent.worldActivation || record.intent.worldReplacement || record.intent.worldArchive || record.intent.propertiesWrite || record.intent.addonInstall || record.intent.addonLifecycle) || !["committed", "rolled-back"].includes(record.state)) continue;
      const outcome = storedById.get(record.intent.operationId);
      const established = outcome?.state === "succeeded" || (outcome?.state === "failed" && outcome.step === "rolled-back" && !outcome.error) ||
        (record.intent.addonInstall && record.state === "rolled-back" && outcome?.state === "failed" && outcome.error?.code === "ADDON_INSTALL_NOT_APPLIED") ||
        (record.intent.addonLifecycle && record.state === "rolled-back" && outcome?.state === "failed" && outcome.error?.code === "ADDON_LIFECYCLE_NOT_APPLIED");
      if ((!established || record.intent.worldLibraryImport || record.intent.worldActivation) && !this.#verifiedTerminalOperations.has(record.intent.operationId)) this.requireTransactionRecovery(record.intent.serverId, record.intent.operationId);
    }
    for (const record of stored) {
      check();
      let current = record;
      if (record.worldGenerationExecution) {
        // A persisted execution receipt consumes the attempt even if the
        // catalog marker was never published. Never infer permission to resend.
        this.#verifiedTerminalOperations.delete(record.operation.id);
        this.#addRecovery(record.operation.serverId, `generation-unverified:${record.operation.id}`);
        this.requireTransactionRecovery(record.operation.serverId, record.operation.id);
      }
      // A command receipt is not a world transaction. Until a dedicated controller
      // verifies its outcome, even a saved success must remain fail-closed on restart.
      if (record.operation.kind === "whitelist-change") this.#addRecovery(record.operation.serverId, `operation:${record.operation.id}`);
      // Schema12 is readable for inspection, not physically verifiable yet.
      // Generic rollback/activation confirmation cannot clear this reserved cause.
      if (record.operation.kind === "world-replace") {
        this.#verifiedTerminalOperations.delete(record.operation.id);
        this.#addRecovery(record.operation.serverId, `replacement-unverified:${record.operation.id}`);
      }
      const terminal = transactionScan?.records.find((item) => (item.intent.operationId === record.operation.id ||
        (item.intent.worldImport && item.checkpoints.some((c) => c.name === "import-recovery-operation" && c.details?.resourceId === record.operation.id))) &&
        ["committed", "rolled-back"].includes(item.state));
      const established = record.operation.state === "succeeded" || (record.operation.state === "failed" && record.operation.step === "rolled-back" && !record.operation.error) ||
        (terminal?.intent.addonInstall && terminal.state === "rolled-back" && record.operation.state === "failed" && record.operation.error?.code === "ADDON_INSTALL_NOT_APPLIED") ||
        (terminal?.intent.addonLifecycle && terminal.state === "rolled-back" && record.operation.state === "failed" && record.operation.error?.code === "ADDON_LIFECYCLE_NOT_APPLIED");
      const transactionBearing = Boolean(terminal?.intent.restore || terminal?.intent.worldChange || terminal?.intent.worldImport || terminal?.intent.worldLibraryImport || terminal?.intent.worldActivation || terminal?.intent.worldReplacement || terminal?.intent.worldArchive || terminal?.intent.propertiesWrite || terminal?.intent.addonInstall || terminal?.intent.addonLifecycle);
      const unverified = Boolean(this.#recoveryCauses.get(record.operation.serverId)?.has(`generation-unverified:${record.operation.id}`) || record.operation.kind === "world-replace" || terminal?.intent.worldReplacement || ((transactionBearing && (!established || terminal?.intent.worldLibraryImport || terminal?.intent.worldActivation)) ||
        record.operation.kind === "world-library-import" || record.operation.kind === "world-activate") && !this.#verifiedTerminalOperations.has(record.operation.id));
      if (["world-library-import", "world-activate"].includes(record.operation.kind) && unverified) this.#addRecovery(record.operation.serverId, `operation:${record.operation.id}`);
      const addonNotApplied = Boolean(terminal?.intent.addonInstall && terminal.state === "rolled-back" && this.#verifiedTerminalOperations.has(record.operation.id));
      const addonLifecycleNotApplied = Boolean(terminal?.intent.addonLifecycle && terminal.state === "rolled-back" && this.#verifiedTerminalOperations.has(record.operation.id));
      const unsafeCompletion = unverified || Boolean(terminal && this.#recoveryCauses.get(record.operation.serverId)?.has(`operation:${record.operation.id}`));
      if (unverified) this.requireTransactionRecovery(record.operation.serverId, record.operation.id);
      const verifiedWorldId = !unsafeCompletion && terminal?.state === "committed" ? terminal.intent.worldActivation?.worldId ?? terminal.intent.worldLibraryImport?.worldId : undefined;
      // Generation CAS/completion bind the original receipts. Restart status
      // stays fail-closed through causes/get(), never by rewriting that evidence.
      const immutableGeneration = Boolean(record.worldLifecycle) || validGenerationExecutionReceipt(record) || Boolean(terminal?.schemaVersion === 14 &&
        terminal.intent.worldChange?.generation && terminal.intent.kind === "world-create" && record.operation.kind === "world-create" &&
        terminal.intent.serverId === record.operation.serverId && terminal.intent.operationId === record.operation.id);
      if (!immutableGeneration && (unsafeCompletion || record.operation.state === "queued" || record.operation.state === "running" || (record.operation.state === "interrupted" && terminal) ||
          (verifiedWorldId && record.operation.result?.resourceId !== verifiedWorldId))) {
        const interrupted: Operation = {
          ...record.operation,
          state: record.operation.kind === "world-library-import" && record.operation.state === "failed" ? "failed" : unsafeCompletion ? "interrupted" : (addonNotApplied || addonLifecycleNotApplied) ? "failed" : terminal ? (terminal.state === "committed" || record.operation.kind === "world-import-recovery" ? "succeeded" : "failed") : "interrupted",
          step: unsafeCompletion ? "physical-recovery-required" : (addonNotApplied || addonLifecycleNotApplied) ? "failed" : terminal ? terminal.state : "manager-restarted",
          updatedAt: now.toISOString(),
          result: terminal?.intent.restore ? { resourceId: terminal.intent.restore.guardBackupId, rollbackAvailable: terminal.state === "committed" && terminal.intent.kind === "restore" } :
            terminal?.intent.addonLifecycle && terminal.state === "committed" ? {
              resourceId: terminal.intent.addonLifecycle.action === "trash" ? terminal.intent.addonLifecycle.trashId : terminal.intent.addonLifecycle.addonId,
              rollbackAvailable: false, restartRequired: true
            } : verifiedWorldId ? { resourceId: verifiedWorldId, rollbackAvailable: false } : record.operation.result,
          error: addonNotApplied ? { code: "ADDON_INSTALL_NOT_APPLIED", message: "安装未应用；原上传、保护备份和临时证据已保留" } :
            addonLifecycleNotApplied ? { code: "ADDON_LIFECYCLE_NOT_APPLIED", message: "扩展状态变更未应用；源文件与保护证据仍保留" } : terminal && !unsafeCompletion ? null : record.operation.kind === "backup-export"
            ? { code: "EXPORT_INTERRUPTED", message: "导出被管理器重启中断，可重新请求" }
            : { code: "RECOVERY_REQUIRED", message: "管理器重启中断了操作，需要人工检查" }
        };
        current = { ...record, operation: interrupted };
        check(); await this.#store.save(current); check();
        if (!terminal && interrupted.kind !== "backup-export") this.#addRecovery(interrupted.serverId, `operation:${interrupted.id}`);
      }
      if (
        current.operation.state === "interrupted" &&
        current.operation.error?.code === "RECOVERY_REQUIRED"
      ) {
        if (!terminal) this.#addRecovery(current.operation.serverId, `operation:${current.operation.id}`);
      }
      this.#records.set(current.operation.id, current);
      // Uncertain world switches must never become fresh commands when an old
      // browser session rechecks its original request after the normal window.
      if (["whitelist-change", "world-activate", "world-replace"].includes(current.operation.kind) || current.worldGenerationExecution || current.worldLifecycle || Date.parse(current.expiresAt) > now.getTime()) {
        this.#idempotency.set(this.#idempotencyScope(current), current);
      }
    }
    check(); this.#generationStartupScan = transactionScan && structuredClone(transactionScan);
  }

  /** Synchronous classification only, using a completed initialization scan.
   * No physical confirmation, cause deletion or lifecycle permission. */
  requireStartupWorldRecovery(serverIds: Iterable<string>, lookup: (serverId: string) => ProtectedGenerationRecovery | null): void {
    for (const serverId of serverIds) {
      try {
        const scan = this.#generationStartupScan, protection = structuredClone(lookup(serverId));
        const records = scan?.records.filter(record => record.intent.serverId === serverId) ?? [], parent = records[0], g = parent?.intent.worldChange?.generation;
        if (!scan || scan.issues.some(issue => !issue.serverId || issue.serverId === serverId) || scan.recoveryServerIds.has(serverId) ||
            records.length !== 1 || !parent || parent.schemaVersion !== 14 || parent.state !== "committed" || !g || !protection ||
            Object.keys(protection).length !== 8 || Object.keys(protection).some(key =>
              !["kind", "serverId", "levelName", "worldId", "slotChecksum", "slotIdentity", "propertiesChecksum", "propertiesIdentity"].includes(key)) ||
            protection.kind !== "protected-pending-generation" || protection.serverId !== serverId || protection.levelName !== g.nextName ||
            protection.worldId !== worldIdentity(serverId, g.nextName) ||
            [protection.slotChecksum, protection.slotIdentity, protection.propertiesChecksum, protection.propertiesIdentity].some(value => typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value))) throw new Error("Unknown startup state");
        const executionRecords = [...this.#records.values()].filter(record => record.worldGenerationExecution?.serverId === serverId &&
          (record.worldGenerationExecution.preparationOperationId === parent.intent.operationId ||
            record.worldGenerationExecution.preparationTransactionId === parent.transactionId || record.worldGenerationExecution.worldId === g.worldId));
        const execution = executionRecords[0], value = execution?.worldGenerationExecution, receipt = this.#records.get(parent.intent.operationId);
        if (executionRecords.length !== 1 || !execution || !validGenerationExecutionReceipt(execution) || !value ||
            value.preparationOperationId !== parent.intent.operationId || value.preparationTransactionId !== parent.transactionId || value.worldId !== g.worldId ||
            value.preparedRecordDigest !== createHash("sha256").update(JSON.stringify(parent)).digest("hex") ||
            !["succeeded", "interrupted"].includes(execution.operation.state) || !receipt || receipt.operation.serverId !== serverId ||
            receipt.operation.kind !== "world-create" || receipt.worldGenerationExecution || !["succeeded", "interrupted"].includes(receipt.operation.state) ||
            receipt.operation.result?.resourceId !== g.guardBackupId || receipt.operation.result.rollbackAvailable) throw new Error("Unknown generation owner");
        const parentId = parent.intent.operationId, executionId = execution.operation.id;
        const allowed = new Set([parentId, executionId].flatMap(id => [`generation-unverified:${id}`, `operation:${id}`, `journal:${id}`]));
        allowed.add(`generation-slot:${parentId}`);
        const causes = this.#recoveryCauses.get(serverId);
        if (!causes?.has(`generation-unverified:${parentId}`) || !causes.has(`generation-unverified:${executionId}`) ||
            [...causes].some(cause => !allowed.has(cause))) throw new Error("Unrelated recovery cause");
        this.#generationSlots.set(serverId, { parentId, executionId, protection });
        this.#addRecovery(serverId, `generation-slot:${parentId}`);
      } catch { this.#generationSlots.delete(serverId); this.#addRecovery(serverId, "external"); }
    }
  }

  get(operationId: string): Operation | undefined {
    const record = this.#records.get(operationId);
    if (!record) return undefined;
    const operation = structuredClone(record.operation);
    if ((["whitelist-change", "world-replace", "world-library-import"].includes(operation.kind) && this.#recoveryCauses.get(operation.serverId)?.has(`operation:${operationId}`)) ||
        this.#recoveryCauses.get(operation.serverId)?.has(`generation-unverified:${operationId}`) ||
        this.#recoveryCauses.get(operation.serverId)?.has(`world-lifecycle-unverified:${operationId}`)) {
      return { ...operation, state: "interrupted", step: "recovery-required", error: { code: "RECOVERY_REQUIRED", message: operation.kind === "whitelist-change" ? "白名单结果需要独立核验" : "世界操作结果需要独立核验" } };
    }
    return operation;
  }

  getServerState(serverId: string): OperationServerState {
    return {
      activeOperationId: this.#activeByServer.get(serverId) ?? null,
      recoveryRequired: this.#recoveryServers.has(serverId)
    };
  }

  requireRecovery(serverIds: Iterable<string>): void {
    for (const serverId of serverIds) this.#addRecovery(serverId, "external");
  }

  requireTransactionRecovery(serverId: string, operationId: string): void {
    this.#addRecovery(serverId, `operation:${operationId}`);
  }
  matchesWhitelistBinding(serverId: string, operationId: string, requestBody: string, keyHash: string): boolean {
    const record = this.#records.get(operationId);
    return Boolean(record && record.operation.kind === "whitelist-change" && record.operation.serverId === serverId &&
      record.requestFingerprint === createHash("sha256").update(`${serverId}\nwhitelist-change\n${requestBody}`).digest("hex") &&
      createHash("sha256").update(record.idempotencyKey.toLowerCase()).digest("hex") === keyHash);
  }

  /** Dedicated backend verifier only; never accept verification or admission from HTTP input.
   * Read-only startup inspection cannot change an interrupted result. Explicit recovery
   * may settle only a receipt that the command controller can independently prove. */
  async verifyWhitelistOutcome(serverId: string, operationId: string, verify: () => Promise<void>,
    admission: OperationAdmission, explicitRecovery = false): Promise<Operation> {
    await this.#mutate(async () => {
      admission();
      const op = this.#records.get(operationId)?.operation;
      if (!op || op.serverId !== serverId || op.kind !== "whitelist-change" ||
        (!explicitRecovery && op.state !== "succeeded") || this.#activeByServer.has(serverId) || this.#exclusiveLocks.has(serverId)) {
        throw new DomainError(409, "RECOVERY_REQUIRED", "白名单操作尚不能安全确认", "whitelist-outcome-unavailable");
      }
      if (explicitRecovery && (!this.#recoveryCauses.get(serverId)?.has(`operation:${operationId}`) || !["interrupted", "succeeded"].includes(op.state))) {
        throw new DomainError(409, "RECOVERY_REQUIRED", "白名单操作不属于当前恢复原因", "whitelist-recovery-owner-invalid");
      }
      if (explicitRecovery && [...(this.#recoveryCauses.get(serverId) ?? [])].some((cause) => cause !== `operation:${operationId}`)) {
        throw new DomainError(409, "RECOVERY_REQUIRED", "实例仍有其他恢复原因", "unrelated-recovery");
      }
      this.#exclusiveLocks.add(serverId);
    });
    try {
      await verify();
      return await this.#mutate(async () => {
        admission(); const current = this.#records.get(operationId)!;
        if (explicitRecovery && [...(this.#recoveryCauses.get(serverId) ?? [])].some((cause) => cause !== `operation:${operationId}`)) {
          throw new DomainError(409, "RECOVERY_REQUIRED", "实例新增了其他恢复原因", "unrelated-recovery");
        }
        if (!explicitRecovery && current.operation.state !== "succeeded") throw new DomainError(409, "RECOVERY_REQUIRED", "结果仍不确定");
        let outcome = current.operation;
        if (explicitRecovery) {
          outcome = { ...outcome, state: "succeeded", step: "whitelist-verified-recovery", updatedAt: this.#clock.now().toISOString(),
            error: null, result: { resourceId: operationId, rollbackAvailable: false } };
          const record = { ...current, operation: outcome }; await this.#store.save(record);
          this.#records.set(operationId, record); this.#idempotency.set(this.#idempotencyScope(record), record); this.#emit(outcome);
        }
        const causes = this.#recoveryCauses.get(serverId); causes?.delete(`operation:${operationId}`);
        if (!causes?.size) this.#recoveryServers.delete(serverId);
        return structuredClone(outcome);
      });
    } finally { await this.#mutate(async () => { this.#exclusiveLocks.delete(serverId); }); }
  }

  async storedOutcomes(): Promise<Operation[]> {
    await this.#store.initialize();
    return (await this.#store.list()).map((record) => record.operation);
  }

  confirmPhysicalTransaction(operationId: string): void {
    if ([...this.#recoveryCauses.values()].some(causes => causes.has(`generation-unverified:${operationId}`))) {
      throw new DomainError(409, "RECOVERY_REQUIRED", "Generation requires birth verification", "generation-verifier-unavailable", true);
    }
    if (this.#records.get(operationId)?.operation.kind === "world-replace" ||
        [...this.#recoveryCauses.values()].some(causes => causes.has(`replacement-unverified:${operationId}`))) {
      throw new DomainError(409, "RECOVERY_REQUIRED", "Replacement physical verification is unavailable", "replacement-verifier-unavailable", true);
    }
    this.#verifiedTerminalOperations.add(operationId);
  }

  /** Trusted replacement executor only. Keep the live instance closed until a
   * dedicated physical recovery coordinator is implemented and independently
   * accepted; success of a filesystem transaction alone must not clear it. */
  retainReplacementInspection(serverId: string, operationId: string): void {
    const operation = this.#records.get(operationId)?.operation;
    if (!operation || operation.serverId !== serverId || operation.kind !== "world-replace") throw new Error("Replacement owner mismatch");
    this.#verifiedTerminalOperations.delete(operationId);
    this.#addRecovery(serverId, `replacement-unverified:${operationId}`);
  }

  /** Trusted schema14 preparation only; no generic completion clears this cause. */
  retainGenerationInspection(serverId: string, operationId: string): void {
    const operation = this.#records.get(operationId)?.operation;
    if (!operation || operation.serverId !== serverId || operation.kind !== "world-create") throw new Error("Generation owner mismatch");
    this.#verifiedTerminalOperations.delete(operationId);
    this.#addRecovery(serverId, `generation-unverified:${operationId}`);
    this.requireTransactionRecovery(serverId, operationId);
  }

  /** Unmounted dedicated recovery boundary. Instance lease is acquired first;
   * withProof must retain the upload lease across consume, receipt persistence
   * and final physical verification. Startup inspection cannot settle an
   * interrupted receipt; only an explicitly authorized recovery may do that.
   * Generic transaction confirmation/recovery remains forbidden for replacement.
   */
  async verifyReplacementOutcome(serverId: string, operationId: string,
    withProof: (consume: (proof: ReplacementOutcomeProof) => Promise<void>) => Promise<void>,
    admission: OperationAdmission, explicitRecovery = false): Promise<Operation> {
    const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Replacement outcome requires inspection", "replacement-outcome-unverified", true);
    const ownCauses = new Set([`replacement-unverified:${operationId}`, `operation:${operationId}`, `journal:${operationId}`]);
    const assertCauses = () => {
      if ([...(this.#recoveryCauses.get(serverId) ?? [])].some(cause => !ownCauses.has(cause))) throw fail();
    };
    const before = await this.#mutate(async () => {
      // Acquire only an observation lease here. Import causes are allowed ONLY
      // after the closed physical-proof set is checked against a fresh journal.
      admission(); this.assertRegistered(serverId);
      const current = this.#records.get(operationId);
      if (!current || current.operation.serverId !== serverId || current.operation.kind !== "world-replace" ||
          this.#activeByServer.has(serverId) || this.#exclusiveLocks.has(serverId) ||
          (!explicitRecovery && current.operation.state !== "succeeded") ||
          (explicitRecovery && !["interrupted", "succeeded"].includes(current.operation.state))) throw fail();
      this.#exclusiveLocks.add(serverId);
      this.#addRecovery(serverId, `operation:${operationId}`);
      return structuredClone(current);
    });
    let consumed = false, active = true, settled: Operation | undefined, inFlight: Promise<void> | undefined;
    const affected = new Set([operationId]), settledImports: Operation[] = [];
    const assertReceipts = (expected: ReadonlyMap<string, StoredOperation>) => {
      for (const [id, value] of expected) if (JSON.stringify(this.#records.get(id)) !== JSON.stringify(value)) throw fail();
    };
    const assertActive = () => { if (!active) throw fail(); };
    try {
      const consumeUnderLease = async (proof: ReplacementOutcomeProof) => {
        assertActive();
        if (consumed) throw fail(); consumed = true;
        if (proof.serverId !== serverId || proof.operationId !== operationId || proof.phase !== "current-state" ||
            !/^[0-9a-f]{64}$/u.test(proof.catalogRevision) || typeof proof.recheck !== "function") throw fail();
        const imports = structuredClone(proof.verifiedImports ?? []);
        if (!Array.isArray(imports) || imports.length > 1000 ||
            ["operationId", "transactionId", "worldId"].some(key => new Set(imports.map(item => item[key as keyof typeof item])).size !== imports.length)) throw fail();
        const verifyJournal = async () => {
          assertActive();
          const scan = await this.transactionRecovery?.initialize();
          assertActive();
          const scoped = scan?.records.filter(record => record.intent.serverId === serverId) ?? [];
          const owner = scoped.filter(record => record.intent.operationId === operationId);
          if (!scan || scan.issues.some(issue => !issue.serverId || issue.serverId === serverId) || scan.recoveryServerIds.has(serverId) ||
              owner.length !== 1 || owner[0]!.schemaVersion !== 13 || owner[0]!.state !== "committed" || owner[0]!.transactionId !== proof.transactionId ||
              owner[0]!.intent.worldReplacement?.worldId !== proof.worldId ||
              createHash("sha256").update(JSON.stringify(owner[0])).digest("hex") !== proof.recordDigest ||
              createHash("sha256").update(JSON.stringify(scoped)).digest("hex") !== proof.journalDigest) throw fail();
          const births = scoped.filter(record => record.intent.worldLibraryImport);
          if (births.length !== imports.length || imports.some(item => !item || typeof item !== "object" ||
              !births.some(record => record.schemaVersion === 9 && record.state === "committed" && record.intent.kind === "world-library-import" &&
                record.intent.operationId === item.operationId && record.transactionId === item.transactionId &&
                record.intent.worldLibraryImport!.worldId === item.worldId &&
                createHash("sha256").update(JSON.stringify(record)).digest("hex") === item.recordDigest))) throw fail();
        };
        await proof.recheck(); await verifyJournal();
        const expected = await this.#mutate(async () => {
          assertActive();
          admission();
          const current = this.#records.get(operationId);
          if (!current || JSON.stringify(current) !== JSON.stringify(before)) throw fail();
          await verifyJournal();
          assertActive();
          const group = new Map<string, { record: StoredOperation; worldId: string }>([[operationId, { record: structuredClone(current), worldId: proof.worldId }]]);
          for (const item of imports) {
            const record = this.#records.get(item.operationId);
            if (!record || record.operation.serverId !== serverId || record.operation.kind !== "world-library-import" || group.has(item.operationId)) throw fail();
            group.set(item.operationId, { record: structuredClone(record), worldId: item.worldId });
          }
          // Validate EVERY receipt before the first write or confirmation mark.
          for (const { record, worldId } of group.values()) {
            const operation = record.operation;
            if (operation.serverId !== serverId || !["succeeded", ...(explicitRecovery ? ["interrupted"] : [])].includes(operation.state) ||
                operation.state === "succeeded" && operation.result?.resourceId !== worldId ||
                operation.result?.resourceId !== undefined && operation.result.resourceId !== worldId) throw fail();
          }
          for (const id of group.keys()) {
            affected.add(id); ownCauses.add(`operation:${id}`); ownCauses.add(`journal:${id}`);
          }
          assertCauses();
          for (const id of affected) { this.#addRecovery(serverId, `operation:${id}`); this.#verifiedTerminalOperations.delete(id); }
          const expected = new Map([...group].map(([id, value]) => [id, structuredClone(value.record)]));
          for (const [id, { record, worldId }] of group) {
            assertActive(); admission(); assertCauses(); assertReceipts(expected);
            if (!explicitRecovery || id !== operationId && record.operation.state === "succeeded") continue;
            const operation: Operation = { ...record.operation, state: "succeeded",
              step: id === operationId ? "replacement-verified-recovery" : "replacement-import-verified-recovery",
              updatedAt: this.#clock.now().toISOString(), error: null, result: { resourceId: worldId, rollbackAvailable: false } };
            const saved = { ...record, operation }; await this.#store.save(saved);
            assertActive(); admission(); assertReceipts(expected);
            this.#records.set(id, saved);
            const scope = this.#idempotencyScope(saved);
            // An expired historical import must not replace a newer same-key map.
            if (this.#idempotency.get(scope)?.operation.id === id) this.#idempotency.set(scope, saved);
            expected.set(id, structuredClone(saved));
            if (id !== operationId) settledImports.push(operation);
          }
          return expected;
        });
        // Receipt persistence is not enough: retain all gates until the last
        // awaited current-state and journal proof succeeds under both leases.
        await proof.recheck(); await verifyJournal();
        await this.#mutate(async () => {
          assertActive();
          admission(); this.assertRegistered(serverId); assertCauses();
          assertReceipts(expected);
          await verifyJournal(); assertActive(); assertCauses(); admission();
          assertReceipts(expected);
          for (const id of affected) this.#verifiedTerminalOperations.add(id);
          const causes = this.#recoveryCauses.get(serverId);
          for (const cause of ownCauses) causes?.delete(cause);
          if (!causes?.size) this.#recoveryServers.delete(serverId);
          settled = structuredClone(expected.get(operationId)!.operation);
        });
      };
      await withProof(proof => {
        if (!active || inFlight) return Promise.reject(fail());
        const task = consumeUnderLease(proof); inFlight = task;
        // The owner still drains even a callback that incorrectly detaches it.
        void task.catch(() => {}); return task;
      });
      active = false;
      if (!consumed || !settled) throw fail();
      for (const operation of settledImports) this.#emit(operation);
      this.#emit(settled); return settled;
    } catch {
      active = false;
      this.#addRecovery(serverId, `replacement-unverified:${operationId}`);
      for (const id of affected) {
        this.#verifiedTerminalOperations.delete(id); this.#addRecovery(serverId, `operation:${id}`);
        const uncertain = this.get(id); if (uncertain) this.#emit(uncertain);
      }
      throw fail();
    } finally {
      active = false;
      await inFlight?.catch(() => {});
      await this.#mutate(async () => { this.#exclusiveLocks.delete(serverId); });
    }
  }

  #addRecovery(serverId: string, cause: string): void {
    const causes = this.#recoveryCauses.get(serverId) ?? new Set<string>();
    causes.add(cause); this.#recoveryCauses.set(serverId, causes); this.#recoveryServers.add(serverId);
  }

  async assertRecoveryOwner(serverId: string, parentOperationId: string): Promise<void> {
    const scan = await this.transactionRecovery?.initialize();
    const parent = scan?.records.find((r) => r.intent.serverId === serverId && r.intent.operationId === parentOperationId && r.intent.kind === "restore" && r.intent.restore);
    if (!parent || parent.state === "rolled-back" || scan!.issues.some((i) => i.serverId === serverId)) throw new DomainError(409, "RECOVERY_REQUIRED", "该事务不能安全恢复", "recovery-owner-invalid");
    const owned = scan!.records.filter((r) => r.transactionId === parent.transactionId || r.intent.restore?.parentTransactionId === parent.transactionId);
    const allowed = new Set(owned.flatMap((r) => [`journal:${r.intent.operationId}`, `operation:${r.intent.operationId}`]));
    if ([...(this.#recoveryCauses.get(serverId) ?? [])].some((cause) => !allowed.has(cause)) ||
      scan!.records.some((r) => r.intent.serverId === serverId && ["active", "recovery-required"].includes(r.state) && !owned.includes(r))) {
      throw new DomainError(409, "RECOVERY_REQUIRED", "实例还有其他未解决的恢复原因", "unrelated-recovery");
    }
  }

  async resolveOwnedRecovery(serverId: string, operationIds: readonly string[]): Promise<void> {
    const scan = await this.transactionRecovery?.initialize();
    if (!scan || scan.issues.some((i) => i.serverId === serverId) || scan.records.some((r) => r.intent.serverId === serverId && ["active", "recovery-required"].includes(r.state))) {
      throw new DomainError(409, "RECOVERY_REQUIRED", "仍有未解决的事务", "recovery-remains", true);
    }
    const causes = this.#recoveryCauses.get(serverId);
    if (operationIds.some(id => causes?.has(`generation-unverified:${id}`)) ||
        scan.records.some(record => record.intent.serverId === serverId && record.intent.worldChange?.generation && operationIds.includes(record.intent.operationId))) {
      throw new DomainError(409, "RECOVERY_REQUIRED", "Generation requires birth verification", "generation-verifier-unavailable", true);
    }
    if (operationIds.some(id => this.#records.get(id)?.operation.kind === "world-replace" || causes?.has(`replacement-unverified:${id}`)) ||
        scan.records.some(record => record.intent.serverId === serverId && record.intent.worldReplacement && operationIds.includes(record.intent.operationId))) {
      throw new DomainError(409, "RECOVERY_REQUIRED", "Replacement requires a dedicated physical verifier", "replacement-verifier-unavailable", true);
    }
    for (const id of operationIds) {
      causes?.delete(`journal:${id}`); causes?.delete(`operation:${id}`);
      const op = this.#records.get(id)?.operation;
      if (op?.state === "interrupted") await this.#update(id, { state: "failed", step: "rolled-back", error: null, result: { resourceId: op.result?.resourceId ?? null, rollbackAvailable: false } });
      else if (op?.result?.rollbackAvailable && op.state !== "running") await this.#update(id, { result: { ...op.result, rollbackAvailable: false } });
    }
    if (!causes?.size) this.#recoveryServers.delete(serverId);
  }

  async assertImportRecoveryOwner(serverId: string, operationId: string): Promise<void> {
    const scan = await this.transactionRecovery?.initialize();
    const parent = scan?.records.find((r) => r.intent.serverId === serverId && r.intent.operationId === operationId && r.intent.worldImport);
    const recoveryIds = parent?.checkpoints.filter((c) => c.name === "import-recovery-operation").map((c) => c.details?.resourceId).filter((id): id is string => Boolean(id)) ?? [];
    const allowed = new Set([operationId,...recoveryIds].flatMap((id) => [`journal:${id}`, `operation:${id}`]));
    if (!parent || !["active","recovery-required"].includes(parent.state) || scan!.issues.some((i) => i.serverId === serverId) ||
      [...(this.#recoveryCauses.get(serverId) ?? [])].some((cause) => !allowed.has(cause)) ||
      scan!.records.some((r) => r.intent.serverId === serverId && ["active","recovery-required"].includes(r.state) && r !== parent)) {
      throw new DomainError(409,"RECOVERY_REQUIRED","该导入事务不能安全恢复","import-recovery-owner-invalid");
    }
  }

  async runExclusive<T>(serverId: string, action: () => Promise<T>, registrationRemoval = false): Promise<T> {
    await this.#mutate(async () => {
      if (!registrationRemoval) this.assertRegistered(serverId);
      if (this.#recoveryServers.has(serverId)) {
        throw new DomainError(409, "RECOVERY_REQUIRED", "实例需要人工恢复检查", "recovery-required");
      }
      if (this.#activeByServer.has(serverId) || this.#exclusiveLocks.has(serverId)) {
        throw new DomainError(409, "OPERATION_CONFLICT", "实例当前已有活动操作", "operation-active");
      }
      this.#exclusiveLocks.add(serverId);
    });
    try { return await action(); }
    finally {
      await this.#mutate(async () => { this.#exclusiveLocks.delete(serverId); });
    }
  }

  async runReadAdmission<T>(serverId: string, action: () => Promise<T>): Promise<T> {
    await this.#mutate(async () => {
      this.assertRegistered(serverId);
      if (this.#recoveryServers.has(serverId)) throw new DomainError(409, "RECOVERY_REQUIRED", "实例需要人工恢复检查", "recovery-required");
      if (this.#activeByServer.has(serverId) || this.#exclusiveLocks.has(serverId)) {
        throw new DomainError(409, "OPERATION_CONFLICT", "实例当前已有活动操作", "operation-active");
      }
      this.#exclusiveLocks.add(serverId);
    });
    try { return await action(); }
    finally {
      await this.#mutate(async () => { this.#exclusiveLocks.delete(serverId); });
    }
  }

  /** Backend-only read inspection under the existing instance lease. Never
   * settles receipts, removes recovery causes or grants lifecycle permission. */
  async runGenerationInspection<T>(serverId: string, executionId: string,
    action: (protection?: ProtectedGenerationRecovery) => Promise<T>, admission: OperationAdmission): Promise<T> {
    if (typeof action !== "function") throw new DomainError(409, "RECOVERY_REQUIRED", "Generation inspection requires a verifier", "generation-inspection-unverified", true);
    return this.runGenerationLease(serverId, executionId, protection => action(protection), admission);
  }

  /** Dedicated backend slot writer only. This lease does not settle or unlock. */
  async runGenerationSlotCommit<T>(serverId: string, executionId: string,
    action: (protection: ProtectedGenerationRecovery | undefined, assertLease: OperationAdmission) => Promise<T>,
    admission: OperationAdmission): Promise<T> {
    return this.runGenerationLease(serverId, executionId, action, admission);
  }

  /** Records the first launch intent without releasing any generation gate. */
  async stageFirstManagedWorldStart(serverId: string, executionId: string,
    prepare: (assertLease: OperationAdmission) => Promise<FirstManagedStartPlan>, admission: OperationAdmission): Promise<Operation> {
    const plan = await this.runGenerationLease(serverId, executionId, (_protection, assertLease) => prepare(assertLease), admission, true);
    return this.get(plan.record.operation.id)!;
  }

  private async runGenerationLease<T>(serverId: string, executionId: string,
    action: (protection: ProtectedGenerationRecovery | undefined, assertLease: OperationAdmission) => Promise<T>,
    admission: OperationAdmission, stageStart = false): Promise<T> {
    const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Generation inspection requires matching evidence", "generation-inspection-unverified", true);
    const authorize = () => {
      if (typeof admission !== "function" || typeof action !== "function") throw fail();
      const result: unknown = admission();
      if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw fail(); }
      this.assertRegistered(serverId);
    };
    const snapshot = await this.#mutate(async () => {
      authorize();
      const record = this.#records.get(executionId);
      if (!record || !validGenerationExecutionReceipt(record) || record.operation.serverId !== serverId ||
          !["succeeded", "interrupted"].includes(record.operation.state)) throw fail();
      const execution = readGenerationExecution(record.worldGenerationExecution), parent = this.#records.get(execution.preparationOperationId);
      if (!parent || parent.operation.serverId !== serverId || parent.operation.kind !== "world-create" ||
          parent.worldGenerationExecution || !["succeeded", "interrupted"].includes(parent.operation.state)) throw fail();
      if (this.#activeByServer.has(serverId) || this.#exclusiveLocks.has(serverId)) {
        throw new DomainError(409, "OPERATION_CONFLICT", "Instance inspection is already active", "operation-active");
      }
      const allowed = new Set([executionId, execution.preparationOperationId].flatMap(id =>
        [`generation-unverified:${id}`, `operation:${id}`, `journal:${id}`]));
      const slot = structuredClone(this.#generationSlots.get(serverId));
      if (slot) {
        if (slot.parentId !== execution.preparationOperationId || slot.executionId !== executionId) throw fail();
        allowed.add(`generation-slot:${slot.parentId}`);
      }
      const causes = [...(this.#recoveryCauses.get(serverId) ?? [])].sort();
      if (!causes.includes(`generation-unverified:${execution.preparationOperationId}`) || causes.some(cause => !allowed.has(cause))) throw fail();
      const records = [parent, record].map(value => structuredClone(value));
      this.#exclusiveLocks.add(serverId);
      return { execution, records, causes, slot };
    });
    let leaseOpen = true;
    const assertCurrent = (): undefined => {
      authorize();
      if (!leaseOpen || !this.#exclusiveLocks.has(serverId) || this.#activeByServer.has(serverId) ||
          JSON.stringify([...(this.#recoveryCauses.get(serverId) ?? [])].sort()) !== JSON.stringify(snapshot.causes) ||
          JSON.stringify(this.#generationSlots.get(serverId)) !== JSON.stringify(snapshot.slot) ||
          snapshot.records.some(record => JSON.stringify(this.#records.get(record.operation.id)) !== JSON.stringify(record))) throw fail();
    };
    const verifyPersistent = async () => {
      assertCurrent();
      const stored = await this.#store.list(); assertCurrent();
      if (stored.some(record => record.operation.serverId === serverId && record.worldGenerationExecution !== undefined &&
          !validGenerationExecutionReceipt(record))) throw fail();
      const scoped = stored.filter(record => snapshot.records.some(owner => owner.operation.id === record.operation.id) ||
        record.worldGenerationExecution?.serverId === serverId &&
        (record.worldGenerationExecution.preparationOperationId === snapshot.execution.preparationOperationId ||
          record.worldGenerationExecution.preparationTransactionId === snapshot.execution.preparationTransactionId ||
          record.worldGenerationExecution.worldId === snapshot.execution.worldId));
      if (scoped.length !== 2 || snapshot.records.some(record =>
        JSON.stringify(scoped.find(value => value.operation.id === record.operation.id)) !== JSON.stringify(record))) throw fail();
      const scan = await this.transactionRecovery?.initialize(); assertCurrent();
      const records = scan?.records.filter(record => record.intent.serverId === serverId) ?? [], parent = records[0];
      if (!scan || scan.issues.some(issue => !issue.serverId || issue.serverId === serverId) || scan.recoveryServerIds.has(serverId) ||
          records.length !== 1 || !parent || parent.schemaVersion !== 14 || parent.state !== "committed" ||
          parent.transactionId !== snapshot.execution.preparationTransactionId || parent.intent.operationId !== snapshot.execution.preparationOperationId ||
          parent.intent.worldChange?.generation?.worldId !== snapshot.execution.worldId ||
          createHash("sha256").update(JSON.stringify(parent)).digest("hex") !== snapshot.execution.preparedRecordDigest) throw fail();
    };
    let launch: { record: StoredOperation; dispatch: OwnedWorldStartDispatch; signal: AbortSignal } | undefined;
    try {
      await verifyPersistent(); assertCurrent();
      const result = await action(snapshot.slot && structuredClone(snapshot.slot.protection), assertCurrent); assertCurrent();
      await verifyPersistent();
      await this.#mutate(async () => {
        assertCurrent();
        if (!stageStart) return;
        const plan = result as FirstManagedStartPlan;
        const record = structuredClone(plan.record);
        const { operation, worldLifecycle: start } = record;
        if (!validWorldLifecycleReceipt(record) || start?.action !== "start" || start.launchId !== null ||
            start.serverId !== serverId || start.worldId !== snapshot.execution.worldId ||
            start.registeredExecutionDigest !== snapshot.execution.registeredExecutionDigest ||
            operation.state !== "queued" || operation.result !== null || operation.error !== null ||
            !this.#store.create || !this.#store.read || this.#records.has(operation.id)) throw fail();
        const existing = (await this.#store.list()).some(previous => previous.operation.serverId === serverId &&
          (previous.worldLifecycle !== undefined || previous.operation.kind === "start" &&
            previous.idempotencyKey.toLowerCase() === record.idempotencyKey.toLowerCase()));
        assertCurrent();
        if (existing) throw fail();
        await plan.recheck();
        assertCurrent();
        if (plan.dispatch) {
          if (!plan.signal || plan.signal.aborted || !this.#store.createWorldLaunchSeal || !this.#store.readWorldLaunchSeal) throw fail();
          operation.state = "running";
          operation.step = "running";
          operation.updatedAt = this.#clock.now().toISOString();
        }
        const cause = `world-lifecycle-unverified:${operation.id}`;
        this.#addRecovery(serverId, cause);
        snapshot.causes.push(cause);
        snapshot.causes.sort();
        try {
          await this.#store.create(structuredClone(record));
          if (recordDigest(await this.#store.read(operation.id)) !== recordDigest(record)) throw fail();
        } catch { throw fail(); }
        this.#records.set(operation.id, record);
        this.#idempotency.set(this.#idempotencyScope(record), record);
        assertCurrent();
        await plan.recheck(structuredClone(record));
        await this.#verifyFirstManagedStartScope(record);
        assertCurrent();
        if (plan.dispatch && plan.signal) launch = { record, dispatch: plan.dispatch(structuredClone(record)), signal: plan.signal };
      });
      if (launch) {
        const controller = new AbortController();
        try {
          const { record, dispatch, signal } = launch;
          await this.#runOwnedWorldStart(record, AbortSignal.any([signal, controller.signal]), assertCurrent, dispatch,
            () => this.#verifyFirstManagedStartScope(record));
          assertCurrent();
          this.#firstManagedStarts.set(serverId, { operationId: record.operation.id, causes: [...snapshot.causes] });
        }
        catch (error) { controller.abort(); throw error; }
      }
      assertCurrent(); return result;
    } finally {
      await this.#mutate(async () => {
        try { assertCurrent(); } finally { leaseOpen = false; this.#exclusiveLocks.delete(serverId); }
      });
      authorize();
    }
  }

  async #verifyFirstManagedStartScope(record: StoredOperation) {
    const lifecycle = (await this.#store.list()).filter(value =>
      value.operation.serverId === record.operation.serverId && value.worldLifecycle !== undefined);
    if (lifecycle.length !== 1 || recordDigest(lifecycle[0]) !== recordDigest(record)) throw unverifiedOwnedStart();
  }

  isPhysicalTransactionConfirmed(operationId: string): boolean {
    return this.#verifiedTerminalOperations.has(operationId);
  }

  subscribe(listener: OperationListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Persists an open-run intent. The recovery cause owns the server until
   * the lifecycle controller can verify and consume the intent. */
  async persistOwnedWorldStartIntent(
    input: StoredOperation,
    preflight: () => Promise<void>,
    admission: OperationAdmission,
    dispatch?: OwnedWorldStartDispatch
  ): Promise<Operation> {
    const record = structuredClone(input);
    const operation = record.operation;
    const failure = unverifiedOwnedStart;
    const authorize = () => {
      const result: unknown = admission();
      if (result !== undefined) {
        void Promise.resolve(result).catch(() => undefined);
        throw failure();
      }
    };
    if (!validWorldLifecycleReceipt(record) || record.worldLifecycle?.action !== "start" ||
        record.worldLifecycle.launchId !== null || operation.state !== "queued" ||
        operation.result !== null || operation.error !== null || !this.#store.read || !this.#store.create) throw failure();
    if (dispatch && (!this.#store.createWorldLaunchSeal || !this.#store.readWorldLaunchSeal)) throw failure();
    const ownedCause = `world-lifecycle-unverified:${operation.id}`;
    const accepted = await this.#mutate(async () => {
      const serverId = operation.serverId;
      this.assertRegistered(serverId);
      authorize();
      if (this.#recoveryServers.has(serverId) || this.#activeByServer.has(serverId) ||
          this.#exclusiveLocks.has(serverId)) throw failure();
      const key = record.idempotencyKey.toLowerCase();
      if (this.#records.has(operation.id) || [...this.#records.values()].some(previous =>
        previous.operation.serverId === serverId && previous.operation.kind === "start" &&
        previous.idempotencyKey.toLowerCase() === key)) throw failure();
      await preflight();
      authorize();
      this.assertRegistered(serverId);
      if (this.#recoveryServers.has(serverId) || this.#activeByServer.has(serverId) || this.#exclusiveLocks.has(serverId)) throw failure();
      this.#addRecovery(serverId, ownedCause);
      if (dispatch) {
        operation.state = "running";
        operation.step = "running";
        operation.updatedAt = this.#clock.now().toISOString();
      }
      try {
        const expected = JSON.stringify(record);
        await this.#store.create!(structuredClone(record));
        const saved = await this.#store.read!(operation.id);
        if (JSON.stringify(saved) !== expected) throw failure();
      } catch {
        throw failure();
      }
      this.#records.set(operation.id, record);
      this.#idempotency.set(this.#idempotencyScope(record), record);
      authorize();
      if (dispatch) this.#activeByServer.set(serverId, operation.id);
      return this.get(operation.id)!;
    });
    if (dispatch) this.#dispatchOwnedWorldStart(record, [ownedCause], authorize, dispatch);
    return accepted;
  }

  #dispatchOwnedWorldStart(record: StoredOperation, expectedCauses: readonly string[], authorize: () => void, dispatch: OwnedWorldStartDispatch): void {
    const operation = record.operation, failure = unverifiedOwnedStart;
    const expected = new Set(expectedCauses);
    queueMicrotask(() => void (async () => {
      const controller = new AbortController();
      try {
        const beforeSpawn = (): undefined => {
          authorize();
          this.assertRegistered(operation.serverId);
          const causes = this.#recoveryCauses.get(operation.serverId);
          if (controller.signal.aborted || this.#records.get(operation.id) !== record ||
              this.#activeByServer.get(operation.serverId) !== operation.id ||
              !causes || causes.size !== expected.size || [...expected].some(cause => !causes.has(cause)) ||
              this.#exclusiveLocks.has(operation.serverId)) throw failure();
          return undefined;
        };
        await this.#runOwnedWorldStart(record, controller.signal, beforeSpawn, dispatch);
      } catch {
        controller.abort();
        this.#addRecovery(operation.serverId, `operation:${operation.id}`);
      } finally {
        // A dispatch callback is not proof of launch or completion. Keep the
        // original receipt and the recovery cause for a later verified seal.
        if (this.#activeByServer.get(operation.serverId) === operation.id) this.#activeByServer.delete(operation.serverId);
      }
    })());
  }

  async #runOwnedWorldStart(record: StoredOperation, signal: AbortSignal, beforeSpawn: OperationAdmission,
    dispatch: OwnedWorldStartDispatch, verifyScope?: () => Promise<void>) {
    const operation = record.operation, failure = unverifiedOwnedStart;
    this.#emit(operation);
    const verifyBeforeSpawn = async () => {
      const saved = await this.#store.read!(operation.id);
      if (JSON.stringify(saved) !== JSON.stringify(record)) throw failure();
      await verifyScope?.();
      beforeSpawn();
    };
    const sealLaunch = async (launchId: string, assertRunning: OperationAdmission) => {
      const seal: WorldLifecycleLaunchSeal = { schemaVersion: 1, startOperationId: operation.id, launchId,
        intentDigest: createHash("sha256").update(JSON.stringify(record)).digest("hex") };
      if (!validWorldLifecycleLaunchSeal(seal) || !this.#store.createWorldLaunchSeal || !this.#store.readWorldLaunchSeal) throw failure();
      const verifyRunning = () => {
        const result: unknown = assertRunning();
        if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw failure(); }
      };
      await verifyBeforeSpawn();
      verifyRunning();
      await this.#store.createWorldLaunchSeal(structuredClone(seal));
      await verifyBeforeSpawn();
      const saved = await this.#store.readWorldLaunchSeal(operation.id);
      if (JSON.stringify(saved) !== JSON.stringify(seal)) throw failure();
      beforeSpawn();
      verifyRunning();
      return seal;
    };
    await verifyBeforeSpawn();
    await dispatch({ operationId: operation.id, signal, beforeSpawn, verifyBeforeSpawn, sealLaunch });
  }

  /** Admit a single stop for the exact launch covered by the start recovery cause. */
  ownedStopCompletion(operationId: string): Promise<void> {
    return this.#ownedStopTasks.get(operationId) ?? Promise.resolve();
  }

  async persistOwnedWorldStopIntent(
    input: StoredOperation,
    admission: OperationAdmission,
    assertRunning: OperationAdmission,
    dispatch: (context: Pick<RuntimeOperationContext, "operationId" | "signal"> & {
      verifyBeforeStop: () => Promise<void>; beforeStop: OperationAdmission;
      sealStoppedRevision: (revision: StoppedRevision, recheck: () => Promise<void>, assertStopped: OperationAdmission) => Promise<WorldLifecycleStopSeal>;
      verifyStoppedSeal: (seal: WorldLifecycleStopSeal) => Promise<void>;
    }) => Promise<void>
  ): Promise<Operation> {
    const record = structuredClone(input), operation = record.operation, stop = record.worldLifecycle;
    const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "World stop intent requires inspection", "world-stop-intent-unverified", true);
    if (!validWorldLifecycleReceipt(record) || stop?.action !== "stop" || operation.state !== "queued" ||
        operation.result !== null || operation.error !== null || !this.#store.read || !this.#store.create || !this.#store.readWorldLaunchSeal) throw fail();
    if (!this.#store.createWorldStopSeal || !this.#store.readWorldStopSeal) throw fail();
    const { serverId, id } = operation;
    const startCause = `world-lifecycle-unverified:${stop.startOperationId}`, stopCause = `world-lifecycle-unverified:${id}`;
    const firstStart = this.#firstManagedStarts.get(serverId);
    if (firstStart && firstStart.operationId !== stop.startOperationId) throw fail();
    const expectedCauses = firstStart?.causes ?? [startCause];
    const invoke = (check: OperationAdmission) => {
      const result: unknown = check();
      if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw fail(); }
    };
    const checkOwner = (active: boolean): undefined => {
      invoke(admission);
      this.assertRegistered(serverId);
      const causes = this.#recoveryCauses.get(serverId);
      if (this.#exclusiveLocks.has(serverId) || this.#activeByServer.get(serverId) !== (active ? id : undefined) ||
          !causes || causes.size !== expectedCauses.length + (active ? 1 : 0) ||
          expectedCauses.some(cause => !causes.has(cause)) || (active && !causes.has(stopCause))) throw fail();
      return undefined;
    };
    const verifyStart = async (active: boolean) => {
      const parent = await this.#store.read!(stop.startOperationId);
      if (JSON.stringify(parent) !== JSON.stringify(this.#records.get(stop.startOperationId))) throw fail();
      const seal = await this.#store.readWorldLaunchSeal!(stop.startOperationId);
      if (!matchesWorldLifecycleStop(parent, record, seal)) throw fail();
      if (firstStart) {
        const scoped = (await this.#store.list()).filter(value => value.operation.serverId === serverId && value.worldLifecycle !== undefined);
        if (scoped.length !== (active ? 2 : 1) ||
            !scoped.some(value => recordDigest(value) === recordDigest(parent)) ||
            (active && !scoped.some(value => recordDigest(value) === recordDigest(record)))) throw fail();
      }
    };
    const accepted = await this.#mutate(async () => {
      checkOwner(false);
      if (this.#records.has(id) || [...this.#records.values()].some(previous => previous.operation.serverId === serverId &&
          previous.operation.kind === "stop" && (previous.idempotencyKey.toLowerCase() === record.idempotencyKey.toLowerCase() ||
            previous.worldLifecycle?.startOperationId === stop.startOperationId))) throw fail();
      await verifyStart(false);
      checkOwner(false);
      invoke(assertRunning);
      this.#addRecovery(serverId, stopCause);
      operation.state = "running";
      operation.step = "running";
      operation.updatedAt = this.#clock.now().toISOString();
      await this.#store.create!(structuredClone(record));
      if (JSON.stringify(await this.#store.read!(id)) !== JSON.stringify(record)) throw fail();
      this.#records.set(id, record);
      this.#idempotency.set(this.#idempotencyScope(record), record);
      this.#activeByServer.set(serverId, id);
      if (firstStart) this.#firstManagedStarts.delete(serverId);
      return this.get(id)!;
    });
    let finished!: () => void;
    const completion = new Promise<void>(resolve => { finished = resolve; });
    this.#ownedStopTasks.set(id, completion);
    queueMicrotask(() => void (async () => {
      const controller = new AbortController();
      const beforeStop = () => checkOwner(true);
      const verifyBeforeStop = async () => {
        if (JSON.stringify(await this.#store.read!(id)) !== JSON.stringify(record)) throw fail();
        await verifyStart(true);
        beforeStop();
      };
      const verifyStoppedSeal = async (seal: WorldLifecycleStopSeal) => {
        const expected = JSON.stringify(seal);
        if (JSON.stringify(await this.#store.readWorldStopSeal!(id)) !== expected) throw fail();
        beforeStop();
      };
      const sealStoppedRevision = async (revision: StoppedRevision, recheck: () => Promise<void>, assertStopped: OperationAdmission) => {
        const seal: WorldLifecycleStopSeal = { ...revision, schemaVersion: 1, stopOperationId: id,
          stopIntentDigest: createHash("sha256").update(JSON.stringify(record)).digest("hex") };
        if (!validWorldLifecycleStopSeal(seal)) throw fail();
        await recheck();
        await verifyBeforeStop();
        invoke(assertStopped);
        await this.#store.createWorldStopSeal!(structuredClone(seal));
        await recheck();
        await verifyBeforeStop();
        await verifyStoppedSeal(seal);
        invoke(assertStopped);
        return seal;
      };
      try {
        this.#emit(operation);
        await verifyBeforeStop();
        invoke(assertRunning);
        await dispatch({ operationId: id, signal: controller.signal, verifyBeforeStop, beforeStop, sealStoppedRevision, verifyStoppedSeal });
      } catch {
        controller.abort();
        this.#addRecovery(serverId, `operation:${id}`);
      } finally {
        if (this.#activeByServer.get(serverId) === id) this.#activeByServer.delete(serverId);
        this.#ownedStopTasks.delete(id);
        finished();
      }
    })());
    return accepted;
  }

  async requestLifecycle(
    serverId: string,
    kind: LifecycleKind,
    idempotencyKey: string,
    execute: (context: RuntimeOperationContext) => Promise<void>,
    preflight?: () => Promise<void>,
    admission?: OperationAdmission
  ): Promise<Operation> {
    const fingerprint = createHash("sha256").update(`${serverId}\n${kind}\n{}`).digest("hex");
    let created = false;
    const operation = await this.#mutate(async () => {
      this.assertRegistered(serverId);
      admission?.();
      const scope = `${serverId}:${kind}:${idempotencyKey}`;
      const normalized = this.#idempotency.get(`${serverId}:${kind}:${idempotencyKey.toLowerCase()}`);
      const existing = this.#idempotency.get(scope) ?? (normalized?.worldLifecycle ? normalized : undefined);
      if (existing !== undefined && (existing.worldLifecycle || Date.parse(existing.expiresAt) > this.#clock.now().getTime())) {
        if (existing.requestFingerprint !== fingerprint) {
          throw new DomainError(
            409,
            "OPERATION_CONFLICT",
            "Idempotency-Key 已用于不同请求",
            "idempotency-key-reused"
          );
        }
        return structuredClone(existing.operation);
      }
      if (this.#recoveryServers.has(serverId)) {
        throw new DomainError(409, "RECOVERY_REQUIRED", "实例需要人工恢复检查", "recovery-required");
      }
      if (this.#exclusiveLocks.has(serverId)) {
        throw new DomainError(409, "OPERATION_CONFLICT", "实例当前已有独占操作", "operation-active");
      }
      if (this.#activeByServer.has(serverId)) {
        throw new DomainError(409, "OPERATION_CONFLICT", "实例已有活动操作", "operation-active");
      }
      await preflight?.();

      const timestamp = this.#clock.now();
      const next: Operation = {
        id: randomUUID(),
        serverId,
        kind,
        state: "queued",
        step: "queued",
        progress: null,
        createdAt: timestamp.toISOString(),
        updatedAt: timestamp.toISOString(),
        result: null,
        error: null
      };
      const record: StoredOperation = {
        operation: next,
        idempotencyKey,
        requestFingerprint: fingerprint,
        expiresAt: new Date(timestamp.getTime() + IDEMPOTENCY_WINDOW_MS).toISOString()
      };
      // Authorization linearizes at dispatch: a valid admitted save is not undone by later session closure.
      admission?.();
      await this.#store.save(record);
      this.#records.set(next.id, record);
      this.#idempotency.set(scope, record);
      this.#activeByServer.set(serverId, next.id);
      created = true;
      this.#emit(next);
      return structuredClone(next);
    });

    if (created) {
      queueMicrotask(() => void this.#execute(operation.id, execute));
    }
    return operation;
  }

  /** Backend-only single-attempt admission, not an HTTP recovery bypass. The
   * caller supplies prepared physical preflight, final authorization and owner
   * lifetime; execution must still seal/read back before any actual launch. */
  async requestGenerationExecution(serverId: string, key: string, value: unknown,
    execute: (context: RuntimeOperationContext) => Promise<void>, preflight: () => Promise<void>,
    admission: OperationAdmission, lifetime: () => () => undefined): Promise<Operation> {
    if ([execute, preflight, admission, lifetime].some(callback => typeof callback !== "function")) {
      throw new DomainError(409, "RECOVERY_REQUIRED", "Generation admission requires all guards", "generation-guards-required", true);
    }
    const authorize = (): undefined => {
      const result: unknown = admission();
      if (result !== undefined) {
        void Promise.resolve(result).catch(() => undefined);
        throw new DomainError(409, "RECOVERY_REQUIRED", "Generation authorization must be synchronous", "generation-authorization-invalid", true);
      }
    };
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(key)) {
      throw new DomainError(428, "PRECONDITION_REQUIRED", "Generation requires a UUID request key", "idempotency-key-required");
    }
    const target = readGenerationExecutionTarget(value);
    const result = await this.#requestBackup(serverId, key.toLowerCase(), JSON.stringify(generationExecutionRequest(target)), async context => {
      authorize();
      await execute(context);
    }, preflight, "world-create", target.preparationOperationId, authorize, lifetime, target);
    return this.get(result.id)!;
  }

  private async assertGenerationExecutionOwner(serverId: string, target: GenerationExecutionTarget, key: string): Promise<void> {
    const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Generation admission requires inspection", "generation-owner-unverified", true);
    const scan = await this.transactionRecovery?.initialize(), records = scan?.records.filter(record => record.intent.serverId === serverId) ?? [];
    const stored = await this.#store.list();
    if (stored.some(record => record.worldGenerationExecution !== undefined && !validGenerationExecutionReceipt(record))) throw fail();
    const parent = records[0], g = parent?.intent.worldChange?.generation, receipt = stored.find(record => record.operation.id === target.preparationOperationId);
    const names = ["generation-reserved", "stop-confirmed", "guard-verified", "config-ready", "config-switch-intent", "config-installed", "active-state-installed"];
    if (!scan || scan.issues.some(issue => !issue.serverId || issue.serverId === serverId) || records.length !== 1 || !parent ||
        parent.schemaVersion !== 14 || parent.state !== "committed" || !g || parent.checkpoints.length !== names.length ||
        parent.checkpoints.some((point, index) => point.name !== names[index]) ||
        parent.transactionId !== target.preparationTransactionId || parent.intent.operationId !== target.preparationOperationId ||
        g.worldId !== target.worldId || createHash("sha256").update(JSON.stringify(parent)).digest("hex") !== target.preparedRecordDigest ||
        !receipt || receipt.operation.serverId !== serverId || receipt.operation.kind !== "world-create" ||
        !["succeeded", "interrupted"].includes(receipt.operation.state) || receipt.operation.result?.resourceId !== g.guardBackupId || receipt.operation.result.rollbackAvailable) throw fail();
    const allowed = new Set([`generation-unverified:${target.preparationOperationId}`, `operation:${target.preparationOperationId}`, `journal:${target.preparationOperationId}`]);
    const causes = this.#recoveryCauses.get(serverId);
    if (!causes?.has(`generation-unverified:${target.preparationOperationId}`) || [...causes].some(cause => !allowed.has(cause)) ||
        stored.some(record => record.worldGenerationExecution?.serverId === serverId &&
          (record.worldGenerationExecution.preparationOperationId === target.preparationOperationId ||
           record.worldGenerationExecution.preparationTransactionId === target.preparationTransactionId || record.worldGenerationExecution.worldId === target.worldId))) throw fail();
    if (stored.some(record => record.operation.serverId === serverId && record.operation.kind === "world-create" && record.idempotencyKey.toLowerCase() === key.toLowerCase())) {
      throw new DomainError(409, "OPERATION_CONFLICT", "Request key has prior world-operation evidence", "idempotency-key-reused");
    }
  }

  async requestBackup(
    serverId: string,
    idempotencyKey: string,
    requestBody: string,
    execute: (context: RuntimeOperationContext) => Promise<void>,
    preflight?: () => Promise<void>,
    kind: "backup" | "backup-export" | "restore" | "rollback" | "world-create" | "world-import" | "world-library-import" | "world-activate" | "world-replace" | "world-import-recovery" | "world-archive" | "properties-write" | "addon-change" | "whitelist-change" = "backup",
    recoveryOwner?: string,
    admission?: OperationAdmission,
    lifetime?: () => () => undefined
  ): Promise<Operation> {
    return this.#requestBackup(serverId, idempotencyKey, requestBody, execute, preflight, kind, recoveryOwner, admission, lifetime);
  }

  async #requestBackup(
    serverId: string, idempotencyKey: string, requestBody: string, execute: (context: RuntimeOperationContext) => Promise<void>,
    preflight?: () => Promise<void>, kind: Parameters<OperationService["requestBackup"]>[5] = "backup", recoveryOwner?: string,
    admission?: OperationAdmission, lifetime?: () => () => undefined, generation?: GenerationExecutionTarget
  ): Promise<Operation> {
    const fingerprint = createHash("sha256").update(`${serverId}\n${kind}\n${requestBody}`).digest("hex");
    let created = false;
    let releaseOwner: (() => undefined) | undefined;
    const operation = await this.#mutate(async () => {
      this.assertRegistered(serverId);
      admission?.();
      const scope = `${serverId}:${kind}:${idempotencyKey}`;
      const protectedExecution = kind === "world-create" ? this.#idempotency.get(this.#generationScope(serverId, idempotencyKey)) : undefined;
      const existing = protectedExecution?.worldGenerationExecution ? protectedExecution : this.#idempotency.get(scope);
      if (generation && existing && !existing.worldGenerationExecution) {
        throw new DomainError(409, "OPERATION_CONFLICT", "Request key has prior world-operation evidence", "idempotency-key-reused");
      }
      if (existing !== undefined && (["whitelist-change", "world-activate", "world-replace"].includes(kind) || existing.worldGenerationExecution || Date.parse(existing.expiresAt) > this.#clock.now().getTime())) {
        if (existing.requestFingerprint !== fingerprint) {
          throw new DomainError(409, "OPERATION_CONFLICT", "Idempotency-Key 已用于不同请求", "idempotency-key-reused");
        }
        return ["whitelist-change", "world-replace", "world-library-import"].includes(kind) ||
          this.#recoveryCauses.get(serverId)?.has(`generation-unverified:${existing.operation.id}`) ? this.get(existing.operation.id)! : structuredClone(existing.operation);
      }
      if (generation && [...this.#records.values()].some(record => record.operation.serverId === serverId && record.operation.kind === "world-create" &&
          record.idempotencyKey.toLowerCase() === idempotencyKey.toLowerCase())) {
        throw new DomainError(409, "OPERATION_CONFLICT", "Request key has prior world-operation evidence", "idempotency-key-reused");
      }
      if (generation) await this.assertGenerationExecutionOwner(serverId, generation, idempotencyKey);
      if (this.#recoveryServers.has(serverId)) {
        if (kind === "rollback" && recoveryOwner) await this.assertRecoveryOwner(serverId, recoveryOwner);
        else if (kind === "world-import-recovery" && recoveryOwner) await this.assertImportRecoveryOwner(serverId,recoveryOwner);
        else if (kind === "world-create" && generation && recoveryOwner === generation.preparationOperationId) { /* Dedicated owner checked above. */ }
        else throw new DomainError(409, "RECOVERY_REQUIRED", "实例需要人工恢复检查", "recovery-required");
      }
      if (this.#exclusiveLocks.has(serverId) || this.#activeByServer.has(serverId)) {
        throw new DomainError(409, "OPERATION_CONFLICT", "实例当前已有活动操作", "operation-active");
      }
      await preflight?.();
      if (generation) await this.assertGenerationExecutionOwner(serverId, generation, idempotencyKey);
      const timestamp = this.#clock.now();
      const next: Operation = {
        id: randomUUID(), serverId, kind, state: "queued", step: "queued", progress: null,
        createdAt: timestamp.toISOString(), updatedAt: timestamp.toISOString(), result: null, error: null
      };
      const record: StoredOperation = {
        operation: next,
        idempotencyKey,
        requestFingerprint: fingerprint,
        expiresAt: new Date(timestamp.getTime() + IDEMPOTENCY_WINDOW_MS).toISOString(),
        ...(generation ? { worldGenerationExecution: readGenerationExecution({ ...generation, schemaVersion: 1, serverId,
          executionOperationId: next.id, requestDigest: fingerprint, keyDigest: generationKeyDigest(idempotencyKey) }) } : {})
      };
      admission?.();
      releaseOwner = lifetime?.();
      if (generation && typeof releaseOwner !== "function") {
        void Promise.resolve(releaseOwner).catch(() => undefined);
        releaseOwner = undefined;
        throw new DomainError(409, "RECOVERY_REQUIRED", "Generation requires an owner release handle", "generation-owner-required", true);
      }
      await this.#store.save(record);
      this.#records.set(next.id, record);
      this.#idempotency.set(this.#idempotencyScope(record), record);
      if (generation) this.retainGenerationInspection(serverId, next.id);
      this.#activeByServer.set(serverId, next.id);
      created = true;
      this.#emit(next);
      return structuredClone(next);
    }).catch((error: unknown) => { releaseOwner?.(); releaseOwner = undefined; throw error; });
    if (created) queueMicrotask(() => void this.#execute(operation.id, execute, releaseOwner));
    return operation;
  }

  async #execute(
    operationId: string,
    execute: (context: RuntimeOperationContext) => Promise<void>,
    releaseOwner?: () => undefined
  ): Promise<void> {
    const controller = new AbortController();
    let sideEffectStarted = false;
    try {
      await this.#update(operationId, { state: "running", step: "running" });
      sideEffectStarted = true;
      await execute({
        operationId,
        signal: controller.signal,
        onStep: async (step) => this.#update(operationId, { step })
        ,onResult: async (result) => { await this.#update(operationId, { result }); }
      });
      await this.#update(operationId, {
        state: "succeeded",
        step: "completed",
        result: this.#records.get(operationId)?.operation.result ?? { resourceId: null, rollbackAvailable: false },
        error: null
      });
    } catch (error) {
      controller.abort();
      const domain = error instanceof DomainError ? error : null;
      const operation = this.#records.get(operationId)?.operation;
      const requiresRecovery = sideEffectStarted &&
        (domain === null || domain.requiresRecovery);
      if (requiresRecovery && operation !== undefined) {
        this.#addRecovery(operation.serverId, `operation:${operation.id}`);
      }
      try {
        await this.#update(operationId, {
          state: requiresRecovery ? "interrupted" : "failed",
          step: requiresRecovery ? "recovery-required" : "failed",
          result: this.#records.get(operationId)?.operation.result ?? null,
          error: {
            code: requiresRecovery ? "RECOVERY_REQUIRED" : (domain?.code ?? "INTERNAL_ERROR"),
            message: requiresRecovery
              ? "操作结果无法安全确认，需要人工检查"
              : (domain?.safeMessage ?? "操作失败；详细诊断已安全记录")
          }
        });
      } catch {
        if (operation !== undefined) this.#addRecovery(operation.serverId, `operation:${operation.id}`);
      }
    } finally {
      const operation = this.#records.get(operationId)?.operation;
      try { if (releaseOwner && releaseOwner() !== undefined && operation) this.#addRecovery(operation.serverId, `operation:${operation.id}`); }
      catch { if (operation) this.#addRecovery(operation.serverId, `operation:${operation.id}`); }
      if (operation !== undefined) this.#activeByServer.delete(operation.serverId);
    }
  }

  async #update(operationId: string, changes: Partial<Operation>): Promise<Operation> {
    return this.#mutate(async () => {
      const current = this.#records.get(operationId);
      if (current === undefined) throw new Error("Operation record missing");
      if (current.worldLifecycle) throw new Error("World lifecycle receipts are immutable");
      const operation: Operation = {
        ...current.operation,
        ...changes,
        id: current.operation.id,
        serverId: current.operation.serverId,
        kind: current.operation.kind,
        createdAt: current.operation.createdAt,
        updatedAt: this.#clock.now().toISOString()
      };
      const record = { ...current, operation };
      await this.#store.save(record);
      this.#records.set(operationId, record);
      this.#idempotency.set(this.#idempotencyScope(record), record);
      this.#emit(operation);
      return structuredClone(operation);
    });
  }

  #emit(operation: Operation): void {
    const causes = this.#recoveryCauses.get(operation.serverId);
    const visible = causes?.has(`generation-unverified:${operation.id}`) || causes?.has(`world-lifecycle-unverified:${operation.id}`)
      ? this.get(operation.id) ?? operation : operation;
    for (const listener of this.#listeners) {
      try {
        listener(structuredClone(visible));
      } catch {
        // Subscribers are observational and cannot invalidate a durable operation transition.
      }
    }
  }

  #idempotencyScope(record: StoredOperation): string {
    if (record.worldGenerationExecution) return this.#generationScope(record.operation.serverId, record.idempotencyKey);
    if (record.worldLifecycle) return `${record.operation.serverId}:${record.operation.kind}:${record.idempotencyKey.toLowerCase()}`;
    return `${record.operation.serverId}:${record.operation.kind}:${record.idempotencyKey}`;
  }
  #generationScope(serverId: string, key: string): string {
    // UUID normalization agrees with keyDigest; no synthetic prefix that an
    // arbitrary legacy key could impersonate in the shared map namespace.
    return `${serverId}:world-create:${key.toLowerCase()}`;
  }

  async #mutate<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.#mutationTail;
    let release: () => void = () => {};
    this.#mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }
}
