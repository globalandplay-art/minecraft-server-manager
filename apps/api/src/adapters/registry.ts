import type { MinecraftServerAdapter } from "./contract.js";

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
}
