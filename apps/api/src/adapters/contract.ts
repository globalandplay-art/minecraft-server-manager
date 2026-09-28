import type {
  Activity,
  Alert,
  Capabilities,
  Metrics,
  ServerInfo,
  ServerStatus
} from "@mcsm/contracts";

import type {
  MinecraftRuntime,
  RuntimeCommandResult,
  RuntimeEvent,
  RuntimeLogPage,
  RuntimeOperationContext,
  RuntimeStreamReplay,
  RuntimeStreamSnapshot,
  ValidatedLaunchPlan
} from "../infra/runtime-contract.js";

/** Read-only Phase 1 boundary. Lifecycle and file methods arrive with their phases. */
export interface MinecraftServerAdapter {
  readonly serverId: string;
  readonly mode: "mock" | "local";
  getServerInfo(): Promise<ServerInfo>;
  getCapabilities(): Promise<Capabilities>;
  getStatus(): Promise<ServerStatus>;
  getMetrics(): Promise<Metrics>;
  getActivity(): Promise<Activity[]>;
  getAlerts(): Promise<Alert[]>;
}

export interface LocalMinecraftServerAdapter extends MinecraftServerAdapter {
  readonly mode: "local";
  readonly plan: ValidatedLaunchPlan;
  getRuntime(): MinecraftRuntime;
  getCommandTransport(): Promise<"rcon" | "stdin" | "unavailable">;
  revalidateBeforeStart(): Promise<void>;
  start(context: RuntimeOperationContext): Promise<void>;
  stop(context: RuntimeOperationContext): Promise<void>;
  command(validatedLine: string): Promise<RuntimeCommandResult>;
  getLogs(after: string | undefined, limit: number): Promise<RuntimeLogPage>;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  streamSnapshot(): Promise<RuntimeStreamSnapshot>;
  replayStream(streamId: string, afterSequence: number): Promise<RuntimeStreamReplay>;
  closeObserver(): Promise<void>;
}

export function isLocalAdapter(
  adapter: MinecraftServerAdapter
): adapter is LocalMinecraftServerAdapter {
  return adapter.mode === "local";
}
