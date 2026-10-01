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
  readonly #listeners = new Set<OperationListener>();
  readonly #exclusiveLocks = new Set<string>();
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
    for (const serverId of transactionScan?.recoveryServerIds ?? []) {
      this.#recoveryServers.add(serverId);
    }
    for (const record of stored) {
      let current = record;
      if (record.operation.state === "queued" || record.operation.state === "running") {
        const interrupted: Operation = {
          ...record.operation,
          state: "interrupted",
          step: "manager-restarted",
          updatedAt: now.toISOString(),
          result: null,
          error: record.operation.kind === "backup-export"
            ? { code: "EXPORT_INTERRUPTED", message: "导出被管理器重启中断，可重新请求" }
            : { code: "RECOVERY_REQUIRED", message: "管理器重启中断了操作，需要人工检查" }
        };
        current = { ...record, operation: interrupted };
        await this.#store.save(current);
        if (interrupted.kind !== "backup-export") this.#recoveryServers.add(interrupted.serverId);
      }
      if (
        current.operation.state === "interrupted" &&
        current.operation.error?.code === "RECOVERY_REQUIRED"
      ) {
        this.#recoveryServers.add(current.operation.serverId);
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
    for (const serverId of serverIds) this.#recoveryServers.add(serverId);
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
    kind: "backup" | "backup-export" = "backup"
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
        throw new DomainError(409, "RECOVERY_REQUIRED", "实例需要人工恢复检查", "recovery-required");
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
      });
      await this.#update(operationId, {
        state: "succeeded",
        step: "completed",
        result: { resourceId: null, rollbackAvailable: false },
        error: null
      });
    } catch (error) {
      controller.abort();
      const domain = error instanceof DomainError ? error : null;
      const operation = this.#records.get(operationId)?.operation;
      const requiresRecovery = sideEffectStarted &&
        (domain === null || domain.requiresRecovery);
      if (requiresRecovery && operation !== undefined) {
        this.#recoveryServers.add(operation.serverId);
      }
      try {
        await this.#update(operationId, {
          state: requiresRecovery ? "interrupted" : "failed",
          step: requiresRecovery ? "recovery-required" : "failed",
          result: null,
          error: {
            code: requiresRecovery ? "RECOVERY_REQUIRED" : (domain?.code ?? "INTERNAL_ERROR"),
            message: requiresRecovery
              ? "操作结果无法安全确认，需要人工检查"
              : (domain?.safeMessage ?? "操作失败；详细诊断已安全记录")
          }
        });
      } catch {
        if (operation !== undefined) this.#recoveryServers.add(operation.serverId);
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
