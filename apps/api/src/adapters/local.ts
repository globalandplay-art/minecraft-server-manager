import type {
  Activity,
  Alert,
  Capabilities,
  Metrics,
  ServerInfo,
  ServerStatus
} from "@mcsm/contracts";

import type { ValidatedRegistration } from "../config/local-config.js";
import type {
  MinecraftRuntime,
  RuntimeCommandResult,
  RuntimeEvent,
  RuntimeLogPage,
  RuntimeOperationContext,
  RuntimeStreamReplay,
  RuntimeStreamSnapshot
} from "../infra/runtime-contract.js";
import type { RegisteredExecutionIdentity } from "../infra/runtime-contract.js";
import type { LocalMinecraftServerAdapter } from "./contract.js";

export class LocalJavaAdapter implements LocalMinecraftServerAdapter {
  readonly mode = "local" as const;
  readonly plan: ValidatedRegistration["plan"];
  readonly serverId: string;
  readonly #registration: ValidatedRegistration;
  readonly #runtime: MinecraftRuntime;

  constructor(registration: ValidatedRegistration, runtime: MinecraftRuntime) {
    this.#registration = registration;
    this.plan = registration.plan;
    this.serverId = registration.plan.id;
    this.#runtime = runtime;
  }

  async getServerInfo(): Promise<ServerInfo> {
    return structuredClone(this.plan.serverInfo);
  }

  async getCapabilities(): Promise<Capabilities> {
    return {
      mods: this.plan.serverInfo.type === "fabric",
      plugins: this.plan.serverInfo.type === "paper",
      rcon: true,
      console: true,
      backup: true,
      worlds: true,
      properties: true
    };
  }

  async getStatus(): Promise<ServerStatus> {
    return (await this.#runtime.snapshot()).status;
  }

  async getMetrics(): Promise<Metrics> {
    return (await this.#runtime.snapshot()).metrics;
  }

  async getActivity(): Promise<Activity[]> {
    return [];
  }

  async getAlerts(): Promise<Alert[]> {
    return this.plan.serverInfo.detection.warnings.map((message, index) => ({
      code: `DETECTION_WARNING_${index + 1}`,
      message
    }));
  }

  getRuntime(): MinecraftRuntime {
    return this.#runtime;
  }

  getRegisteredExecutionIdentity(): RegisteredExecutionIdentity {
    if (!this.#registration.identity) throw new Error("registered-execution-identity-unavailable");
    return this.#registration.identity;
  }

  async getCommandTransport(): Promise<"rcon" | "stdin" | "unavailable"> {
    return (await this.#runtime.snapshot()).commandTransport;
  }

  async revalidateBeforeStart(): Promise<void> {
    await this.#registration.revalidateBeforeStart();
  }

  async start(context: RuntimeOperationContext): Promise<void> {
    await this.#runtime.start(context);
  }

  async stop(context: RuntimeOperationContext): Promise<void> {
    await this.#runtime.stop(context);
  }

  async stopOwnedForRecovery(context: RuntimeOperationContext, ownerOperationId: string): Promise<void> {
    if (!this.#runtime.stopOwnedForRecovery) throw new Error("Runtime recovery stop is unavailable");
    await this.#runtime.stopOwnedForRecovery(context, ownerOperationId);
  }

  async command(validatedLine: string): Promise<RuntimeCommandResult> {
    return this.#runtime.command(validatedLine);
  }

  async getLogs(after: string | undefined, limit: number): Promise<RuntimeLogPage> {
    return this.#runtime.getLogs(after, limit);
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    return this.#runtime.subscribe(listener);
  }

  async streamSnapshot(): Promise<RuntimeStreamSnapshot> {
    return this.#runtime.streamSnapshot();
  }

  async replayStream(streamId: string, afterSequence: number): Promise<RuntimeStreamReplay> {
    return this.#runtime.replayStream(streamId, afterSequence);
  }

  async closeObserver(): Promise<void> {
    await this.#runtime.closeObserver();
  }
}
