import {
  isLocalAdapter,
  type LocalMinecraftServerAdapter,
  type MinecraftServerAdapter
} from "./contract.js";

export class AdapterRegistry {
  readonly #adapters: Map<string, MinecraftServerAdapter>;

  constructor(adapters: readonly MinecraftServerAdapter[]) {
    this.#adapters = new Map(adapters.map((adapter) => [adapter.serverId, adapter]));

    if (this.#adapters.size !== adapters.length) {
      throw new Error("Adapter server IDs must be unique.");
    }
  }

  list(): MinecraftServerAdapter[] {
    return [...this.#adapters.values()];
  }

  get(serverId: string): MinecraftServerAdapter | undefined {
    return this.#adapters.get(serverId);
  }

  getLocal(serverId: string): LocalMinecraftServerAdapter | undefined {
    const adapter = this.#adapters.get(serverId);
    return adapter !== undefined && isLocalAdapter(adapter) ? adapter : undefined;
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.#adapters.values()]
        .filter(isLocalAdapter)
        .map((adapter) => adapter.closeObserver())
    );
  }
}
