import { AsyncLocalStorage } from "node:async_hooks";
import type { ManagerLifetimeLock } from "../auth/manager-lifetime-lock.js";
import { AuthCoreError } from "../auth/password.js";
import { WindowsPrivateAclVerifier } from "../auth/windows-private-acl.js";
import { WhitelistAclSession } from "./whitelist-acl-session.js";

type Owner = Pick<ManagerLifetimeLock, "assertHeld" | "rootIdentity" | "beginOfflineMutation"> &
  Partial<Pick<ManagerLifetimeLock, "nativeAclChildWrapper">>;
export type WhitelistAclScopeSession = Pick<WhitelistAclSession, "query" | "close" | "closedConfirmed" | "healthyForRotation">;
export type WhitelistScopedAcl = WindowsPrivateAclVerifier & { quiesce(): Promise<void> };
interface CloseEvidence { closed: boolean; failed: boolean }
export class WhitelistAclScopeError extends Error {
  constructor(readonly code: "WHITELIST_ACL_SCOPE_BUSY" | "WHITELIST_ACL_SCOPE_UNSAFE" | "CLEANUP_BLOCKED",
    readonly primaryFailed = false) { super(code); }
}
const unsafe = () => new WhitelistAclScopeError("WHITELIST_ACL_SCOPE_UNSAFE");

/** Dedicated healthy-rotation capability; default GuardStore uses it for real owners.
 * No retry or replacement of failed children. Default auth verifier remains unchanged.
 * Factory is trusted constructor injection only; never from a request or environment switch. */
export class WhitelistAclScope {
  readonly #verifier = new WindowsPrivateAclVerifier();
  #entered = false; #poisoned = false; #querying = false; #creationUncertain = false;
  readonly #context = new AsyncLocalStorage<symbol>();
  #token: symbol | undefined; #accepting = false;
  #session: WhitelistAclScopeSession | undefined;
  #closeTask: Promise<CloseEvidence> | undefined; #transitioning = false;
  #childQueries = 0; #childStartedAt = 0; #units = 0; #outstanding = 0;
  constructor(private readonly owner: Owner, private readonly root: string,
    private readonly factory: () => WhitelistAclScopeSession = () => {
      if (!owner.nativeAclChildWrapper) throw unsafe();
      return new WhitelistAclSession(undefined, undefined, owner.nativeAclChildWrapper(root));
    },
    private readonly now: () => number = () => performance.now(), private readonly unitLimit = 262_144) {
    if (!Number.isSafeInteger(unitLimit) || unitLimit < 2 || unitLimit > 262_144) throw unsafe();
  }

