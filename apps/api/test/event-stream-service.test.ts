import type { Operation, ServerStatus } from "@mcsm/contracts";
import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";

import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import type { RuntimeEvent } from "../src/infra/runtime-contract.js";
import { safeSend } from "../src/routes/websocket.js";
import { EventStreamService } from "../src/services/event-stream-service.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";

const serverId = "vanilla-local";
const observedAt = "2026-09-27T00:00:00.000Z";

function runtimeStatus(): ServerStatus {
  return {
    state: "unknown",
    ownership: "unknown",
    source: "status-query",
    observedAt,
    activeOperationId: null,
    recoveryRequired: false
  };
}

describe("EventStreamService", () => {
  it("overlays durable restart recovery state on snapshots and status events", async () => {
    const store = new MemoryOperationStore();
    const interruptedByRestart: Operation = {
      id: "00000000-0000-4000-8000-000000000001",
      serverId,
      kind: "start",
      state: "running",
      step: "waiting-for-new-done-log",
      progress: null,
      createdAt: observedAt,
      updatedAt: observedAt,
      result: null,
      error: null
    };
    await store.save({
      operation: interruptedByRestart,
      idempotencyKey: "00000000-0000-4000-8000-000000000002",
      requestFingerprint: "fingerprint",
      expiresAt: "2026-09-28T00:00:00.000Z"
    });
    const operations = new OperationService(store, { now: () => new Date(observedAt) });
    await operations.initialize();

    let runtimeListener: ((event: RuntimeEvent) => void) | undefined;
    const adapter = {
      serverId,
      mode: "local",
      subscribe: (listener: (event: RuntimeEvent) => void) => {
        runtimeListener = listener;
        return () => { runtimeListener = undefined; };
      },
      streamSnapshot: async () => ({
        streamId: "runtime-stream",
        latestSequence: 0,
        status: runtimeStatus(),
        logs: []
      })
    } as unknown as LocalMinecraftServerAdapter;
    const streams = new EventStreamService(new AdapterRegistry([adapter]), operations);

    const snapshot = await streams.snapshot(serverId);
    expect(snapshot.message.status).toMatchObject({
      activeOperationId: null,
      recoveryRequired: true
    });

    const received: unknown[] = [];
    streams.subscribe(serverId, (message) => received.push(message));
    runtimeListener?.({ type: "status", status: runtimeStatus() });
    expect(received).toEqual([
      expect.objectContaining({
        type: "status",
        status: expect.objectContaining({ recoveryRequired: true })
      })
    ]);

    streams.close();
  });
});

describe("WebSocket send buffering", () => {
  it("closes a client when the next payload would exceed the buffer limit", () => {
    const send = vi.fn();
    const close = vi.fn();
    const socket = {
      readyState: 1,
      bufferedAmount: 1024 * 1024 - 1,
      send,
      close
    } as unknown as WebSocket;

    expect(safeSend(socket, {
      type: "hello",
      streamId: "stream",
      latestSequence: 0
    })).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(1013, "client-too-slow");
  });
});
