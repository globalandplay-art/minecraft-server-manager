import { expect, it } from "vitest";
import { COMPILED_CLOCK_LIMITS as limits, CompiledClockMapping, CompiledPerformanceBridge } from "../src/services/whitelist-compiled-clock.js";

const NS = 1_000_000_000n;
const sample = { sentNs: 1_000_000_000n, receivedNs: 1_010_000_000n,
  remoteTicks: 20_000_000n, frequency: 10_000_000n };
const unsafe = (run: () => unknown) => expect(run).toThrowError("ACL_CLOCK_UNSAFE");

it("maps expiry conservatively with a known nonzero clock offset", () => {
  const mapping = new CompiledClockMapping(sample);
  const expiry = mapping.project(sample.receivedNs, 2_000_000_000n);
  // Broker sample=2s, Node bracket=1s..1.01s, upper offset=-.989s.
  expect(expiry).toBe(29_890_000n);
  expect(mapping.valid).toBe(true);
});

it("never projects later than the original deadline across asymmetric brackets and frequencies", () => {
  for (const frequency of [1_000_000n, 3_579_545n, 10_000_000n, 1_000_000_000n]) {
    for (const offset of [-100_000_000_000n, 0n, 300_000_000_000n]) {
      for (const [left, right] of [[0n, 0n], [1n, 9_000_000n], [150_000_000n, 1n]]) {
        const remoteTicks = 10_000_000_000_003n;
        const floor = remoteTicks * NS / frequency;
        const ceil = (remoteTicks * NS + frequency - 1n) / frequency;
        const sentNs = floor + offset - left!, receivedNs = ceil + offset + right!;
        const deadline = receivedNs + 3_000_000_000n;
        const mapping = new CompiledClockMapping({ sentNs, receivedNs, remoteTicks, frequency });
        const projected = mapping.project(receivedNs, deadline);
        // Exact rational comparison; no floating conversion or same-code inverse.
        expect(projected * NS + offset * frequency).toBeLessThanOrEqual(deadline * frequency);
        for (const admittedOffset of [sentNs - ceil - limits.guardNs, receivedNs - floor + limits.guardNs]) {
          expect(projected * NS + admittedOffset * frequency).toBeLessThanOrEqual(deadline * frequency);
        }
      }
    }
  }
});

it.each([
  { ...sample, sentNs: -1n }, { ...sample, receivedNs: sample.sentNs - 1n },
  { ...sample, receivedNs: sample.sentNs + limits.maxRoundTripNs + 1n },
  { ...sample, remoteTicks: 0n }, { ...sample, remoteTicks: limits.signedMax + 1n },
  { ...sample, frequency: limits.minFrequency - 1n }, { ...sample, frequency: limits.maxFrequency + 1n }
])("rejects invalid sample %#", (value) => unsafe(() => new CompiledClockMapping(value)));

it("accepts exact RTT bound but never renews the mapping lifetime", () => {
  const mapping = new CompiledClockMapping({ ...sample, receivedNs: sample.sentNs + limits.maxRoundTripNs });
  expect(mapping.project(sample.sentNs + limits.maxRoundTripNs, sample.sentNs + limits.lifetimeNs)).toBeGreaterThan(0n);
  unsafe(() => mapping.project(sample.sentNs + limits.lifetimeNs, sample.sentNs + limits.lifetimeNs + 1n));
  expect(mapping.valid).toBe(false);
  unsafe(() => mapping.project(sample.receivedNs, sample.receivedNs + NS));
});

it.each([
  [sample.receivedNs - 1n, sample.receivedNs + NS],
  [sample.receivedNs, sample.receivedNs],
  [sample.receivedNs, sample.sentNs + limits.lifetimeNs + 1n],
  [sample.receivedNs, sample.receivedNs + 1n],
  [sample.receivedNs, limits.signedMax + 1n]
].map(([now, end]) => ({ now: now!, end: end! })))("permanently invalidates bad projection %#", ({ now, end }) => {
  const mapping = new CompiledClockMapping(sample);
  unsafe(() => mapping.project(now, end)); expect(mapping.valid).toBe(false);
  unsafe(() => mapping.project(sample.receivedNs, sample.receivedNs + NS));
});

