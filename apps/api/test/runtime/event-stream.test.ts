import type { LogEntry, ServerStatus } from "@mcsm/contracts";
import { describe, expect, it, vi } from "vitest";

import { RuntimeEventStream } from "../../src/infra/runtime/event-stream.js";

function status(state: ServerStatus["state"]): ServerStatus {
  return {
    state,
    ownership: "managed",
    source: "process",
    observedAt: "2026-09-27T00:00:00.000Z",
    activeOperationId: null,
    recoveryRequired: false
  };
}

function log(id: string): LogEntry {
  return {
    id,
    cursor: id,
    timestamp: null,
    level: "info",
    text: id,
    source: "latest.log"
  };
}

describe("RuntimeEventStream", () => {
  it("publishes one sequence across log and status events", () => {
    const listener = vi.fn();
    const stream = new RuntimeEventStream({
      initialStatus: status("stopped"),
      streamId: "stream-test",
      maxEvents: 4,
      maxLogs: 2
    });
    stream.subscribe(listener);

    expect(stream.publish({ type: "status", status: status("starting") }).sequence).toBe(1);
    expect(stream.publish({ type: "log", entry: log("one") }).sequence).toBe(2);
    expect(stream.publish({ type: "status", status: status("running") }).sequence).toBe(3);

    expect(listener).toHaveBeenCalledTimes(3);
    expect(stream.snapshot()).toEqual({
      streamId: "stream-test",
      latestSequence: 3,
      status: status("running"),
      logs: [log("one")]
    });
    expect(stream.replay("stream-test", 1)).toMatchObject({
      latestSequence: 3,
      gap: false,
      events: [
        { sequence: 2, event: { type: "log" } },
        { sequence: 3, event: { type: "status" } }
      ]
    });
  });

  it("reports stream and bounded-window gaps instead of mixing streams", () => {
    const stream = new RuntimeEventStream({
      initialStatus: status("stopped"),
      streamId: "current",
      maxEvents: 2
    });
    stream.publish({ type: "status", status: status("starting") });
    stream.publish({ type: "status", status: status("running") });
    stream.publish({ type: "status", status: status("stopping") });

    expect(stream.replay("old", 0)).toMatchObject({ gap: true, reason: "stream-changed", events: [] });
    expect(stream.replay("current", 0)).toMatchObject({
      gap: true,
      reason: "replay-window-exceeded",
      events: []
    });
    expect(stream.replay("current", 99)).toMatchObject({ gap: true, reason: "invalid-sequence" });
  });

  it("keeps the log snapshot bounded and unsubscribe is effective", () => {
    const listener = vi.fn();
    const stream = new RuntimeEventStream({ initialStatus: status("running"), maxLogs: 2 });
    const unsubscribe = stream.subscribe(listener);
    stream.publish({ type: "log", entry: log("one") });
    unsubscribe();
    stream.publish({ type: "log", entry: log("two") });
    stream.publish({ type: "log", entry: log("three") });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(stream.snapshot().logs.map((entry) => entry.id)).toEqual(["two", "three"]);
  });

  it("isolates a throwing subscriber from event production and healthy subscribers", () => {
    const broken = vi.fn(() => { throw new Error("socket closed"); });
    const healthy = vi.fn();
    const stream = new RuntimeEventStream({ initialStatus: status("running") });
    stream.subscribe(broken);
    stream.subscribe(healthy);

    expect(() => stream.publish({ type: "log", entry: log("one") })).not.toThrow();
    stream.publish({ type: "log", entry: log("two") });

    expect(broken).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(2);
    expect(stream.snapshot()).toMatchObject({ latestSequence: 2, logs: [log("one"), log("two")] });
  });
});
