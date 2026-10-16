import { AsyncLocalStorage } from "node:async_hooks";

export const timingKinds = ["create-directory", "write-new", "publish-new", "acl-one", "acl-many"] as const;
export type TimingKind = typeof timingKinds[number];
interface Call { id: number; parentId: number | null; kind: TimingKind; started: number; ended: number | null; rejected: boolean }

/** Test-only observation; no path, primitive argument, result or error is retained. */
export class NativeTiming {
  readonly #context = new AsyncLocalStorage<number>();
  readonly #calls: Call[] = [];
  #overflow = false;
  #observerFailed = false;
  constructor(private readonly now: () => number = () => performance.now()) {}
  invoke<T>(kind: TimingKind, action: () => Promise<T>): Promise<T> {
    let call: Call | undefined;
    try {
      if (this.#calls.length < 256) {
        call = { id: this.#calls.length + 1, parentId: this.#context.getStore() ?? null, kind, started: this.now(), ended: null, rejected: false };
        this.#calls.push(call);
      } else this.#overflow = true;
    } catch { this.#observerFailed = true; }
    const finish = (rejected: boolean) => {
      try { if (call) { call.ended = this.now(); call.rejected = rejected; } }
      catch { this.#observerFailed = true; }
    };
    let result: Promise<T>;
    try { result = call ? this.#context.run(call.id, action) : action(); }
    catch (error) { finish(true); throw error; }
    // Preserve the ORIGINAL Promise and caller-visible resolution/rejection.
    void result.then(() => finish(false), () => finish(true));
    return result;
  }
  snapshot() {
    const now = this.now();
    const item = (call: Call) => ({ id: call.id, parentId: call.parentId, kind: call.kind,
      elapsedMs: Math.max(0, Math.floor((call.ended ?? now) - call.started)), state: call.ended === null ? "active" : call.rejected ? "rejected" : "completed" });
    return { timeMeaning: "inclusive-not-additive", overflow: this.#overflow, observerFailed: this.#observerFailed,
      totals: timingKinds.map((kind) => {
        const calls = this.#calls.filter((call) => call.kind === kind), done = calls.filter((call) => call.ended !== null);
        return { kind, calls: calls.length, completed: done.length, rejected: done.filter((call) => call.rejected).length,
          inclusiveMs: Math.floor(done.reduce((sum, call) => sum + Math.max(0, call.ended! - call.started), 0)) };
      }),
      active: this.#calls.filter((call) => call.ended === null).slice(-8).map(item),
      recent: this.#calls.filter((call) => call.ended !== null).slice(-4).map(item) };
  }
}
