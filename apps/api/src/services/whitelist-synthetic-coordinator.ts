import type { Operation } from "@mcsm/contracts";
import type { Clock } from "../clock.js";
import type { ManagerLifetimeLock } from "../auth/manager-lifetime-lock.js";
import { DomainError } from "./domain-errors.js";
import type { OperationAdmission, OperationService } from "./operation-service.js";
import { whitelistCommandHash, whitelistCommandRequestHash, type WhitelistCommandRecord } from "./whitelist-command-record.js";
import type { WhitelistCommandStore } from "./whitelist-command-store.js";
import { verifyWhitelistSourceBytes, type WhitelistGuardStore } from "./whitelist-guard-store.js";
import { compareWhitelistMemberEvidence, parseWhitelistMemberIntent, validateWhitelistMemberIntent,
  whitelistMemberRevision, type WhitelistMemberSnapshot } from "./whitelist-member-policy.js";

/** Synthetic receipt protocol. NOT a Minecraft command grammar or real RCON adapter. */
export interface SyntheticWhitelistReceipt { mode: "synthetic-whitelist-v1"; operationId: string; serverId: string; runtimeId: string;
  requestHash: string; beforeSha256: string; afterSha256: string }
export interface SyntheticWhitelistRuntime {
  registeredRoot(serverId: string): Promise<string | null>;
  capture(serverId: string): Promise<{ snapshot: WhitelistMemberSnapshot; bytes: Buffer; runtimeNames: string[] }>;
  /** Fake atomically verifies runtime/root/revision at dispatch; never reuse this as ordinary RCON. */
  dispatch(intent: WhitelistCommandRecord, authorize: () => void): Promise<SyntheticWhitelistReceipt>;
  receipt(hash: string): Promise<SyntheticWhitelistReceipt | null>;
  /** Immutable observation captured by the Fake daemon for THAT response, not today's membership. */
  recordedEvidence(hash: string): Promise<{ snapshot: WhitelistMemberSnapshot; bytes: Buffer; runtimeNames: string[] } | null>;
}
const recover = () => new DomainError(409, "RECOVERY_REQUIRED", "白名单命令结果未完整确认，保护证据已保留", "whitelist-command-uncertain", true);
const keyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
function receiptHash(receipt: SyntheticWhitelistReceipt): string {
  if (!receipt || typeof receipt !== "object" || Object.keys(receipt).sort().join(",") !==
    "afterSha256,beforeSha256,mode,operationId,requestHash,runtimeId,serverId" || receipt.mode !== "synthetic-whitelist-v1" ||
    !keyPattern.test(receipt.operationId) || !keyPattern.test(receipt.runtimeId) || !/^[a-z0-9][a-z0-9-]{0,62}$/u.test(receipt.serverId) ||
    [receipt.requestHash, receipt.beforeSha256, receipt.afterSha256].some((value) => typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))) throw recover();
  return whitelistCommandHash(JSON.stringify(receipt));
}

/** Construction-only Fake integration. No production app import, env switch or HTTP route.
 * Requires shared OperationService and private stores; does not create a second supervisor. */
