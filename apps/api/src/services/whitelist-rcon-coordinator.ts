import type { Operation } from "@mcsm/contracts";
import type { Clock } from "../clock.js";
import type { ManagerLifetimeLock } from "../auth/manager-lifetime-lock.js";
import type { WhitelistRconSession } from "../infra/runtime-contract.js";
import { DomainError } from "./domain-errors.js";
import type { OperationAdmission, OperationService } from "./operation-service.js";
import type { WhitelistCommandStore } from "./whitelist-command-store.js";
import { whitelistCommandHash, whitelistCommandRequestHash, whitelistRconEvidenceHash,
  type WhitelistCommandRecord, type WhitelistRconEvidence } from "./whitelist-command-record.js";
import { verifyWhitelistSourceBytes, type WhitelistGuardStore } from "./whitelist-guard-store.js";
import { compareWhitelistMemberEvidence, parseWhitelistMemberIntent, validateWhitelistMemberIntent,
  whitelistMemberRevision, type WhitelistMemberIntent, type WhitelistMemberSnapshot } from "./whitelist-member-policy.js";

type Capture = { snapshot: WhitelistMemberSnapshot; bytes: Buffer };
/** Trusted construction only. A production implementation must prove the exact
 * registered root/owned child/RCON endpoint binding, not just a reachable port. */
export interface WhitelistRconObservations {
  registeredRoot(serverId: string): Promise<string | null>;
  open(serverId: string): Promise<WhitelistRconSession>;
  capture(serverId: string, session: WhitelistRconSession): Promise<Capture>;
}
/** No default rules: real Vanilla responses/persistence require separate acceptance.
 * Test construction can supply Fake rules; no HTTP/env switch can install them. */
export interface WhitelistRconRules {
  readonly id: "vanilla-26.3-rcon-v1";
  parseList(response: string): string[];
  verifyMutation(request: WhitelistMemberIntent, response: string, after: WhitelistMemberSnapshot): void;
}
type Owner = Pick<ManagerLifetimeLock, "assertHeld" | "rootIdentity" | "beginOfflineMutation" | "beginActivity">;
const uncertain = () => new DomainError(409, "RECOVERY_REQUIRED", "白名单结果无法完整确认，证据已保留且不会自动重发", "whitelist-rcon-uncertain", true);
const keyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
export function whitelistAfterGuardId(operationId: string): string {
  if (!keyPattern.test(operationId)) throw uncertain();
  const h = whitelistCommandHash(`whitelist-rcon-after-guard-v1:${operationId.toLowerCase()}`);
  const result = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  if (result === operationId.toLowerCase()) throw uncertain(); return result;
}
function namesHash(names: readonly string[]): string {
  if (!Array.isArray(names) || names.length > 1000 || names.some(name => typeof name !== "string" || !/^[A-Za-z0-9_]{3,16}$/u.test(name))) throw uncertain();
  const normalized = names.map(name => name.toLowerCase()).sort();
  if (new Set(normalized).size !== normalized.length) throw uncertain();
  return whitelistCommandHash(JSON.stringify(normalized));
}

/** Online business composition; no production app import until endpoint/rules
 * gates pass. No generic Console dispatch, new writer, retries or lifecycle. */
