/** Test-only: preserve the test's result; teardown may retain a busy fixture. */
export class FixtureCleanupGate {
  #closing = false;
  #bodySettled = false;
  #pending = 0;
  #idle: () => boolean = () => true;
  setIdle(check: () => boolean): void { this.#idle = check; }
  body<T>(action: () => Promise<T>): Promise<T> {
    let promise: Promise<T>;
    try { promise = action(); } catch (error) { this.#bodySettled = true; throw error; }
    void promise.then(() => { this.#bodySettled = true; }, () => { this.#bodySettled = true; });
    return promise;
  }
  async request<T>(action: () => Promise<T>): Promise<T> {
    if (this.#closing) throw new Error("FIXTURE_CLOSING");
    this.#pending++;
    try { return await action(); } finally { this.#pending--; }
  }
  async closeAndWait(limitMs = 2000): Promise<boolean> {
    this.#closing = true;
    const deadline = performance.now() + limitMs;
    do {
      if (this.#bodySettled && this.#pending === 0 && this.#idle()) return true;
      if (performance.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 10));
    } while (true);
  }
}
