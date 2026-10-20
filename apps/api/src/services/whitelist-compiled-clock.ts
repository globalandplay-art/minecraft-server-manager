/** UNWIRED arithmetic candidate. Does not read a clock, authenticate a sample,
 * issue launch authority or set timers; it only converts supplied coordinates.
 * Native clock provenance/guard adequacy require later independent validation. */
export const COMPILED_CLOCK_LIMITS = Object.freeze({ guardNs: 1_000_000n,
  maxRoundTripNs: 250_000_000n, lifetimeNs: 40_000_000_000n,
  minFrequency: 1_000_000n, maxFrequency: 1_000_000_000n,
  signedMax: 0x7fff_ffff_ffff_ffffn });
const NS = 1_000_000_000n;
export class CompiledClockError extends Error {
  readonly code = "ACL_CLOCK_UNSAFE";
  constructor() { super("ACL_CLOCK_UNSAFE"); }
}
type Sample = Readonly<{ sentNs: bigint; receivedNs: bigint; remoteTicks: bigint; frequency: bigint }>;
const nonnegative = (value: unknown): value is bigint => typeof value === "bigint" && value >= 0n && value <= COMPILED_CLOCK_LIMITS.signedMax;
const fail = (): never => { throw new CompiledClockError(); };

export class CompiledClockMapping {
  readonly #sentNs: bigint;
  readonly #frequency: bigint;
  readonly #offsetLow: bigint;
  readonly #offsetHigh: bigint;
  #lastNs: bigint;
  #valid = true;
  constructor(sample: Sample) {
    try {
      const { sentNs, receivedNs, remoteTicks, frequency } = sample;
      if (!nonnegative(sentNs) || !nonnegative(receivedNs) || receivedNs < sentNs ||
        receivedNs - sentNs > COMPILED_CLOCK_LIMITS.maxRoundTripNs ||
        !nonnegative(remoteTicks) || remoteTicks === 0n || !nonnegative(frequency) ||
        frequency < COMPILED_CLOCK_LIMITS.minFrequency || frequency > COMPILED_CLOCK_LIMITS.maxFrequency) fail();
      if (receivedNs - sentNs >= COMPILED_CLOCK_LIMITS.lifetimeNs) fail();
      const remoteFloor = remoteTicks * NS / frequency;
      const remoteCeil = (remoteTicks * NS + frequency - 1n) / frequency;
      this.#sentNs = sentNs; this.#lastNs = receivedNs; this.#frequency = frequency;
      this.#offsetLow = sentNs - remoteCeil - COMPILED_CLOCK_LIMITS.guardNs;
      this.#offsetHigh = receivedNs - remoteFloor + COMPILED_CLOCK_LIMITS.guardNs;
    } catch { throw new CompiledClockError(); }
  }
  get valid(): boolean { return this.#valid; }
  /** Only SHORTENS an already-authorized deadline. It grants no capability.
   * Tight/rejected projections poison this one-shot mapping; no refresh/retry. */
  project(nowNs: bigint, deadlineNs: bigint): bigint {
    try {
      if (!this.#valid || !nonnegative(nowNs) || !nonnegative(deadlineNs) || nowNs < this.#lastNs ||
        nowNs - this.#sentNs >= COMPILED_CLOCK_LIMITS.lifetimeNs || deadlineNs <= nowNs ||
        deadlineNs - this.#sentNs > COMPILED_CLOCK_LIMITS.lifetimeNs) fail();
      const remainingCoordinate = deadlineNs - this.#offsetHigh;
      const currentCoordinate = nowNs - this.#offsetLow;
      if (remainingCoordinate <= 0n || currentCoordinate < 0n) fail();
      const expiry = remainingCoordinate * this.#frequency / NS;
      const latestPossibleNow = (currentCoordinate * this.#frequency + NS - 1n) / NS;
      if (expiry < 1n || expiry > COMPILED_CLOCK_LIMITS.signedMax || expiry <= latestPossibleNow) fail();
      this.#lastNs = nowNs;
      return expiry;
    } catch {
      this.#valid = false;
      throw new CompiledClockError();
    }
  }
}

type PerformanceBracket = Readonly<{ beforeMs: number; afterMs: number; hrtimeNs: bigint }>;
const performanceCoordinate = (value: unknown): value is number => typeof value === "number" &&
  Number.isFinite(value) && value >= 0 && value <= 9_000_000_000_000;
const floorNs = (ms: number) => BigInt(Math.floor(ms * 1_000_000));
const ceilNs = (ms: number) => BigInt(Math.ceil(ms * 1_000_000));

/** Pure conservative bridge for the existing performance.now deadline origin.
 * Requires one trusted hrtime sample taken BETWEEN beforeMs/afterMs. It reads
 * neither clock and cannot establish that prerequisite from numbers alone.
 * Native/packaged-runtime guard adequacy still requires separate proof. */
export class CompiledPerformanceBridge {
  readonly #beforeNs: bigint;
  readonly #offsetLow: bigint;
  readonly #offsetHigh: bigint;
  #lastMs: number;
  #valid = true;
  constructor(bracket: PerformanceBracket) {
    try {
      const { beforeMs, afterMs, hrtimeNs } = bracket;
      if (!performanceCoordinate(beforeMs) || !performanceCoordinate(afterMs) || afterMs < beforeMs ||
        !nonnegative(hrtimeNs) || ceilNs(afterMs) - floorNs(beforeMs) > COMPILED_CLOCK_LIMITS.maxRoundTripNs) fail();
      this.#beforeNs = floorNs(beforeMs); this.#lastMs = afterMs;
      this.#offsetLow = hrtimeNs - ceilNs(afterMs) - COMPILED_CLOCK_LIMITS.guardNs;
      this.#offsetHigh = hrtimeNs - floorNs(beforeMs) + COMPILED_CLOCK_LIMITS.guardNs;
    } catch { throw new CompiledClockError(); }
  }
  get valid(): boolean { return this.#valid; }
  project(nowMs: number, deadlineMs: number): bigint {
    try {
      if (!this.#valid || !performanceCoordinate(nowMs) || !performanceCoordinate(deadlineMs) || nowMs < this.#lastMs ||
        deadlineMs <= nowMs || floorNs(nowMs) - this.#beforeNs >= COMPILED_CLOCK_LIMITS.lifetimeNs ||
        ceilNs(deadlineMs) - this.#beforeNs > COMPILED_CLOCK_LIMITS.lifetimeNs) fail();
      const deadline = floorNs(deadlineMs) - COMPILED_CLOCK_LIMITS.guardNs + this.#offsetLow;
      const latestNow = ceilNs(nowMs) + COMPILED_CLOCK_LIMITS.guardNs + this.#offsetHigh;
      if (!nonnegative(deadline) || deadline === 0n || deadline <= latestNow) fail();
      this.#lastMs = nowMs;
      return deadline;
    } catch {
      this.#valid = false;
      throw new CompiledClockError();
    }
  }
}
