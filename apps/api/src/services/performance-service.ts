import { performance } from "node:perf_hooks";
import type { PerformanceResponse } from "@mcsm/contracts";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Clock } from "../clock.js";
import { ServerNotFoundError } from "./server-service.js";
import { PerformanceHistory } from "./performance-history.js";

/** Demand sampling: no idle probes, commands, timers or filesystem traversal. */
export class PerformanceService {
  readonly #history: PerformanceHistory;
  readonly #next = new Map<string, number>();
  readonly #pending = new Map<string, Promise<void>>();
  readonly #failures = new Map<string, unknown>();
  constructor(readonly registry: AdapterRegistry, readonly clock: Clock,
    readonly monotonicNow: () => number = () => performance.now()) {
    this.#history = new PerformanceHistory(registry.list().map((adapter) => adapter.serverId));
  }

  async read(serverId: string): Promise<PerformanceResponse["data"]> {
    const adapter = this.registry.get(serverId);
    if (!adapter) throw new ServerNotFoundError();
    const pending = this.#pending.get(serverId);
    if (pending) await pending;
    else if (this.monotonicNow() >= (this.#next.get(serverId) ?? -Infinity)) {
      this.#next.set(serverId, this.monotonicNow() + 5000);
      // Defer adapter invocation until pending is installed, including synchronous throws.
      const task = Promise.resolve().then(async () => {
        const metrics = await adapter.getMetrics();
        this.#history.record(serverId, { collectedAt: this.clock.now().toISOString(), metrics });
        this.#failures.delete(serverId);
      });
      this.#pending.set(serverId, task);
      try { await task; } catch (error) { this.#failures.set(serverId, error); throw error; }
      finally { this.#pending.delete(serverId); }
    }
    if (this.#failures.has(serverId)) throw this.#failures.get(serverId);
    return { retention: "manager-session", minimumIntervalMs: 5000, samples: this.#history.read(serverId) };
  }
}
