import { randomUUID } from "node:crypto";
import type { AccessOperation, AccessMutationRequest } from "@mcsm/contracts";
import { Value } from "@sinclair/typebox/value";
import { accessMutationRequestSchema } from "@mcsm/contracts";
import type { Clock } from "../clock.js";
import { systemClock } from "../clock.js";
import { AccessOperationStore } from "./access-operation-store.js";
import { accessHash, accessTerminal, accessUuid, type AccessCheckpoint } from "./access-operation-record.js";
import { DomainError } from "./domain-errors.js";

export type AccessProvider = AccessOperation["resource"]["provider"];
export interface AccessSnapshot { configurationRevision: string; observedRevision: string; ownershipRevision: string; previousEnabled: boolean }
export interface AccessEvidence extends AccessSnapshot {
  operationId: string; outcome: "applied" | "not_applied" | "unknown";
  enabled: boolean | null; healthy: boolean; resourceRevision: string;
}
/** No production implementation exists. Injection is a test-construction seam only. */
export interface AccessProviderAdapter {
  preflight(provider: AccessProvider, action: AccessOperation["action"]): Promise<AccessSnapshot>;
  apply(intent: AccessCheckpoint, authorize: () => void): Promise<void>;
  observe(intent: AccessCheckpoint): Promise<AccessEvidence>;
}
const unavailable = () => new DomainError(503, "ACCESS_UNAVAILABLE", "The remote provider is unavailable.");
const required = () => new DomainError(409, "ACCESS_RECOVERY_REQUIRED", "Access evidence requires inspection.");
const conflict = () => new DomainError(409, "ACCESS_CONFLICT", "The Access request conflicts with current evidence.");
const validDigest = (value: string) => /^[0-9a-f]{64}$/u.test(value);
export const accessAppliedRevision = (intent: AccessCheckpoint) => accessHash(`${intent.observedRevision}|${intent.operation.id}|${intent.operation.action}|${intent.ownershipRevision}`);
const requestHash = (provider: AccessProvider, action: AccessOperation["action"], body: AccessMutationRequest) =>
  accessHash(JSON.stringify({ provider, action, revision: body.revision, confirm: body.confirm }));
const cloneOperation = (value: AccessOperation): AccessOperation => ({ ...value, resource: { ...value.resource } });