export class SyntheticWhitelistCoordinator {
  #ready = false; #closed = false;
  constructor(readonly operations: OperationService, readonly commands: WhitelistCommandStore, readonly guards: WhitelistGuardStore,
    readonly runtime: SyntheticWhitelistRuntime, readonly clock: Clock,
    readonly owner: Pick<ManagerLifetimeLock, "assertHeld" | "rootIdentity" | "beginOfflineMutation" | "beginActivity">) {
    if (owner !== commands.owner || owner !== guards.owner || commands.root !== guards.root) throw recover();
  }
  close(): void { this.#closed = true; this.#ready = false; }
  #assertOpen(): void { if (this.#closed) throw recover(); this.owner.assertHeld(this.commands.root); }
  async initialize(): Promise<void> {
    this.#assertOpen(); const release = this.owner.beginActivity(this.commands.root);
    try {
    this.#ready = false;
    const chains = await this.commands.scan(); const guards = await this.guards.scan();
    const outcomes = (await this.operations.storedOutcomes()).filter((row) => row.kind === "whitelist-change");
    for (const chain of chains) {
      const first = chain[0]!; const op = outcomes.find((row) => row.id === first.operationId && row.serverId === first.serverId);
      if (!op) throw recover();
      if (!this.operations.matchesWhitelistBinding(first.serverId, first.operationId, JSON.stringify(first.request), first.idempotencyHash)) throw recover();
      this.operations.requireTransactionRecovery(first.serverId, first.operationId);
      if (op.state === "succeeded") {
        try { await this.operations.verifyWhitelistOutcome(first.serverId, first.operationId, () => this.#verify(first.serverId, first.operationId), () => undefined); }
        catch { /* Keep the owned recovery cause; initialization never dispatches or repairs. */ }
      }
    }
    if (guards.some((guard) => !outcomes.some((op) => op.id === guard.operationId && op.serverId === guard.snapshot.serverId))) throw recover();
    for (const op of outcomes) if (!chains.some((chain) => chain[0]!.operationId === op.id && chain[0]!.serverId === op.serverId)) this.operations.requireTransactionRecovery(op.serverId, op.id);
    this.#assertOpen(); this.#ready = true;
    } finally { release(); }
  }
  async #verify(serverId: string, operationId: string, requireCurrent = false): Promise<void> {
    const chain = (await this.commands.scan()).find((rows) => rows[0]!.operationId === operationId && rows[0]!.serverId === serverId);
    if (!chain) throw recover(); const first = chain[0]!, head = chain.at(-1)!;
    if (!head.responseHash || !["response-recorded", "recovery-required"].includes(head.state)) throw recover();
    if (!this.operations.matchesWhitelistBinding(serverId, operationId, JSON.stringify(first.request), first.idempotencyHash)) throw recover();
    const guard = await this.guards.verify(operationId);
    if (guard.receiptHash !== first.guardReceiptHash || guard.snapshot.rootIdentity !== first.serverRootIdentity ||
      guard.snapshot.runtimeId !== first.runtimeId || guard.snapshot.serverId !== first.serverId || whitelistMemberRevision(guard.snapshot) !== first.request.revision) throw recover();
    if (await this.runtime.registeredRoot(serverId) !== first.serverRootIdentity) throw recover();
    const receipt = await this.runtime.receipt(head.responseHash), after = await this.runtime.recordedEvidence(head.responseHash);
    if (!after) throw recover();
    try {
      verifyWhitelistSourceBytes(after.snapshot, after.bytes);
      if (!receipt || receiptHash(receipt) !== head.responseHash || receipt.operationId !== operationId || receipt.serverId !== serverId ||
        receipt.runtimeId !== first.runtimeId || receipt.requestHash !== first.requestHash || receipt.beforeSha256 !== guard.snapshot.fileSha256 ||
        receipt.afterSha256 !== after.snapshot.fileSha256 || whitelistCommandHash(after.bytes) !== after.snapshot.fileSha256 ||
        compareWhitelistMemberEvidence(first.request, guard.snapshot, after.snapshot, after.runtimeNames) !== "consistent-change") throw recover();
      if (requireCurrent) {
        const current = await this.runtime.capture(serverId);
        try { verifyWhitelistSourceBytes(current.snapshot, current.bytes);
          if (whitelistMemberRevision(current.snapshot) !== whitelistMemberRevision(after.snapshot) ||
            JSON.stringify([...current.runtimeNames].sort()) !== JSON.stringify([...after.runtimeNames].sort())) throw recover();
        } finally { current.bytes.fill(0); }
      }
    } finally { after.bytes.fill(0); }
  }
  async submit(serverId: string, raw: unknown, key: string, admission: OperationAdmission): Promise<Operation> {
    this.#assertOpen(); if (!this.#ready) throw recover(); const request = parseWhitelistMemberIntent(raw);
    if (!keyPattern.test(key)) throw new DomainError(428, "PRECONDITION_REQUIRED", "成员操作需要 UUID 幂等键");
    // Common durable idempotency also covers failures before command intent exists.
    return this.operations.requestBackup(serverId, key.toLowerCase(), JSON.stringify(request), async (context) => {
      this.#assertOpen();
      let persisted = false;
      try {
        const capture = await this.runtime.capture(serverId);
        try {
          if (capture.snapshot.serverId !== serverId) throw recover(); validateWhitelistMemberIntent(request, capture.snapshot);
          const guard = await this.guards.create(context.operationId, capture.snapshot, capture.bytes);
          const timestamp = this.clock.now().toISOString();
          const record = await this.commands.admit({ schemaVersion: 1, sequence: 0, previousHash: null, operationId: context.operationId, serverId,
            idempotencyHash: whitelistCommandHash(key.toLowerCase()), requestHash: whitelistCommandRequestHash(serverId, request), request,
            serverRootIdentity: capture.snapshot.rootIdentity, runtimeId: capture.snapshot.runtimeId, guardReceiptHash: guard.receiptHash,
            state: "intent-persisted", responseHash: null, createdAt: timestamp, updatedAt: timestamp });
          if (record.operationId !== context.operationId) throw recover(); persisted = true;
        } finally { capture.bytes.fill(0); }
        const current = await this.runtime.capture(serverId);
        try { verifyWhitelistSourceBytes(current.snapshot, current.bytes);
          if (current.snapshot.serverId !== serverId || whitelistMemberRevision(current.snapshot) !== request.revision) throw recover(); }
        finally { current.bytes.fill(0); }
        const intent = await this.commands.append(context.operationId, "dispatch-intent", null, this.clock.now().toISOString());
        const receipt = await this.runtime.dispatch(intent, () => this.#assertOpen());
        await this.commands.append(context.operationId, "response-recorded", receiptHash(receipt), this.clock.now().toISOString());
        await this.#verify(serverId, context.operationId, true);
        await context.onResult?.({ resourceId: context.operationId, rollbackAvailable: false });
      } catch {
        if (persisted) { try { const head = (await this.commands.scan()).find((rows) => rows[0]!.operationId === context.operationId)?.at(-1);
          if (head && head.state !== "recovery-required") await this.commands.append(context.operationId, "recovery-required", head.responseHash, this.clock.now().toISOString());
        } catch { /* Durable dispatch/witness survives; common recovery remains closed. */ } }
        throw recover();
      }
    }, async () => {
      const capture = await this.runtime.capture(serverId);
      try { verifyWhitelistSourceBytes(capture.snapshot, capture.bytes);
        if (capture.snapshot.serverId !== serverId) throw recover(); validateWhitelistMemberIntent(request, capture.snapshot); }
      finally { capture.bytes.fill(0); }
    }, "whitelist-change", undefined, () => { this.#assertOpen(); return admission(); }, () => this.owner.beginActivity(this.commands.root));
  }
  async recover(serverId: string, operationId: string, admission: OperationAdmission): Promise<Operation> {
    if (!this.#ready) throw recover();
    this.#assertOpen(); const release = this.owner.beginActivity(this.commands.root);
    try { return await this.operations.verifyWhitelistOutcome(serverId, operationId, () => this.#verify(serverId, operationId),
      () => { this.#assertOpen(); return admission(); }, true); } finally { release(); }
  }
}
