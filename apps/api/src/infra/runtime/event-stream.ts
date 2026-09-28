import { randomUUID } from "node:crypto";

import type { LogEntry, ServerStatus } from "@mcsm/contracts";

import type {
  RuntimeEvent,
  RuntimeStreamReplay,
  RuntimeStreamSnapshot,
  SequencedRuntimeEvent
} from "../runtime-contract.js";

export interface RuntimeEventStreamOptions {
  readonly initialStatus: ServerStatus;
  readonly streamId?: string;
  readonly maxEvents?: number;
  readonly maxLogs?: number;
}

export class RuntimeEventStream {
  private readonly streamId: string;
  private readonly maxEvents: number;
  private readonly maxLogs: number;
  private latestSequence = 0;
  private currentStatus: ServerStatus;
  private readonly events: SequencedRuntimeEvent[] = [];
  private readonly logs: LogEntry[] = [];
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();

  constructor(options: RuntimeEventStreamOptions) {
    this.streamId = options.streamId ?? randomUUID();
    this.maxEvents = options.maxEvents ?? 2_000;
    this.maxLogs = options.maxLogs ?? 2_000;
    this.currentStatus = options.initialStatus;
  }

  publish(event: RuntimeEvent): SequencedRuntimeEvent {
    this.latestSequence += 1;
    const sequenced = { sequence: this.latestSequence, event } satisfies SequencedRuntimeEvent;
    this.events.push(sequenced);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
    if (event.type === "status") this.currentStatus = event.status;
    if (event.type === "log") {
      this.logs.push(event.entry);
      if (this.logs.length > this.maxLogs) this.logs.splice(0, this.logs.length - this.maxLogs);
    }
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        this.listeners.delete(listener);
      }
    }
    return sequenced;
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): RuntimeStreamSnapshot {
    return {
      streamId: this.streamId,
      latestSequence: this.latestSequence,
      status: this.currentStatus,
      logs: [...this.logs]
    };
  }

  replay(streamId: string, afterSequence: number): RuntimeStreamReplay {
    if (streamId !== this.streamId) {
      return this.gap("stream-changed");
    }
    if (!Number.isInteger(afterSequence) || afterSequence < 0 || afterSequence > this.latestSequence) {
      return this.gap("invalid-sequence");
    }
    const oldest = this.events[0]?.sequence ?? this.latestSequence + 1;
    if (afterSequence < oldest - 1) {
      return this.gap("replay-window-exceeded");
    }
    return {
      streamId: this.streamId,
      latestSequence: this.latestSequence,
      events: this.events.filter((event) => event.sequence > afterSequence),
      gap: false,
      reason: null
    };
  }

  close(): void {
    this.listeners.clear();
  }

  private gap(reason: string): RuntimeStreamReplay {
    return {
      streamId: this.streamId,
      latestSequence: this.latestSequence,
      events: [],
      gap: true,
      reason
    };
  }
}