  #authorize(token: symbol): void {
    if (!this.#entered || !this.#accepting || this.#poisoned || this.#transitioning || token !== this.#token || this.#context.getStore() !== token) throw unsafe();
    try { this.owner.assertHeld(this.root); } catch { throw unsafe(); }
  }
  #snapshot(snapshot: unknown, token: symbol): string {
    this.#authorize(token);
    try { return this.#verifier.verifyNativeSnapshot(snapshot); }
    catch { this.#poisoned = true; throw unsafe(); }
  }

  #charge(units: number): void {
    if (this.#units + units > this.unitLimit) { this.#poisoned = true; throw unsafe(); }
    this.#units += units;
  }
  #assertTime(deadline: number): void {
    if (!Number.isFinite(deadline) || this.now() >= deadline) { this.#poisoned = true; throw unsafe(); }
  }
  async #within<T>(work: Promise<T>, deadline: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Observe a pre-existing transition even if the deadline has already expired.
    const observed = work.then((value) => value);
    try {
      const remaining = deadline - this.now();
      if (remaining <= 0) { void observed.catch(() => undefined); this.#assertTime(deadline); }
      const value = await Promise.race([observed, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { this.#poisoned = true; reject(unsafe()); }, Math.max(1, remaining));
      })]);
      this.#assertTime(deadline); return value;
    } finally { if (timer) clearTimeout(timer); }
  }
  #closeCurrent(): Promise<CloseEvidence> {
    if (this.#closeTask) return this.#closeTask;
    const current = this.#session;
    if (!current) return Promise.resolve({ closed: !this.#creationUncertain, failed: this.#creationUncertain });
    this.#transitioning = true;
    this.#closeTask = (async () => {
      const started = this.now();
      let failed = false, closed = false, timer: ReturnType<typeof setTimeout> | undefined;
      if (started - this.#childStartedAt >= 40_000) { this.#poisoned = true; failed = true; }
      try {
        await Promise.race([Promise.resolve().then(() => current.close()), new Promise<never>((_, reject) => {
          timer = setTimeout(() => { this.#poisoned = true; reject(unsafe()); }, 5000);
        })]);
      } catch { failed = true; }
      finally { if (timer) clearTimeout(timer); }
      if (this.now() - started >= 5000) failed = true;
      if (this.now() - this.#childStartedAt >= 40_000) { this.#poisoned = true; failed = true; }
      try { closed = current.closedConfirmed === true; } catch { /* Unknown is not close proof. */ }
      return { closed, failed };
    })().finally(() => { this.#transitioning = false; });
    return this.#closeTask;
  }
  async #retire(token: symbol, deadline?: number): Promise<void> {
    this.#authorize(token);
    if (!this.#session) return;
    if (!this.#session.healthyForRotation || this.#session.closedConfirmed) throw unsafe();
    const task = this.#closeCurrent(), result = deadline === undefined ? await task : await this.#within(task, deadline);
    this.#authorize(token);
    if (!result.closed || result.failed || this.now() - this.#childStartedAt >= 40_000) throw unsafe();
    this.#session = undefined; this.#closeTask = undefined; this.#childQueries = 0; this.#childStartedAt = 0;
  }
  async #quiesce(token: symbol): Promise<void> {
    this.#authorize(token);
    if (this.#querying) { this.#poisoned = true; throw unsafe(); }
    try { await this.#retire(token); }
    catch { this.#poisoned = true; throw unsafe(); }
  }
  async #query(files: readonly string[], token: symbol): Promise<string[]> {
    const deadline = this.now() + 5000;
    this.#authorize(token);
    if (this.#querying) { this.#poisoned = true; throw unsafe(); }
    if (files.length < 1 || files.length > 8 ||
      files.some((file) => typeof file !== "string" || file.length > 4096) ||
      new Set(files.map((file) => process.platform === "win32" ? file.toLowerCase() : file)).size !== files.length) throw unsafe();
    this.#querying = true;
    try {
      this.owner.assertHeld(this.root);
      const rotates = !!this.#session && (this.#childQueries >= 32 || this.now() - this.#childStartedAt >= 20_000);
      let childCharged = !this.#session || rotates;
      this.#charge(childCharged ? 2 : 1); // Query plus known new-child reservation, under exclusion.
      if (this.#session && (!this.#session.healthyForRotation || this.#session.closedConfirmed)) throw unsafe();
      if (rotates) await this.#retire(token, deadline);
      this.#assertTime(deadline); this.#authorize(token);
      // A threshold may have crossed during synchronous validation; reserve before retiring/starting.
      if (this.#session && (this.#childQueries >= 32 || this.now() - this.#childStartedAt >= 20_000)) {
        this.#charge(1); childCharged = true; await this.#retire(token, deadline);
      }
      this.#assertTime(deadline); this.#authorize(token);
      if (!this.#session) {
        if (!childCharged) this.#charge(1);
        this.#creationUncertain = true;
        this.#session = this.factory();
        this.#creationUncertain = false;
        this.#childStartedAt = this.now(); this.#childQueries = 0;
      }
      this.#assertTime(deadline); this.#authorize(token);
      if (!this.#session.healthyForRotation || this.#session.closedConfirmed || this.now() - this.#childStartedAt >= 40_000) throw unsafe();
      this.#childQueries++; this.#outstanding++;
      let raw: Promise<unknown[]>;
      try { raw = this.#session.query(files, deadline); }
      catch (error) { this.#outstanding--; throw error; }
      const settled = raw.then((value) => { this.#outstanding--; return value; }, (error: unknown) => { this.#outstanding--; throw error; });
      const snapshots = await this.#within(settled, deadline);
      this.#authorize(token);
      if (!Array.isArray(snapshots) || snapshots.length !== files.length) throw unsafe();
      const result = snapshots.map((snapshot) => this.#snapshot(snapshot, token)); this.#assertTime(deadline); return result;
    } catch { this.#poisoned = true; throw unsafe(); }
    finally { this.#querying = false; }
  }

  async run<T>(action: (acl: WhitelistScopedAcl) => Promise<T>): Promise<T> {
    if (this.#poisoned) throw unsafe();
    if (this.#entered) throw new WhitelistAclScopeError("WHITELIST_ACL_SCOPE_BUSY");
    let release: () => void, identity: string;
    try {
      this.owner.assertHeld(this.root); identity = this.owner.rootIdentity();
      release = this.owner.beginOfflineMutation(this.root);
    } catch (error) {
      if (error instanceof AuthCoreError && error.code === "AUTH_BUSY") throw new WhitelistAclScopeError("WHITELIST_ACL_SCOPE_BUSY");
      throw unsafe();
    }
    this.#entered = true;
    this.#units = 0;
    const token = Symbol("whitelist-acl-action"); this.#token = token; this.#accepting = true;
    const query = (files: readonly string[]) => this.#query(files, token);
    const inspect = (snapshot: unknown) => this.#snapshot(snapshot, token);
    const quiesce = () => this.#quiesce(token);
    // Each action receives a distinct capability, not the reusable runner/verifier.
    class ActionAcl extends WindowsPrivateAclVerifier {
      override async verify(file: string) { return (await query([file]))[0]!; }
      override verifyMany(files: readonly string[]) { return query(files); }
      override verifyNativeSnapshot(snapshot: unknown) { return inspect(snapshot); }
      quiesce() { return quiesce(); }
    }
    let result: T | undefined, primary: unknown, primaryFailed = false, closeFailed = false;
    try { result = await this.#context.run(token, () => action(new ActionAcl())); }
    catch (error) { primaryFailed = true; primary = error; }
    this.#accepting = false; this.#token = undefined;
    if (this.#querying || this.#transitioning) this.#poisoned = true;

    // A factory failure might have created a child before throwing. Absence is not inferred.
    const evidence = await this.#closeCurrent(); closeFailed ||= evidence.failed;
    if (!evidence.closed || this.#querying || this.#outstanding > 0 || this.#transitioning) {
      this.#poisoned = true;
      // Deliberately retain the owner's mutation lease. No guessed release or next scope.
      throw new WhitelistAclScopeError("CLEANUP_BLOCKED", primaryFailed);
    }
    this.#session = undefined; this.#closeTask = undefined; this.#entered = false;
    try { this.owner.assertHeld(this.root); if (this.owner.rootIdentity() !== identity) throw unsafe(); }
    catch { this.#poisoned = true; closeFailed = true; }
    try { release(); } catch { this.#poisoned = true; throw new WhitelistAclScopeError("CLEANUP_BLOCKED", primaryFailed); }
    if (closeFailed || this.#poisoned) { this.#poisoned = true; throw new WhitelistAclScopeError("WHITELIST_ACL_SCOPE_UNSAFE", primaryFailed); }
    if (primaryFailed) throw primary;
    return result as T;
  }
}