it("rejects projected ticks that overflow native signed64 without truncation", () => {
  const mapping = new CompiledClockMapping({ ...sample, frequency: NS, remoteTicks: limits.signedMax - 10n });
  unsafe(() => mapping.project(sample.receivedNs, sample.receivedNs + NS));
  expect(mapping.valid).toBe(false);
});

it("keeps converted coordinates private and never serializes arbitrary errors", () => {
  const mapping = new CompiledClockMapping(sample);
  expect(JSON.stringify(mapping)).toBe("{}");
  let caught: unknown;
  try { mapping.project(1 as unknown as bigint, sample.receivedNs + NS); } catch (error) { caught = error; }
  expect(String(caught)).toBe("Error: ACL_CLOCK_UNSAFE"); expect(mapping.valid).toBe(false);
});

const bracket = { beforeMs: 1000, afterMs: 1000.01, hrtimeNs: 20_000_000_000n };
it("converts the existing performance origin conservatively without resetting a timer", () => {
  const bridge = new CompiledPerformanceBridge(bracket);
  expect(bridge.project(1000.01, 2000)).toBe(20_997_990_000n);
  expect(bridge.valid).toBe(true); expect(JSON.stringify(bridge)).toBe("{}");
});

it("composes both conservative domains without exceeding a known true deadline", () => {
  const bridge = new CompiledPerformanceBridge(bracket);
  const nodeDeadline = bridge.project(bracket.afterMs, 2000);
  // The hrtime sample was taken at performance=1000.005ms; true H-P offset.
  const trueNodeDeadline = 2_000_000_000n + (bracket.hrtimeNs - 1_000_005_000n);
  expect(nodeDeadline).toBeLessThanOrEqual(trueNodeDeadline);
  const mapping = new CompiledClockMapping({ sentNs: 20_010_000_000n, receivedNs: 20_020_000_000n,
    remoteTicks: 100_000_000n, frequency: 10_000_000n });
  const remoteDeadline = mapping.project(20_020_000_000n, nodeDeadline);
  const largestAdmittedOffset = 20_020_000_000n - 10_000_000_000n + limits.guardNs;
  expect(remoteDeadline * 100n + largestAdmittedOffset).toBeLessThanOrEqual(trueNodeDeadline);
});

it.each([
  { ...bracket, beforeMs: -1 }, { ...bracket, afterMs: Infinity },
  { ...bracket, afterMs: 999 }, { ...bracket, afterMs: 1250.001 },
  { ...bracket, hrtimeNs: -1n }, { ...bracket, hrtimeNs: limits.signedMax + 1n }
])("rejects an invalid performance bracket %#", (value) => unsafe(() => new CompiledPerformanceBridge(value)));

it.each([
  [1000, 2000], [1000.01, 1000.01], [1000.01, 1000.02],
  [1000.01, 41000.01], [41000, 41001], [NaN, 2000], [1000.01, Infinity]
].map(([now, end]) => ({ now: now!, end: end! })))("poisons a backwards/stale/tight bridge %#", ({ now, end }) => {
  const bridge = new CompiledPerformanceBridge(bracket);
  unsafe(() => bridge.project(now, end)); expect(bridge.valid).toBe(false);
  unsafe(() => bridge.project(bracket.afterMs, 2000));
});

it("bounds large floating coordinates with outward rounding and explicit guard", () => {
  const beforeMs = 8_000_000_000_000;
  const bridge = new CompiledPerformanceBridge({ beforeMs, afterMs: beforeMs + 0.01, hrtimeNs: 8_100_000_000_000_000_000n });
  const deadline = bridge.project(beforeMs + 0.02, beforeMs + 1000);
  expect(deadline).toBeGreaterThan(0n); expect(deadline).toBeLessThanOrEqual(limits.signedMax);
});
