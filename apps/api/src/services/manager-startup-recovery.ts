/** App-scoped recovery admission, independent of Fastify's plugin deadline.
 * A timeout closes admission; it never races a still-running proof into success. */
export type RecoveryMeasure = <T>(phase: string, action: () => Promise<T>) => Promise<T>;
export class ManagerStartupRecovery {
  #state: 'pending' | 'verifying' | 'ready' | 'failed' | 'closing' = 'pending';
  readonly #abort = new AbortController();
  #task: Promise<void> | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #deadline = Infinity;
  readonly stages: { phase: string; durationMs: number; result: 'PASS' | 'FAIL' }[] = [];
  droppedStages = 0;
  #record(phase: string, start: number, result: 'PASS' | 'FAIL') {
    if (this.stages.length < 256) this.stages.push({ phase, durationMs: performance.now() - start, result });
    else this.droppedStages++;
  }
  constructor(private readonly budgetMs = 120_000, private readonly now = () => performance.now()) {}
  get state() { return this.#state; }
  get available() { return this.#state === 'ready'; }
  fail(): void { if (this.#state !== 'closing') this.#state = 'failed'; this.#abort.abort(); }
  check = () => {
    if (this.#state === 'verifying' && this.now() >= this.#deadline) { this.#state = 'failed'; this.#abort.abort(); }
    if (this.#abort.signal.aborted || this.#state === 'failed' || this.#state === 'closing') throw new Error('MANAGER_RECOVERY_ABORTED');
  };
  async stage<T>(phase: string, action: () => Promise<T>): Promise<T> {
    this.check(); const start = performance.now();
    try {
      const value = await action(); this.check();
      this.#record(phase, start, 'PASS'); return value;
    } catch (error) {
      this.#record(phase, start, 'FAIL'); throw error;
    }
  }
  start(action: () => Promise<void>, bounded = false): Promise<void> {
    if (this.#task) return this.#task;
    this.check(); this.#state = 'verifying';
    if (bounded) {
      this.#deadline = this.now() + this.budgetMs;
      this.#timer = setTimeout(() => { this.#state = 'failed'; this.#abort.abort(); }, this.budgetMs);
    }
    this.#task = Promise.resolve().then(action).then(() => { this.check(); this.#state = 'ready'; })
      .catch(() => { if (this.#state !== 'closing') this.#state = 'failed'; })
      .finally(() => { clearTimeout(this.#timer); });
    return this.#task;
  }
  async wait(): Promise<void> {
    await this.#task;
    if (!this.available) throw new Error('MANAGER_RECOVERY_UNAVAILABLE');
  }
  async close(): Promise<void> {
    this.#state = 'closing'; this.#abort.abort(); clearTimeout(this.#timer);
    // Join the actual proof; never dispose its adapters while it still uses them.
    await this.#task;
  }
}
