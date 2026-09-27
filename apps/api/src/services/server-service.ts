import type { Overview, Readiness, ServerSummary } from "@mcsm/contracts";

import { AdapterRegistry } from "../adapters/registry.js";

const unavailableInMockMode = () => ({ allowed: false as const, reason: "mock-mode" });

const mockReadiness = (): Readiness => ({
  start: unavailableInMockMode(),
  stop: unavailableInMockMode(),
  restart: unavailableInMockMode(),
  commands: unavailableInMockMode(),
  backup: unavailableInMockMode(),
  restore: unavailableInMockMode(),
  worldChanges: unavailableInMockMode(),
  addonChanges: unavailableInMockMode(),
  propertiesChanges: unavailableInMockMode(),
  commandTransport: "unavailable"
});

export class ServerNotFoundError extends Error {
  constructor() {
    super("Server not found");
    this.name = "ServerNotFoundError";
  }
}

export class ServerService {
  readonly #registry: AdapterRegistry;

  constructor(registry: AdapterRegistry) {
    this.#registry = registry;
  }

  async list(): Promise<ServerSummary[]> {
    return Promise.all(this.#registry.list().map((adapter) => this.#getSummary(adapter.serverId)));
  }

  async get(serverId: string): Promise<ServerSummary> {
    return this.#getSummary(serverId);
  }

  async getOverview(serverId: string): Promise<Overview> {
    const adapter = this.#registry.get(serverId);
    if (adapter === undefined) {
      throw new ServerNotFoundError();
    }

    const [summary, metrics, activity, alerts] = await Promise.all([
      this.#getSummary(serverId),
      adapter.getMetrics(),
      adapter.getActivity(),
      adapter.getAlerts()
    ]);

    return { summary, metrics, activity: activity.slice(0, 20), alerts };
  }

  async #getSummary(serverId: string): Promise<ServerSummary> {
    const adapter = this.#registry.get(serverId);
    if (adapter === undefined) {
      throw new ServerNotFoundError();
    }

    const [server, capabilities, status] = await Promise.all([
      adapter.getServerInfo(),
      adapter.getCapabilities(),
      adapter.getStatus()
    ]);

    return { server, capabilities, status, readiness: mockReadiness() };
  }
}
