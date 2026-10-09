import type { Metrics } from "@mcsm/contracts";
import { describe, expect, it } from "vitest";
import { PerformanceHistory } from "../src/services/performance-history.js";

const unavailable = { status: "unavailable", value: null, source: null, sampledAt: null, reason: "not-supported" } as const;
const metrics: Metrics = { players: unavailable, tps: unavailable, mspt: unavailable,
  cpu: unavailable, ram: unavailable, disk: unavailable, uptime: unavailable };
const sample = (second: number) => ({ collectedAt: new Date(second * 1000).toISOString(), metrics });

describe("manager-session performance history", () => {
  it("bounds history and separates registered servers", () => {
    const history = new PerformanceHistory(["a", "b"], 2);
    for (const second of [1, 2, 3]) history.record("a", sample(second));
    expect(history.read("a").map((item) => item.collectedAt)).toEqual([sample(2).collectedAt, sample(3).collectedAt]);
    expect(history.read("b")).toEqual([]);
    expect(() => history.record("unknown", sample(1))).toThrow("Unregistered");
    expect(() => history.read("unknown")).toThrow("Unregistered");
  });

  it("preserves unavailable values and isolates caller mutations", () => {
    const history = new PerformanceHistory(["a"]);
    const input = structuredClone(sample(1));
    history.record("a", input);
    input.metrics.cpu = { ...unavailable, reason: "changed" };
    const output = history.read("a");
    expect(output[0]?.metrics.cpu).toEqual(unavailable);
    output.length = 0;
    expect(history.read("a")).toHaveLength(1);
  });

  it("rejects invalid timestamps and ignores duplicate/backward collection times", () => {
    const history = new PerformanceHistory(["a"]);
    history.record("a", sample(2));
    history.record("a", sample(2));
    history.record("a", sample(1));
    expect(history.read("a")).toHaveLength(1);
    expect(() => history.record("a", { ...sample(3), collectedAt: "invalid" })).toThrow("Invalid");
  });

  it("validates capacity and starts empty after manager reconstruction", () => {
    for (const capacity of [0, 121, 1.5, NaN]) {
      expect(() => new PerformanceHistory(["a"], capacity)).toThrow(RangeError);
    }
    const history = new PerformanceHistory(["a"]);
    history.record("a", sample(1));
    expect(new PerformanceHistory(["a"]).read("a")).toEqual([]);
  });

  it("does not relabel stale measurements as current or share nested output objects", () => {
    const history = new PerformanceHistory(["a"]);
    const input = structuredClone(sample(10));
    input.metrics.uptime = { status: "available", value: 9, source: "process", sampledAt: sample(9).collectedAt };
    input.metrics.ram = { status: "stale", value: { rssBytes: 1024 }, source: "process",
      sampledAt: sample(1).collectedAt, reason: "probe-unavailable" };
    history.record("a", input);
    const output = history.read("a")[0];
    expect(output?.metrics.ram).toEqual(input.metrics.ram);
    expect(output?.metrics.uptime).toEqual(input.metrics.uptime);
    if (output?.metrics.ram.status === "stale") output.metrics.ram.value.rssBytes = 0;
    expect(history.read("a")[0]?.metrics.ram).toEqual(input.metrics.ram);
  });
});