export class AccessOperationService {
  #store: AccessOperationStore | undefined; #adapter: AccessProviderAdapter | undefined; #clock: Clock;
  #blocked = false; #busy = false; #closing = false; #active: Promise<unknown> | undefined;
  #executingId: string | undefined;
  #records = new Map<string, AccessCheckpoint>();
  #configuration: ((provider: AccessProvider) => Promise<string | null>) | undefined;
  constructor(options: { store?: AccessOperationStore; adapter?: AccessProviderAdapter; clock?: Clock;
    configuration?: (provider: AccessProvider) => Promise<string | null>; blocked?: boolean } = {}) {
    this.#store = options.store; this.#adapter = options.adapter; this.#clock = options.clock ?? systemClock;
    this.#configuration = options.configuration; this.#blocked = options.blocked ?? false;
  }
  async initialize(): Promise<void> {
    if (!this.#store) return;
    try {
      await this.#refresh();
      for (const record of this.#records.values()) {
        if (this.#adapter && !accessTerminal(record.operation.state)) {
          // Read-only observation does not finalize, retry or authorize a mutation.
          try { await this.#adapter.observe(record); } catch { /* uncertainty remains recovery_required */ }
        }
      }
    } catch { this.#blocked = true; }
  }
  async #refresh(): Promise<void> {
    if (!this.#store || this.#blocked) throw required();
    const chains = await this.#store.scan();
    const next = new Map<string, AccessCheckpoint>(); const keys = new Set<string>();
    for (const chain of chains) {
      const last = chain.at(-1)!;
      if (keys.has(last.idempotencyHash)) throw required();
      keys.add(last.idempotencyHash); next.set(last.operation.id, last);
    }
    this.#records = next;
  }
  async get(id: string): Promise<AccessOperation> {
    if (!accessUuid(id)) throw new DomainError(400, "VALIDATION_ERROR", "Invalid Access operation identifier.");
    if (this.#blocked) throw required();
    if (!this.#busy && this.#store) {
      try { await this.#exclusive(async () => this.#refresh()); } catch { this.#blocked = true; throw required(); }
    }
    const record = this.#records.get(id);
    if (!record) throw new DomainError(404, "ACCESS_OPERATION_NOT_FOUND", "Access operation was not found.");
    const operation = cloneOperation(record.operation);
    if (this.#executingId !== id && !accessTerminal(operation.state)) {
      operation.state = "recovery_required"; operation.errorCode = "ACCESS_RECOVERY_REQUIRED";
    }
    return operation;
  }
  async #exclusive<T>(run: () => Promise<T>): Promise<T> {
    if (this.#closing) throw unavailable();
    if (this.#busy) throw new DomainError(409, "ACCESS_BUSY", "An Access operation is already active.");
    if (this.#blocked) throw required();
    if (!this.#store) throw unavailable();
    this.#busy = true;
    const task = this.#store.exclusive(run); this.#active = task;
    try { return await task; } finally { this.#busy = false; this.#executingId = undefined; this.#active = undefined; }
  }
  async submit(provider: AccessProvider, action: AccessOperation["action"], body: AccessMutationRequest,
    idempotencyKey: string, authorize: () => void): Promise<AccessOperation> {
    if (!["tailscale", "cloudflare"].includes(provider) || !["enable", "disable"].includes(action) ||
      !Value.Check(accessMutationRequestSchema, body) || !accessUuid(idempotencyKey)) throw new DomainError(400, "VALIDATION_ERROR", "Invalid Access request.");
    if (!this.#adapter || !this.#configuration) throw unavailable();
    return this.#exclusive(async () => {
      await this.#refresh();
      const key = accessHash(idempotencyKey); const fingerprint = requestHash(provider, action, body);
      const replay = [...this.#records.values()].find((record) => record.idempotencyHash === key);
      if (replay) {
        authorize(); if (replay.requestHash !== fingerprint) throw conflict();
        const operation = cloneOperation(replay.operation);
        if (!accessTerminal(operation.state)) { operation.state = "recovery_required"; operation.errorCode = "ACCESS_RECOVERY_REQUIRED"; }
        return operation;
      }
      if ([...this.#records.values()].some((record) => !accessTerminal(record.operation.state))) throw required();
      const configurationRevision = await this.#configuration!(provider);
      if (configurationRevision !== body.revision) throw conflict();
      const snapshot = await this.#adapter!.preflight(provider, action);
      if (snapshot.configurationRevision !== configurationRevision || !validDigest(snapshot.observedRevision) || !validDigest(snapshot.ownershipRevision) ||
        typeof snapshot.previousEnabled !== "boolean") throw conflict();
      if (await this.#configuration!(provider) !== configurationRevision) throw conflict();
      const now = this.#clock.now().toISOString();
      let current: AccessCheckpoint;
      try {
        current = await this.#store!.admit({ schemaVersion: 1, sequence: 0, previousHash: null,
          idempotencyHash: key, requestHash: fingerprint, configurationRevision,
          observedRevision: snapshot.observedRevision, ownershipRevision: snapshot.ownershipRevision, previousEnabled: snapshot.previousEnabled,
          operation: { schemaVersion: 1, id: randomUUID(), resource: { kind: "manager-access", provider }, action,
            state: "intent_persisted", createdAt: now, updatedAt: now, errorCode: null } }, authorize);
      } catch (error) {
        if (error instanceof DomainError && (error.code.startsWith("AUTH_") || error.code === "CSRF_REJECTED")) throw error;
        this.#blocked = true; throw required();
      }
      this.#records.set(current.operation.id, current);
      this.#executingId = current.operation.id;
      try {
        current = await this.#append(current, "applying", null);
        await this.#adapter!.apply(current, authorize);
        current = await this.#append(current, "verifying", null);
        const evidence = await this.#adapter!.observe(current);
        if (!this.#proves(current, evidence, "applied")) throw required();
        current = await this.#append(current, "succeeded", null);
      } catch (error) {
        try { current = await this.#append(current, "recovery_required", "ACCESS_RECOVERY_REQUIRED"); }
        catch { this.#blocked = true; }
        if (error instanceof DomainError && (error.code.startsWith("AUTH_") || error.code === "CSRF_REJECTED")) throw error;
      }
      const result = cloneOperation(current.operation);
      if (!accessTerminal(result.state)) { result.state = "recovery_required"; result.errorCode = "ACCESS_RECOVERY_REQUIRED"; }
      return result;
    });
  }
  async #append(current: AccessCheckpoint, state: AccessOperation["state"], errorCode: AccessOperation["errorCode"], authorize?: () => void): Promise<AccessCheckpoint> {
    const next = await this.#store!.append(current.operation.id, state, errorCode, this.#clock.now().toISOString(), authorize);
    this.#records.set(next.operation.id, next); return next;
  }
  #proves(intent: AccessCheckpoint, evidence: AccessEvidence, outcome: "applied" | "not_applied"): boolean {
    return evidence.operationId === intent.operation.id && evidence.configurationRevision === intent.configurationRevision &&
      evidence.observedRevision === intent.observedRevision && evidence.ownershipRevision === intent.ownershipRevision &&
      evidence.outcome === outcome && evidence.healthy === true &&
      (outcome === "applied" ? evidence.resourceRevision === accessAppliedRevision(intent) && evidence.enabled === (intent.operation.action === "enable")
        : evidence.resourceRevision === intent.observedRevision && evidence.enabled === intent.previousEnabled);
  }
  async recover(id: string, body: AccessMutationRequest, authorize: () => void): Promise<AccessOperation> {
    if (!accessUuid(id)) throw new DomainError(400, "VALIDATION_ERROR", "Invalid Access operation identifier.");
    if (!this.#adapter || !this.#configuration) throw unavailable();
    return this.#exclusive(async () => {
      await this.#refresh(); let current = this.#records.get(id);
      if (!current) throw new DomainError(404, "ACCESS_OPERATION_NOT_FOUND", "Access operation was not found.");
      if (!Value.Check(accessMutationRequestSchema, body) || body.revision !== current.configurationRevision) throw conflict();
      if (accessTerminal(current.operation.state)) { authorize(); return cloneOperation(current.operation); }
      if (await this.#configuration!(current.operation.resource.provider) !== current.configurationRevision) throw conflict();
      const evidence = await this.#adapter!.observe(current); authorize();
      const applied = this.#proves(current, evidence, "applied"); const notApplied = this.#proves(current, evidence, "not_applied");
      if (!applied && !notApplied) throw required();
      try {
        if (current.operation.state !== "recovery_required") current = await this.#append(current, "recovery_required", "ACCESS_RECOVERY_REQUIRED", authorize);
        current = await this.#append(current, applied ? "succeeded" : "failed", applied ? null : "ACCESS_VERIFICATION_FAILED", authorize);
        return cloneOperation(current.operation);
      } catch (error) {
        if (error instanceof DomainError && (error.code.startsWith("AUTH_") || error.code === "CSRF_REJECTED")) throw error;
        this.#blocked = true; throw required();
      }
    });
  }
  async close(): Promise<void> { this.#closing = true; try { await this.#active; } catch { /* fixed safe state retained */ } }
  async controlState(): Promise<{ available: boolean; recoveryOperationId: string | null }> {
    const { available, recoveryOperationId } = await this.controlPreview(async () => undefined);
    return { available, recoveryOperationId };
  }
  async controlPreview<T>(read: () => Promise<T>): Promise<{ available: boolean; recoveryOperationId: string | null; preview?: T }> {
    if (!this.#adapter || !this.#configuration || !this.#store) return { available: false, recoveryOperationId: null };
    return this.#exclusive(async () => {
      await this.#refresh();
      const pending = [...this.#records.values()].find((record) => !accessTerminal(record.operation.state));
      const preview = await read();
      return { available: true, recoveryOperationId: pending?.operation.id ?? null, preview };
    });
  }
}
