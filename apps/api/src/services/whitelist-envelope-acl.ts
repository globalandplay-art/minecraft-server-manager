import type { ManagerLifetimeLock } from "../auth/manager-lifetime-lock.js";
import { WindowsPrivateAclVerifier } from "../auth/windows-private-acl.js";
import { WhitelistActionEnvelope, type WhitelistActionCapability } from "./whitelist-action-envelope.js";
import { WhitelistAclSession } from "./whitelist-acl-session.js";
import { WhitelistOwnedPublicationController, type WhitelistGuardPublication, type WhitelistGuardGroupedPublication, type WhitelistOwnedGuardAccess, type WhitelistPublicationTestDependencies } from "./whitelist-owned-publication.js";

type Owner = Pick<ManagerLifetimeLock, "assertHeld" | "rootIdentity" | "beginActivity" | "beginOfflineMutation" | "nativeAclChildWrapper">;
type Session = Pick<WhitelistAclSession, "query" | "close" | "closedConfirmed" | "healthyForRotation">;
type SessionFactory = (wrapper: (script: string) => string, now: () => number) => Session;
export interface WhitelistEnvelopeAcl {
  verify(file: string): Promise<string>;
  verifyMany(files: readonly string[]): Promise<string[]>;
  verifyNativeSnapshot(snapshot: unknown): string;
  quiesce(): Promise<void>;
}
export class WhitelistEnvelopeAclError extends Error {
  readonly code = "WHITELIST_ENVELOPE_ACL_UNSAFE";
  constructor() { super("WHITELIST_ENVELOPE_ACL_UNSAFE"); }
}
const unsafe = () => new WhitelistEnvelopeAclError();
interface Entry {
  session?: Session;
  startedAt: number;
  queries: number;
  outstanding: number;
  rawSettlement?: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
  tracked?: Promise<void>;
}

