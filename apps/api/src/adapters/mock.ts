import type {
  Activity,
  Alert,
  Capabilities,
  Metrics,
  ServerInfo,
  ServerStatus
} from "@mcsm/contracts";

import type { Clock } from "../clock.js";
import type { MinecraftServerAdapter } from "./contract.js";

export interface MockAdapterFixture {
  server: ServerInfo;
  capabilities: Capabilities;
  status: Omit<ServerStatus, "observedAt">;
  metrics(now: Date): Metrics;
  activity(now: Date): Activity[];
  alerts: Alert[];
}

export class MockAdapter implements MinecraftServerAdapter {
  readonly serverId: string;
  readonly mode = "mock" as const;
  readonly #fixture: MockAdapterFixture;
  readonly #clock: Clock;

  constructor(fixture: MockAdapterFixture, clock: Clock) {
    this.serverId = fixture.server.id;
    this.#fixture = fixture;
    this.#clock = clock;
  }

  async getServerInfo(): Promise<ServerInfo> {
    return structuredClone(this.#fixture.server);
  }

  async getCapabilities(): Promise<Capabilities> {
    return structuredClone(this.#fixture.capabilities);
  }

  async getStatus(): Promise<ServerStatus> {
    return {
      ...structuredClone(this.#fixture.status),
      observedAt: this.#clock.now().toISOString()
    };
  }

  async getMetrics(): Promise<Metrics> {
    return structuredClone(this.#fixture.metrics(this.#clock.now()));
  }

  async getActivity(): Promise<Activity[]> {
    return structuredClone(this.#fixture.activity(this.#clock.now()));
  }

  async getAlerts(): Promise<Alert[]> {
    return structuredClone(this.#fixture.alerts);
  }
}
