/** UNWIRED resource-accounting core. No owner acquisition, filesystem or native factory.
 * Constructor capabilities are internal/Fake only until whole-action integration review.
 */
export interface WhitelistActionResource<T> {
  result: Promise<T>;
  readonly closedConfirmed: boolean;
  drain(deadline: number): Promise<void>;
}
export class WhitelistActionResourceError extends Error {
  constructor(readonly code: "WHITELIST_ACTION_UNSAFE" | "CLEANUP_BLOCKED") { super(code); }
}
interface Entry { resource?: WhitelistActionResource<unknown>; settled: boolean; settlement?: Promise<void> }
const unsafe = () => new WhitelistActionResourceError("WHITELIST_ACTION_UNSAFE");
const blocked = () => new WhitelistActionResourceError("CLEANUP_BLOCKED");

export class WhitelistActionResources {
  readonly #entries = new Set<Entry>();
  #sealed = false; #failed = false; #revocationFailed = false; #attempts = 0;
  #drainTask: Promise<void> | undefined;
  constructor(private readonly assertActive: () => void, private readonly revoke: () => void,
    private readonly now: () => number = () => performance.now(), private readonly activeLimit = 8) {
    if (!Number.isSafeInteger(activeLimit) || activeLimit < 1 || activeLimit > 8) throw unsafe();
  }
  get failed(): boolean { return this.#failed; }
  get activeCount(): number { return this.#entries.size; }
  #stop(failed: boolean) {
    this.#failed ||= failed;
    if (this.#sealed) return;
    this.#sealed = true;
    try { this.revoke(); } catch { this.#revocationFailed = true; this.#failed = true; }
  }
  #retire(entry: Entry) {
    try { if (entry.settled && entry.resource?.closedConfirmed === true) this.#entries.delete(entry); }
    catch { this.#stop(true); }
  }
  /** Register BEFORE invoking trusted work. A throw leaves a permanent unknown entry. */
  start<T>(factory: () => WhitelistActionResource<T>): Promise<T> {
    if (this.#sealed || this.#failed) return Promise.reject(unsafe());
    try { this.assertActive(); } catch { this.#stop(true); return Promise.reject(unsafe()); }
    if (this.#entries.size >= this.activeLimit || this.#attempts >= 262_144) {
      this.#stop(true); return Promise.reject(unsafe());
    }
    const entry: Entry = { settled: false }; this.#entries.add(entry); this.#attempts++;
    let resource: WhitelistActionResource<T>;
    try { resource = factory(); entry.resource = resource; }
    catch { this.#stop(true); return Promise.reject(unsafe()); }
    const result = Promise.resolve().then(() => resource.result).then((value) => {
      entry.settled = true; this.#retire(entry);
      if (this.#failed) throw unsafe();
      try { this.assertActive(); } catch { this.#stop(true); throw unsafe(); }
      return value;
    }, () => { entry.settled = true; this.#stop(true); this.#retire(entry); throw unsafe(); });
    entry.settlement = result.then(() => undefined, () => undefined);
    return result;
  }
  /** Body must seal before cleanup. Pending work makes the primary result unsafe. */
  seal(): boolean {
    const pending = this.#entries.size !== 0;
    this.#stop(pending);
    return !this.#failed;
  }
  /** Drain proof only. Caller must separately require primary success and owner identity.
   * Any unknown creation/close/unsettled work retains the outer owner's lease.
   */
  drain(deadline?: number): Promise<void> {
    if (this.#drainTask) return this.#drainTask;
    const started = this.now(), ownDeadline = started + 5000;
    // The outer action may shorten this budget, never restart/extend its cleanup.
    const end = deadline === undefined ? ownDeadline :
      Number.isFinite(deadline) && deadline <= ownDeadline ? deadline : started;
    let resolve!: () => void, reject!: (error: unknown) => void;
    this.#drainTask = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    void this.#drain(end).then(resolve, reject);
    return this.#drainTask;
  }
  async #drain(deadline: number): Promise<void> {
    this.seal();
    const entries = [...this.#entries];
    const tasks = entries.map(async (entry) => {
      if (this.now() >= deadline) throw blocked();
      if (!entry.resource || !entry.settlement) throw blocked();
      await entry.resource.drain(deadline);
      await entry.settlement;
      if (entry.resource.closedConfirmed !== true || !entry.settled) throw blocked();
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // allSettled keeps observing already-started cleanup even after another failure.
      const settled = Promise.allSettled(tasks);
      if (this.now() >= deadline) { void settled; throw blocked(); }
      const results = await Promise.race([settled, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(blocked()), Math.max(1, deadline - this.now()));
      })]);
      if (this.now() >= deadline || this.#revocationFailed || results.some((row) => row.status !== "fulfilled")) throw blocked();
      for (const entry of entries) this.#retire(entry);
      if (this.#entries.size) throw blocked();
    } catch { throw blocked(); }
    finally { if (timer) clearTimeout(timer); }
  }
}
