import type { Metrics } from "@mcsm/contracts";

export interface PerformanceSample {
  collectedAt: string;
  metrics: Metrics;
}

/** Manager-session history only; it does not interpolate or refresh metric timestamps. */
export class PerformanceHistory {
  readonly #samples = new Map<string, PerformanceSample[]>();
  readonly #serverIds: ReadonlySet<string>;

  constructor(serverIds: readonly string[], readonly capacity = 120) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 120) {
      throw new RangeError("Performance history capacity must be between 1 and 120.");
    }
    this.#serverIds = new Set(serverIds);
  }

  record(serverId: string, sample: PerformanceSample): void {
    this.#assertRegistered(serverId);
    const timestamp = Date.parse(sample.collectedAt);
    if (!Number.isFinite(timestamp)) throw new RangeError("Invalid performance collection time.");
    const samples = this.#samples.get(serverId) ?? [];
    const previous = samples.at(-1);
    // A backward wall clock must not create an apparently newer historical point.
    if (previous && timestamp <= Date.parse(previous.collectedAt)) return;
    samples.push(structuredClone(sample));
    if (samples.length > this.capacity) samples.splice(0, samples.length - this.capacity);
    this.#samples.set(serverId, samples);
  }

  read(serverId: string): PerformanceSample[] {
    this.#assertRegistered(serverId);
    return structuredClone(this.#samples.get(serverId) ?? []);
  }

  #assertRegistered(serverId: string): void {
    if (!this.#serverIds.has(serverId)) throw new RangeError("Unregistered performance server.");
  }
}
