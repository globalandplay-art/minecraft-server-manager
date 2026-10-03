import { createHash, randomUUID } from "node:crypto";

import type { Operation } from "@mcsm/contracts";

import type { Clock } from "../clock.js";
import type { RuntimeOperationContext } from "../infra/runtime-contract.js";
import { DomainError } from "./domain-errors.js";
import type { OperationStore, StoredOperation } from "./operation-store.js";
import type { JournalScanResult } from "./transaction-journal.js";

const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
type LifecycleKind = "start" | "stop" | "restart";
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
  readonly #verifiedTerminalOperations = new Set<string>();
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(
    store: OperationStore,
    clock: Clock,
    private readonly transactionRecovery?: { initialize(): Promise<JournalScanResult> }
  ) {
    this.#store = store;
    this.#clock = clock;
  }

  async initialize(): Promise<void> {
    await this.#store.initialize();
    const [stored, transactionScan] = await Promise.all([
      this.#store.list(),
      this.transactionRecovery?.initialize()
    ]);
    const now = this.#clock.now();
    for (const record of transactionScan?.records ?? []) if (["active", "recovery-required"].includes(record.state)) {
      this.#addRecovery(record.intent.serverId, `journal:${record.intent.operationId}`);
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
      if (!(record.intent.restore || record.intent.worldChange || record.intent.worldImport) || !["committed", "rolled-back"].includes(record.state)) continue;
      const outcome = storedById.get(record.intent.operationId);
      const established = outcome?.state === "succeeded" || (outcome?.state === "failed" && outcome.step === "rolled-back" && !outcome.error);
      if (!established && !this.#verifiedTerminalOperations.has(record.intent.operationId)) this.requireTransactionRecovery(record.intent.serverId, record.intent.operationId);
    }
    for (const record of stored) {
      let current = record;
      const terminal = transactionScan?.records.find((item) => (item.intent.operationId === record.operation.id ||
        (item.intent.worldImport && item.checkpoints.some((c) => c.name === "import-recovery-operation" && c.details?.resourceId === record.operation.id))) &&
        ["committed", "rolled-back"].includes(item.state));
      const established = record.operation.state === "succeeded" || (record.operation.state === "failed" && record.operation.step === "rolled-back" && !record.operation.error);
      const unverified = Boolean((terminal?.intent.restore || terminal?.intent.worldChange || terminal?.intent.worldImport) && !established && !this.#verifiedTerminalOperations.has(record.operation.id));
      const unsafeCompletion = unverified || Boolean(terminal && this.#recoveryCauses.get(record.operation.serverId)?.has(`operation:${record.operation.id}`));
      if (unverified) this.requireTransactionRecovery(record.operation.serverId, record.operation.id);
      if (unsafeCompletion || record.operation.state === "queued" || record.operation.state === "running" || (record.operation.state === "interrupted" && terminal)) {
        const interrupted: Operation = {
          ...record.operation,
          state: unsafeCompletion ? "interrupted" : terminal ? (terminal.state === "committed" || record.operation.kind === "world-import-recovery" ? "succeeded" : "failed") : "interrupted",
          step: unsafeCompletion ? "physical-recovery-required" : terminal ? terminal.state : "manager-restarted",
          updatedAt: now.toISOString(),
          result: terminal?.intent.restore ? { resourceId: terminal.intent.restore.guardBackupId, rollbackAvailable: terminal.state === "committed" && terminal.intent.kind === "restore" } : record.operation.result,
          error: terminal && !unsafeCompletion ? null : record.operation.kind === "backup-export"
            ? { code: "EXPORT_INTERRUPTED", message: "导出被管理器重启中断，可重新请求" }
            : { code: "RECOVERY_REQUIRED", message: "管理器重启中断了操作，需要人工检查" }
        };
        current = { ...record, operation: interrupted };
        await this.#store.save(current);
        if (!terminal && interrupted.kind !== "backup-export") this.#addRecovery(interrupted.serverId, `operation:${interrupted.id}`);
      }
      if (
        current.operation.state === "interrupted" &&
        current.operation.error?.code === "RECOVERY_REQUIRED"
      ) {
        if (!terminal) this.#addRecovery(current.operation.serverId, `operation:${current.operation.id}`);
      }
      this.#records.set(current.operation.id, current);
      if (Date.parse(current.expiresAt) > now.getTime()) {
        this.#idempotency.set(this.#idempotencyScope(current), current);
      }
    }
  }

  get(operationId: string): Operation | undefined {
    const record = this.#records.get(operationId);
    return record === undefined ? undefined : structuredClone(record.operation);
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

  async storedOutcomes(): Promise<Operation[]> {
    await this.#store.initialize();
    return (await this.#store.list()).map((record) => record.operation);
  }

  confirmPhysicalTransaction(operationId: string): void {
    this.#verifiedTerminalOperations.add(operationId);
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

  async runExclusive<T>(serverId: string, action: () => Promise<T>): Promise<T> {
    await this.#mutate(async () => {
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

  subscribe(listener: OperationListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async requestLifecycle(
    serverId: string,
    kind: LifecycleKind,
    idempotencyKey: string,
    execute: (context: RuntimeOperationContext) => Promise<void>,
    preflight?: () => Promise<void>
  ): Promise<Operation> {
    const fingerprint = createHash("sha256").update(`${serverId}\n${kind}\n{}`).digest("hex");
    let created = false;
    const operation = await this.#mutate(async () => {
      const scope = `${serverId}:${kind}:${idempotencyKey}`;
      const existing = this.#idempotency.get(scope);
      if (existing !== undefined && Date.parse(existing.expiresAt) > this.#clock.now().getTime()) {
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

  async requestBackup(
    serverId: string,
    idempotencyKey: string,
    requestBody: string,
    execute: (context: RuntimeOperationContext) => Promise<void>,
    preflight?: () => Promise<void>,
    kind: "backup" | "backup-export" | "restore" | "rollback" | "world-create" | "world-import" | "world-import-recovery" = "backup",
    recoveryOwner?: string
  ): Promise<Operation> {
    const fingerprint = createHash("sha256").update(`${serverId}\n${kind}\n${requestBody}`).digest("hex");
    let created = false;
    const operation = await this.#mutate(async () => {
      const scope = `${serverId}:${kind}:${idempotencyKey}`;
      const existing = this.#idempotency.get(scope);
      if (existing !== undefined && Date.parse(existing.expiresAt) > this.#clock.now().getTime()) {
        if (existing.requestFingerprint !== fingerprint) {
          throw new DomainError(409, "OPERATION_CONFLICT", "Idempotency-Key 已用于不同请求", "idempotency-key-reused");
        }
        return structuredClone(existing.operation);
      }
      if (this.#recoveryServers.has(serverId)) {
        if (kind === "rollback" && recoveryOwner) await this.assertRecoveryOwner(serverId, recoveryOwner);
        else if (kind === "world-import-recovery" && recoveryOwner) await this.assertImportRecoveryOwner(serverId,recoveryOwner);
        else throw new DomainError(409, "RECOVERY_REQUIRED", "实例需要人工恢复检查", "recovery-required");
      }
      if (this.#exclusiveLocks.has(serverId) || this.#activeByServer.has(serverId)) {
        throw new DomainError(409, "OPERATION_CONFLICT", "实例当前已有活动操作", "operation-active");
      }
      await preflight?.();
      const timestamp = this.#clock.now();
      const next: Operation = {
        id: randomUUID(), serverId, kind, state: "queued", step: "queued", progress: null,
        createdAt: timestamp.toISOString(), updatedAt: timestamp.toISOString(), result: null, error: null
      };
      const record: StoredOperation = {
        operation: next,
        idempotencyKey,
        requestFingerprint: fingerprint,
        expiresAt: new Date(timestamp.getTime() + IDEMPOTENCY_WINDOW_MS).toISOString()
      };
      await this.#store.save(record);
      this.#records.set(next.id, record);
      this.#idempotency.set(scope, record);
      this.#activeByServer.set(serverId, next.id);
      created = true;
      this.#emit(next);
      return structuredClone(next);
    });
    if (created) queueMicrotask(() => void this.#execute(operation.id, execute));
    return operation;
  }

  async #execute(
    operationId: string,
    execute: (context: RuntimeOperationContext) => Promise<void>
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
      if (operation !== undefined) this.#activeByServer.delete(operation.serverId);
    }
  }

  async #update(operationId: string, changes: Partial<Operation>): Promise<Operation> {
    return this.#mutate(async () => {
      const current = this.#records.get(operationId);
      if (current === undefined) throw new Error("Operation record missing");
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
    for (const listener of this.#listeners) {
      try {
        listener(structuredClone(operation));
      } catch {
        // Subscribers are observational and cannot invalidate a durable operation transition.
      }
    }
  }

  #idempotencyScope(record: StoredOperation): string {
    return `${record.operation.serverId}:${record.operation.kind}:${record.idempotencyKey}`;
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
