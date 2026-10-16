import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import type { ManagerLifetimeLock } from "../auth/manager-lifetime-lock.js";
import { AuthCoreError } from "../auth/password.js";
import { WhitelistActionResources, type WhitelistActionResource } from "./whitelist-action-resources.js";

type Owner = Pick<ManagerLifetimeLock, "assertHeld" | "rootIdentity" | "beginActivity" | "beginOfflineMutation">;
type Primary = "busy" | "acquire" | "owner" | "context" | "deadline" | "body" | "resource" | "cancelled";
type Lease = "not-acquired" | "acquire-uncertain" | "held" | "released" | "release-uncertain";
type Phase = "idle" | "starting" | "running" | "draining" | "released" | "retained";
export class WhitelistActionEnvelopeError extends Error {
  constructor(readonly code: "WHITELIST_ACTION_UNSAFE" | "WHITELIST_ACTION_BUSY" | "CLEANUP_BLOCKED",
    readonly primary: Primary | null) { super(code); }
}
export interface WhitelistActionCapability {
  assertActive(): void;
  start<T>(factory: () => WhitelistActionResource<T>): Promise<T>;
}

/** UNWIRED one-shot owner/context envelope. Only constructor-injected Fake resources
 * are validated in this slice. No store, ACL/native factory, filesystem or RCON wiring.
 * A release callback that throws is uncertain, NOT proof the lease is still held.
 */