export class WhitelistRconCoordinator {
  #ready = false;
  constructor(readonly operations: OperationService, readonly commands: WhitelistCommandStore, readonly guards: WhitelistGuardStore,
    readonly runtime: WhitelistRconObservations, readonly rules: WhitelistRconRules, readonly clock: Clock, readonly owner: Owner) {
    if (owner !== commands.owner || owner !== guards.owner || commands.root !== guards.root || rules.id !== "vanilla-26.3-rcon-v1") throw uncertain();
  }
  close(): void { this.#ready = false; }
  #assert(): void { this.owner.assertHeld(this.commands.root); if (!this.#ready) throw uncertain(); }
  #names(response: string): string[] {
    const parsed: unknown = this.rules.parseList(response);
    if (!Array.isArray(parsed)) { void Promise.resolve(parsed).catch(() => undefined); throw uncertain(); }
    namesHash(parsed as string[]); return parsed as string[];
  }
  #response(request: WhitelistMemberIntent, response: string, after: WhitelistMemberSnapshot): void {
    const result: unknown = this.rules.verifyMutation(request, response, after);
    if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw uncertain(); }
  }
  async initialize(): Promise<void> {
    this.#ready = false; this.owner.assertHeld(this.commands.root);
    const release = this.owner.beginActivity(this.commands.root);
    try {
      const chains = await this.commands.scan(), guards = await this.guards.scan();
      const outcomes = (await this.operations.storedOutcomes()).filter(op => op.kind === "whitelist-change");
      for (const chain of chains) {
        const first = chain[0]!, op = outcomes.find(row => row.id === first.operationId && row.serverId === first.serverId);
        if (!op || !this.operations.matchesWhitelistBinding(first.serverId, first.operationId, JSON.stringify(first.request), first.idempotencyHash)) throw uncertain();
        this.operations.requireTransactionRecovery(first.serverId, first.operationId);
        if (op.state === "succeeded") {
          try { await this.operations.verifyWhitelistOutcome(first.serverId, first.operationId, () => this.#verify(first.serverId, first.operationId), () => undefined); }
          catch { /* Never replace missing historical evidence with current membership. */ }
        }
      }
      for (const guard of guards) {
        const beforeOwner = outcomes.some(op => op.id === guard.operationId && op.serverId === guard.snapshot.serverId);
        const afterOwner = chains.some(chain => chain[0]!.serverId === guard.snapshot.serverId &&
          whitelistAfterGuardId(chain[0]!.operationId) === guard.operationId);
        if (!beforeOwner && !afterOwner) throw uncertain();
      }
      for (const op of outcomes) if (!chains.some(chain => chain[0]!.operationId === op.id)) this.operations.requireTransactionRecovery(op.serverId, op.id);
      this.#ready = true;
    } finally { release(); }
  }
  async #verify(serverId: string, operationId: string): Promise<void> {
    const chain = (await this.commands.scan()).find(rows => rows[0]!.operationId === operationId && rows[0]!.serverId === serverId);
    const first = chain?.[0], head = chain?.at(-1), evidence = head?.rconEvidence;
    if (!first || !head || !evidence || !["response-recorded", "recovery-required"].includes(head.state) || evidence.rulesId !== this.rules.id ||
      evidence.afterGuardId !== whitelistAfterGuardId(operationId) || head.responseHash !== whitelistRconEvidenceHash(first, evidence) ||
      !this.operations.matchesWhitelistBinding(serverId, operationId, JSON.stringify(first.request), first.idempotencyHash)) throw uncertain();
    const before = await this.guards.verify(operationId), after = await this.guards.verify(evidence.afterGuardId);
    if (before.receiptHash !== first.guardReceiptHash || after.receiptHash !== evidence.afterGuardReceiptHash ||
      before.snapshot.serverId !== serverId || before.snapshot.runtimeId !== first.runtimeId ||
      before.snapshot.rootIdentity !== first.serverRootIdentity || whitelistMemberRevision(before.snapshot) !== first.request.revision ||
      await this.runtime.registeredRoot(serverId) !== first.serverRootIdentity ||
      namesHash(after.snapshot.members.map(row => row.name)) !== evidence.runtimeNamesHash ||
      compareWhitelistMemberEvidence(first.request, before.snapshot, after.snapshot, after.snapshot.members.map(row => row.name)) !== "consistent-change") throw uncertain();
    this.#response(first.request, evidence.response, after.snapshot);
  }
  /** Caller holds OperationService.runExclusive. Returns safe hashes/membership,
   * never paths, credentials or a transferable dispatch permit. */
  async prepare(serverId: string): Promise<WhitelistMemberSnapshot> {
    this.#assert(); const session = await this.runtime.open(serverId);
    try {
      const capture = await this.runtime.capture(serverId, session);
      try {
        verifyWhitelistSourceBytes(capture.snapshot, capture.bytes);
        if (capture.snapshot.serverId !== serverId || capture.snapshot.runtimeId !== session.runtimeId ||
          capture.snapshot.rootIdentity !== await this.runtime.registeredRoot(serverId) ||
          namesHash(this.#names(await session.list())) !== namesHash(capture.snapshot.members.map(row => row.name))) throw uncertain();
        const confirmed = await this.runtime.capture(serverId, session);
        try {
          verifyWhitelistSourceBytes(confirmed.snapshot, confirmed.bytes);
          if (whitelistMemberRevision(capture.snapshot) !== whitelistMemberRevision(confirmed.snapshot)) throw uncertain();
          return structuredClone(confirmed.snapshot);
        } finally { confirmed.bytes.fill(0); }
      } finally { capture.bytes.fill(0); }
    } finally { session.close(); }
  }
  async submit(serverId: string, raw: unknown, key: string, admission: OperationAdmission): Promise<Operation> {
    this.#assert(); const request = parseWhitelistMemberIntent(raw);
    if (!keyPattern.test(key)) throw new DomainError(428, "PRECONDITION_REQUIRED", "白名单操作需要 UUID 幂等键");
    return this.operations.requestBackup(serverId, key.toLowerCase(), JSON.stringify(request), async context => {
      let session: WhitelistRconSession | undefined, persisted = false;
      try {
        this.#assert(); session = await this.runtime.open(serverId);
        const before = await this.runtime.capture(serverId, session);
        let first: WhitelistCommandRecord;
        try {
          verifyWhitelistSourceBytes(before.snapshot, before.bytes);
          if (before.snapshot.serverId !== serverId || before.snapshot.runtimeId !== session.runtimeId ||
            await this.runtime.registeredRoot(serverId) !== before.snapshot.rootIdentity) throw uncertain();
          validateWhitelistMemberIntent(request, before.snapshot);
          // Two retained guards are needed. Reject a known exhausted budget before send.
          if ((await this.guards.scan()).length > 998) throw uncertain();
          const guard = await this.guards.create(context.operationId, before.snapshot, before.bytes);
          const now = this.clock.now().toISOString();
          first = await this.commands.admit({ schemaVersion: 1, sequence: 0, previousHash: null, operationId: context.operationId, serverId,
            idempotencyHash: whitelistCommandHash(key.toLowerCase()), requestHash: whitelistCommandRequestHash(serverId, request), request,
            serverRootIdentity: before.snapshot.rootIdentity, runtimeId: session.runtimeId, guardReceiptHash: guard.receiptHash,
            state: "intent-persisted", responseHash: null, createdAt: now, updatedAt: now });
          if (first.operationId !== context.operationId || first.state !== "intent-persisted") throw uncertain();
          persisted = true;
        } finally { before.bytes.fill(0); }
        await this.commands.append(context.operationId, "dispatch-intent", null, this.clock.now().toISOString());
        const fresh = await this.runtime.capture(serverId, session);
        try {
          verifyWhitelistSourceBytes(fresh.snapshot, fresh.bytes);
          if (whitelistMemberRevision(fresh.snapshot) !== request.revision) throw uncertain();
        } finally { fresh.bytes.fill(0); }
        const response = await session[request.action](request.name, () => { this.#assert(); return admission(); });
        if (!response || response.length > 512) throw uncertain();
        const after = await this.runtime.capture(serverId, session);
        try {
          verifyWhitelistSourceBytes(after.snapshot, after.bytes);
          const names = this.#names(await session.list());
          const confirmed = await this.runtime.capture(serverId, session);
          try {
          verifyWhitelistSourceBytes(confirmed.snapshot, confirmed.bytes);
          if (whitelistMemberRevision(after.snapshot) !== whitelistMemberRevision(confirmed.snapshot) ||
            compareWhitelistMemberEvidence(request, before.snapshot, confirmed.snapshot, names) !== "consistent-change") throw uncertain();
          this.#response(request, response, confirmed.snapshot);
          const afterGuardId = whitelistAfterGuardId(context.operationId), guard = await this.guards.create(afterGuardId, confirmed.snapshot, confirmed.bytes);
          const evidence: WhitelistRconEvidence = { rulesId: this.rules.id, response, runtimeNamesHash: namesHash(names),
            afterGuardId, afterGuardReceiptHash: guard.receiptHash };
          await this.commands.append(context.operationId, "response-recorded", whitelistRconEvidenceHash(first, evidence), this.clock.now().toISOString(), evidence);
          await this.#verify(serverId, context.operationId);
          await context.onResult?.({ resourceId: context.operationId, rollbackAvailable: false });
          } finally { confirmed.bytes.fill(0); }
        } finally { after.bytes.fill(0); }
      } catch {
        if (persisted) {
          try { const head = (await this.commands.scan()).find(rows => rows[0]!.operationId === context.operationId)?.at(-1);
            if (head && head.state !== "recovery-required") await this.commands.append(context.operationId, "recovery-required", head.responseHash, this.clock.now().toISOString());
          } catch { /* Keep original intent/witness; OperationService retains recovery. */ }
        }
        throw uncertain();
      } finally { session?.close(); }
    }, async () => {
      const session = await this.runtime.open(serverId);
      try { const capture = await this.runtime.capture(serverId, session);
        try { verifyWhitelistSourceBytes(capture.snapshot, capture.bytes);
          if (capture.snapshot.serverId !== serverId || capture.snapshot.runtimeId !== session.runtimeId) throw uncertain();
          validateWhitelistMemberIntent(request, capture.snapshot); }
        finally { capture.bytes.fill(0); }
      } finally { session.close(); }
    }, "whitelist-change", undefined, () => { this.#assert(); return admission(); }, () => this.owner.beginActivity(this.commands.root));
  }
  async recover(serverId: string, operationId: string, admission: OperationAdmission): Promise<Operation> {
    this.#assert(); const release = this.owner.beginActivity(this.commands.root);
    try { return await this.operations.verifyWhitelistOutcome(serverId, operationId, () => this.#verify(serverId, operationId),
      () => { this.#assert(); return admission(); }, true); }
    finally { release(); }
  }
}
