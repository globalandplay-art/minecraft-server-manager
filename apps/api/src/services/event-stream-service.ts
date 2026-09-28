import { randomUUID } from "node:crypto";

import type { LogEntry, Operation, ServerStatus, WsMessage } from "@mcsm/contracts";

import { isLocalAdapter, type LocalMinecraftServerAdapter } from "../adapters/contract.js";
import { AdapterRegistry } from "../adapters/registry.js";
import { DomainError } from "./domain-errors.js";
import type { OperationService } from "./operation-service.js";

const EVENT_LIMIT = 2000;
const SNAPSHOT_BYTE_BUDGET = 900 * 1024;
type SequencedMessage = Exclude<WsMessage, { type: "hello" | "snapshot" | "gap" }>;
type MessageListener = (message: SequencedMessage) => void;

interface StreamState {
  readonly streamId: string;
  readonly adapter: LocalMinecraftServerAdapter;
  readonly listeners: Set<MessageListener>;
  readonly events: SequencedMessage[];
  latestSequence: number;
}

export interface InitialSnapshot {
  readonly message: Extract<WsMessage, { type: "snapshot" }>;
  readonly truncated: boolean;
}

export interface ReplayResult {
  readonly messages: SequencedMessage[];
  readonly gap: boolean;
  readonly reason: string | null;
}

export class EventStreamService {
  readonly #streams = new Map<string, StreamState>();
  readonly #unsubscribeRuntime: (() => void)[] = [];
  readonly #unsubscribeOperations: () => void;
  readonly #operations: OperationService;

  constructor(registry: AdapterRegistry, operations: OperationService) {
    this.#operations = operations;
    for (const adapter of registry.list()) {
      if (!isLocalAdapter(adapter)) continue;
      const state: StreamState = {
        streamId: randomUUID(),
        adapter,
        listeners: new Set(),
        events: [],
        latestSequence: 0
      };
      this.#streams.set(adapter.serverId, state);
      this.#unsubscribeRuntime.push(
        adapter.subscribe((event) => {
          if (event.type === "log") this.#publish(state, { type: "log", entry: event.entry });
          else this.#publish(state, {
            type: "status",
            status: this.#operationAwareStatus(state.adapter.serverId, event.status)
          });
        })
      );
    }
    this.#unsubscribeOperations = operations.subscribe((operation) => {
      const state = this.#streams.get(operation.serverId);
      if (state !== undefined) this.#publish(state, { type: "operation", operation });
    });
  }

  hello(serverId: string): Extract<WsMessage, { type: "hello" }> {
    const state = this.#get(serverId);
    return { type: "hello", streamId: state.streamId, latestSequence: state.latestSequence };
  }

  has(serverId: string): boolean {
    return this.#streams.has(serverId);
  }

  async snapshot(serverId: string): Promise<InitialSnapshot> {
    const state = this.#get(serverId);
    const snapshot = await state.adapter.streamSnapshot();
    // streamSnapshot polls logs and may synchronously publish an event. Capture
    // the sequence after that await so queued WebSocket events are not replayed
    // on top of a snapshot that already contains them.
    const sequence = state.latestSequence;
    const logs: LogEntry[] = [];
    let bytes = 0;
    for (let index = snapshot.logs.length - 1; index >= 0; index -= 1) {
      const entry = snapshot.logs[index];
      if (entry === undefined) continue;
      const entryBytes = Buffer.byteLength(JSON.stringify(entry), "utf8");
      if (bytes + entryBytes > SNAPSHOT_BYTE_BUDGET) break;
      logs.unshift(entry);
      bytes += entryBytes;
    }
    return {
      message: {
        type: "snapshot",
        sequence,
        status: this.#operationAwareStatus(serverId, snapshot.status),
        logs
      },
      truncated: logs.length !== snapshot.logs.length
    };
  }

  replay(serverId: string, streamId: string, afterSequence: number): ReplayResult {
    const state = this.#get(serverId);
    if (streamId !== state.streamId) {
      return { messages: [], gap: true, reason: "stream-changed" };
    }
    const oldest = state.events[0]?.sequence ?? state.latestSequence + 1;
    if (afterSequence > state.latestSequence || afterSequence < oldest - 1) {
      return { messages: [], gap: true, reason: "replay-window-unavailable" };
    }
    return {
      messages: state.events.filter((event) => event.sequence > afterSequence),
      gap: false,
      reason: null
    };
  }

  subscribe(serverId: string, listener: MessageListener): () => void {
    const state = this.#get(serverId);
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  }

  close(): void {
    for (const unsubscribe of this.#unsubscribeRuntime) unsubscribe();
    this.#unsubscribeOperations();
    for (const state of this.#streams.values()) state.listeners.clear();
  }

  #get(serverId: string): StreamState {
    const state = this.#streams.get(serverId);
    if (state === undefined) {
      throw new DomainError(404, "SERVER_NOT_FOUND", "未找到可订阅的本地服务器实例");
    }
    return state;
  }

  #operationAwareStatus(serverId: string, status: ServerStatus): ServerStatus {
    const operationState = this.#operations.getServerState(serverId);
    return {
      ...status,
      activeOperationId: operationState.activeOperationId,
      recoveryRequired: status.recoveryRequired || operationState.recoveryRequired
    };
  }

  #publish(
    state: StreamState,
    event:
      | { type: "log"; entry: LogEntry }
      | { type: "status"; status: ServerStatus }
      | { type: "operation"; operation: Operation }
  ): void {
    state.latestSequence += 1;
    const message = { ...event, sequence: state.latestSequence } as SequencedMessage;
    state.events.push(message);
    if (state.events.length > EVENT_LIMIT) state.events.shift();
    for (const listener of state.listeners) {
      try {
        listener(structuredClone(message));
      } catch {
        // A failed WebSocket subscriber cannot break the runtime producer.
      }
    }
  }
}