/** Private borrowed controller. It never acquires/releases the owner's lease. */
class Controller {
  #entry: Entry | undefined;
  #poisoned = false; #querying = false; #transitioning = false; #units = 0;
  readonly acl: WhitelistEnvelopeAcl;
  constructor(private readonly capability: WhitelistActionCapability,
    private readonly wrapper: (script: string) => string, private readonly factory: SessionFactory,
    private readonly revoke: () => void, private readonly workDeadline: number,
    private readonly now: () => number, private readonly unitLimit: number,
    private readonly verifier: WindowsPrivateAclVerifier) {
    this.acl = Object.freeze({ verify: async (file: string) => (await this.#query([file]))[0]!,
      verifyMany: (files: readonly string[]) => this.#query(files),
      verifyNativeSnapshot: (snapshot: unknown) => this.#snapshot(snapshot), quiesce: () => this.quiesce() });
  }
  poison(): void {
    this.#poisoned = true;
    this.#entry?.reject(unsafe());
    // Synchronous, trusted, private hook: even a caught pre-session failure revokes the envelope.
    this.revoke();
  }
  #fail(): never { this.poison(); throw unsafe(); }
  #gate(deadline = this.workDeadline, duringTransition = false): void {
    if (this.#poisoned || (!duringTransition && this.#transitioning) || this.now() >= deadline) this.#fail();
    try { this.capability.assertActive(); } catch { this.#fail(); }
    if (this.now() >= deadline) this.#fail();
  }
  #charge(): void { if (this.#units >= this.unitLimit) this.#fail(); this.#units++; }
  #snapshot(snapshot: unknown, deadline = this.workDeadline): string {
    this.#gate(deadline);
    let hash: string;
    try { hash = this.verifier.verifyNativeSnapshot(snapshot); } catch { this.#fail(); }
    this.#gate(deadline); return hash;
  }
  async #within<T>(task: Promise<T>, deadline: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observed = task.then((value) => value); void observed.catch(() => undefined);
    try {
      this.#gate(deadline, true);
      const value = await Promise.race([observed, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { this.poison(); reject(unsafe()); }, Math.max(1, deadline - this.now()));
      })]);
      this.#gate(deadline, true); return value;
    } finally { if (timer) clearTimeout(timer); }
  }
  #create(deadline: number): Entry {
    // The caller has already reserved both the query and new-child units.
    this.#gate(deadline);
    let resolve!: () => void, reject!: (error: unknown) => void;
    const result = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    void result.catch(() => undefined);
    const entry: Entry = { startedAt: this.now(), queries: 0, outstanding: 0, resolve, reject };
    const resource = {
      result,
      get closedConfirmed() { return entry.session?.closedConfirmed === true && entry.outstanding === 0; },
      drain: async (end: number) => {
        // Drain may run after revocation. It is close-only and never restores mutation admission.
        reject(unsafe());
        if (!entry.session) throw unsafe();
        try { await entry.session.close(end); } catch { /* Primary failure and physical drain are separate. */ }
        await entry.rawSettlement;
        if (entry.session.closedConfirmed !== true || entry.outstanding !== 0) throw unsafe();
      },
    };
    entry.tracked = this.capability.start(() => {
      // Registry admission precedes the trusted factory. A throw leaves creation unknown.
      this.#entry = entry;
      entry.session = this.factory(this.wrapper, this.now);
      return resource;
    });
    void entry.tracked.catch(() => undefined);
    if (!entry.session) this.#fail();
    this.#gate(deadline); return entry;
  }
  async #retire(deadline: number): Promise<void> {
    const entry = this.#entry;
    if (!entry) return;
    this.#gate(deadline);
    if (!entry.session?.healthyForRotation || entry.session.closedConfirmed || entry.outstanding !== 0) this.#fail();
    this.#gate(deadline);
    this.#transitioning = true;
    try {
      await this.#within(entry.session.close(Math.min(deadline, this.now() + 5000)), deadline);
      if (!entry.session.closedConfirmed || entry.outstanding !== 0 || this.now() - entry.startedAt >= 40_000) this.#fail();
      entry.resolve();
      await this.#within(entry.tracked!, deadline);
      this.#entry = undefined;
    } catch { this.#fail(); }
    finally { this.#transitioning = false; }
    this.#gate(deadline);
  }
  async #query(files: readonly string[]): Promise<string[]> {
    // One logical query budget includes rotation, close, startup and snapshot checks.
    const deadline = Math.min(this.workDeadline, this.now() + 5000);
    try {
      this.#gate(deadline);
      if (this.#querying || !Array.isArray(files) || files.length < 1 || files.length > 8 ||
        files.some((file) => typeof file !== "string" || file.length > 4096) ||
        new Set(files.map((file) => process.platform === "win32" ? file.toLowerCase() : file)).size !== files.length) this.#fail();
      this.#querying = true; this.#charge();
      let childReserved = false;
      if (!this.#entry || this.#entry.queries >= 32 || this.now() - this.#entry.startedAt >= 20_000) {
        this.#charge(); childReserved = true;
        if (this.#entry) await this.#retire(deadline);
      }
      this.#gate(deadline);
      let entry = this.#entry ?? this.#create(deadline);
      if (!entry.session!.healthyForRotation || entry.session!.closedConfirmed || this.now() - entry.startedAt >= 40_000) this.#fail();
      this.#gate(deadline);
      // Owner/health validation can synchronously cross the healthy-rotation threshold.
      // Reserve before retiring; there must be no callback/await between this fence and dispatch.
      if (entry.queries >= 32 || this.now() - entry.startedAt >= 20_000) {
        if (!childReserved) { this.#charge(); childReserved = true; }
        await this.#retire(deadline); entry = this.#create(deadline);
        if (!entry.session!.healthyForRotation || entry.session!.closedConfirmed) this.#fail();
        this.#gate(deadline);
        if (this.now() - entry.startedAt >= 20_000) this.#fail();
      }
      const session = entry.session!;
      entry.queries++; entry.outstanding++;
      let raw: Promise<unknown[]>;
      try { raw = session.query(files, deadline); } catch { entry.outstanding--; this.#fail(); }
      const settled = raw.then((rows) => { entry.outstanding--; return rows; }, () => { entry.outstanding--; throw unsafe(); });
      entry.rawSettlement = settled.then(() => undefined, () => undefined);
      const rows = await this.#within(settled, deadline);
      if (!Array.isArray(rows) || rows.length !== files.length) this.#fail();
      const hashes = rows.map((row) => this.#snapshot(row, deadline));
      this.#gate(deadline); return hashes;
    } catch { this.#fail(); }
    finally { this.#querying = false; }
  }
  async quiesce(): Promise<void> {
    try {
      this.#gate(); if (this.#querying) this.#fail();
      await this.#retire(Math.min(this.workDeadline, this.now() + 5000));
      this.#gate();
    } catch { this.#fail(); }
  }
}

/** UNWIRED ACL-only action. Sole real envelope, no store/Node I/O/publication/RCON wiring.
 * Constructor factory injection is trusted test composition only, never a request/env switch.
 */
export class WhitelistEnvelopeAclAction {
  readonly #envelope: WhitelistActionEnvelope;
  #verifier = new WindowsPrivateAclVerifier();
  constructor(private readonly owner: Owner, private readonly root: string,
    private readonly factory: SessionFactory = (wrapper, now) => new WhitelistAclSession(undefined, now, wrapper),
    private readonly now: () => number = () => performance.now(), private readonly unitLimit = 262_144,
    private readonly publicationTestDependencies?: WhitelistPublicationTestDependencies) {
    if (!Number.isSafeInteger(unitLimit) || unitLimit < 2 || unitLimit > 262_144) throw unsafe();
    this.#envelope = new WhitelistActionEnvelope(owner, root, now);
  }
  get diagnostic() { return this.#envelope.diagnostic; }
  /** Concrete-owner store composition. The SID pin never leaves this closure. */
  static guardStoreExecutor(owner: ManagerLifetimeLock, root: string,
    testDependencies?: { sessionFactory?: SessionFactory; publication?: WhitelistPublicationTestDependencies }, wide = false) {
    if (typeof wide !== "boolean") throw unsafe();
    const verifier = new WindowsPrivateAclVerifier(); let last: WhitelistEnvelopeAclAction | undefined;
    let running = false, poisoned = false;
    return Object.freeze({
      get diagnostic() { return last?.diagnostic; },
      run: async <T>(deadline: number, body: (access: WhitelistOwnedGuardAccess) => Promise<T>): Promise<T> => {
        if (poisoned || running) throw unsafe(); running = true;
        const action = new WhitelistEnvelopeAclAction(owner, root, testDependencies?.sessionFactory, undefined, undefined, testDependencies?.publication);
        action.#verifier = verifier; last = action;
        try { return await action.#runGuardStore(deadline, body, wide); }
        finally { if (action.diagnostic.phase === "retained") poisoned = true; running = false; }
      },
    });
  }
  run<T>(deadline: number, body: (acl: WhitelistEnvelopeAcl) => Promise<T>): Promise<T> {
    return this.#run(deadline, (_capability, controller) => { void _capability; return body(controller.acl); });
  }
  runPublication<T>(deadline: number, body: (publication: WhitelistGuardPublication) => Promise<T>): Promise<T> {
    return this.#run(deadline, async (capability, controller, wrapper) => {
      const publication = new WhitelistOwnedPublicationController(this.root, capability, controller.acl, wrapper,
        () => this.#envelope.cancel(), this.now, this.publicationTestDependencies);
      try { const value = await body(publication.facade); publication.finish(); return value; }
      catch { publication.poison(); throw unsafe(); }
    });
  }
  /** Trusted UNWIRED group component only; default Store/publication shape unchanged. */
  runGroupedPublication<T>(deadline: number, body: (publication: WhitelistGuardGroupedPublication) => Promise<T>): Promise<T> {
    return this.#run(deadline, async (capability, controller, wrapper) => {
      const publication = new WhitelistOwnedPublicationController(this.root, capability, controller.acl, wrapper,
        () => this.#envelope.cancel(), this.now, this.publicationTestDependencies);
      try { const value = await body(publication.groupedFacade); publication.finish(); return value; }
      catch { publication.poison(); throw unsafe(); }
    });
  }
  /** Separate trusted UNWIRED capacity candidate; original grouped entry remains <=8. */
  runWideGroupedPublication<T>(deadline: number, body: (publication: WhitelistGuardGroupedPublication) => Promise<T>): Promise<T> {
    return this.#run(deadline, async (capability, controller, wrapper) => {
      const publication = new WhitelistOwnedPublicationController(this.root, capability, controller.acl, wrapper,
        () => this.#envelope.cancel(), this.now, this.publicationTestDependencies, 16);
      try { const value = await body(publication.groupedFacade); publication.finish(); return value; }
      catch { publication.poison(); throw unsafe(); }
    });
  }
  #runGuardStore<T>(deadline: number, body: (access: WhitelistOwnedGuardAccess) => Promise<T>, wide = false): Promise<T> {
    return this.#run(deadline, async (capability, controller, wrapper) => {
      const publication = new WhitelistOwnedPublicationController(this.root, capability, controller.acl, wrapper,
        () => this.#envelope.cancel(), this.now, this.publicationTestDependencies, wide ? 16 : 8);
      try { const value = await body(wide ? publication.wideStorageFacade : publication.storageFacade); publication.finish(); return value; }
      catch { publication.poison(); throw unsafe(); }
    });
  }
  #run<T>(deadline: number, body: (capability: WhitelistActionCapability, controller: Controller,
    wrapper: (script: string) => string) => Promise<T>): Promise<T> {
    return this.#envelope.run(deadline, async (capability) => {
      let controller: Controller | undefined;
      try {
        capability.assertActive(); const wrapper = this.owner.nativeAclChildWrapper(this.root); capability.assertActive();
        controller = new Controller(capability, wrapper, this.factory, () => this.#envelope.cancel(), deadline, this.now, this.unitLimit, this.#verifier);
        const value = await body(capability, controller, wrapper);
        await controller.quiesce(); return value;
      } catch {
        controller?.poison(); this.#envelope.cancel(); throw unsafe();
      }
    });
  }
}