export class WhitelistActionEnvelope {
  readonly #context = new AsyncLocalStorage<symbol>();
  #used = false; #phase: Phase = "idle"; #accepting = false;
  #token: symbol | undefined; #identity: string | undefined; #workDeadline = 0;
  #primary: Primary | null = null; #cleanupDeadline: number | undefined;
  #activity: Lease = "not-acquired"; #mutation: Lease = "not-acquired";
  #releaseActivity: (() => void) | undefined; #releaseMutation: (() => void) | undefined;
  #resources: WhitelistActionResources | undefined;
  #bodySettled = true; #bodyTask: Promise<void> | undefined;
  #wake: (() => void) | undefined;
  constructor(private readonly owner: Owner, private readonly root: string,
    private readonly now: () => number = () => performance.now()) {
    if (!path.isAbsolute(root) || root !== path.resolve(root) || root.startsWith("\\\\") || root.startsWith("//") || root.includes("\0")) {
      throw new WhitelistActionEnvelopeError("WHITELIST_ACTION_UNSAFE", "owner");
    }
  }
  get diagnostic() {
    return { phase: this.#phase, primary: this.#primary, activity: this.#activity, mutation: this.#mutation,
      bodySettled: this.#bodySettled, resourceCount: this.#resources?.activeCount ?? 0 };
  }
  #revoke() {
    this.#cleanupDeadline ??= this.now() + 5000;
    this.#accepting = false;
  }
  #fail(reason: Primary) {
    this.#primary ??= reason;
    this.#revoke(); this.#wake?.();
  }
  #ownerIdentity() {
    this.owner.assertHeld(this.root);
    const identity = this.owner.rootIdentity();
    if (!/^[a-f0-9]{64}$/u.test(identity) || (this.#identity !== undefined && this.#identity !== identity)) throw new Error();
    return identity;
  }
  #assert(token: symbol) {
    if (this.#phase === "released" || this.#phase === "retained") {
      throw new WhitelistActionEnvelopeError("WHITELIST_ACTION_UNSAFE", this.#primary ?? "context");
    }
    let reason: Primary | undefined;
    if (this.#phase !== "running" || !this.#accepting || this.#primary || token !== this.#token || this.#context.getStore() !== token) reason = "context";
    else if (this.now() >= this.#workDeadline) reason = "deadline";
    else {
      try { this.#ownerIdentity(); } catch { reason = "owner"; }
      if (!reason && (this.now() >= this.#workDeadline || !this.#accepting || this.#primary)) reason = "deadline";
    }
    if (reason) { this.#fail(reason); throw new WhitelistActionEnvelopeError("WHITELIST_ACTION_UNSAFE", this.#primary); }
  }
  cancel(): void {
    if (this.#phase === "released" || this.#phase === "retained") return;
    this.#used = true; this.#fail("cancelled");
  }
  /** Required trusted monotonic absolute deadline. Does not alter primitive timeouts. */
  async run<T>(deadline: number, body: (capability: WhitelistActionCapability) => Promise<T>): Promise<T> {
    if (this.#used) throw new WhitelistActionEnvelopeError("WHITELIST_ACTION_UNSAFE", this.#primary);
    this.#used = true;
    const remaining = deadline - this.now();
    // Bound Node timer input without introducing an unbounded caller-controlled wait.
    if (!Number.isFinite(deadline) || remaining <= 0 || remaining > 2_147_483_647) {
      this.#fail("deadline"); throw new WhitelistActionEnvelopeError("WHITELIST_ACTION_UNSAFE", this.#primary);
    }
    this.#workDeadline = deadline; this.#phase = "starting";
    const wake = new Promise<void>((resolve) => { this.#wake = resolve; });
    let timer: ReturnType<typeof setTimeout> | undefined, value: T | undefined;
    this.#resources = new WhitelistActionResources(() => this.#assert(this.#token!), () => {
      if (this.#resources?.failed) this.#fail("resource"); else this.#revoke();
    }, this.now);
    try {
      this.#identity = this.#ownerIdentity();
      if (this.now() >= deadline || this.#primary) { this.#fail("deadline"); throw new Error(); }
      this.#activity = "acquire-uncertain";
      this.#releaseActivity = this.owner.beginActivity(this.root);
      if (typeof this.#releaseActivity !== "function") throw new Error();
      this.#activity = "held";
      if (this.now() >= deadline || this.#primary) { this.#fail("deadline"); throw new Error(); }
      this.#ownerIdentity();
      if (this.now() >= deadline || this.#primary) { this.#fail("deadline"); throw new Error(); }
      this.#mutation = "acquire-uncertain";
      try { this.#releaseMutation = this.owner.beginOfflineMutation(this.root); }
      catch (error) {
        // This exact owner API reserves AUTH_BUSY for refusal BEFORE acquisition.
        if (error instanceof AuthCoreError && error.code === "AUTH_BUSY") { this.#mutation = "not-acquired"; this.#fail("busy"); }
        throw new Error();
      }
      if (typeof this.#releaseMutation !== "function") throw new Error();
      this.#mutation = "held";
      if (this.now() >= deadline || this.#primary) { this.#fail("deadline"); throw new Error(); }
      this.#ownerIdentity();
      if (this.now() >= deadline || this.#primary) { this.#fail("deadline"); throw new Error(); }
      const token = Symbol("whitelist-owned-action"); this.#token = token; this.#accepting = true; this.#phase = "running";
      const resources = this.#resources;
      const capability: WhitelistActionCapability = Object.freeze({ assertActive: () => this.#assert(token),
        start: <R>(factory: () => WhitelistActionResource<R>) => resources.start(factory) });
      timer = setTimeout(() => this.#fail("deadline"), Math.max(1, deadline - this.now()));
      this.#bodySettled = false;
      this.#bodyTask = this.#context.run(token, () => {
        let task: Promise<T>;
        try { task = Promise.resolve(body(capability)); } catch { task = Promise.reject(new Error()); }
        return task.then((result) => {
          this.#bodySettled = true;
          if (this.#primary) return;
          try { this.#assert(token); value = result; } catch { /* Fixed primary already recorded. */ }
        }, () => { this.#bodySettled = true; this.#fail("body"); });
      });
      await Promise.race([this.#bodyTask, wake]);
    } catch { this.#fail(this.#primary ?? "acquire"); }
    finally { if (timer) clearTimeout(timer); }
    const cleaned = await this.#finish();
    if (!cleaned) throw new WhitelistActionEnvelopeError("CLEANUP_BLOCKED", this.#primary);
    if (this.#primary) throw new WhitelistActionEnvelopeError(this.#primary === "busy" ? "WHITELIST_ACTION_BUSY" : "WHITELIST_ACTION_UNSAFE", this.#primary);
    return value as T;
  }
  async #finish(): Promise<boolean> {
    this.#revoke(); this.#phase = "draining"; this.#token = undefined;
    const deadline = this.#cleanupDeadline!;
    const resourceDrain = this.#resources!.drain(deadline);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const observed = Promise.allSettled([this.#bodyTask ?? Promise.resolve(), resourceDrain]);
      if (this.now() >= deadline) { void observed; throw new Error(); }
      const results = await Promise.race([observed, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error()), Math.max(1, deadline - this.now()));
      })]);
      if (this.now() >= deadline || !this.#bodySettled || results.some((row) => row.status !== "fulfilled") ||
        this.#activity === "acquire-uncertain" || this.#mutation === "acquire-uncertain") throw new Error();
      this.#ownerIdentity();
      if (this.now() >= deadline) throw new Error();
      if (this.#mutation === "held") {
        this.#mutation = "release-uncertain";
        this.#releaseMutation!(); this.#mutation = "released";
      }
      if (this.now() >= deadline) throw new Error();
      this.#ownerIdentity();
      if (this.now() >= deadline) throw new Error();
      if (this.#activity === "held") {
        this.#activity = "release-uncertain";
        this.#releaseActivity!(); this.#activity = "released";
      }
      if (this.now() >= deadline) throw new Error();
      this.#phase = "released"; return true;
    } catch { this.#phase = "retained"; return false; }
    finally { if (timer) clearTimeout(timer); }
  }
}
