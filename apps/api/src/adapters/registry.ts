import {
  isLocalAdapter,
  type LocalMinecraftServerAdapter,
  type MinecraftServerAdapter
} from "./contract.js";

export class AdapterRegistry {
  #closed = false;
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

  /** Publish a prepared adapter synchronously; never replace an existing instance. */
  add(adapter: MinecraftServerAdapter): void {
    if (this.#closed || this.#adapters.has(adapter.serverId)) throw new Error('Adapter registry closed or duplicate ID');
    this.#adapters.set(adapter.serverId, adapter);
  }

  async close(): Promise<void> {
    this.#closed = true;
    await Promise.all(
      [...this.#adapters.values()]
        .filter(isLocalAdapter)
        .map((adapter) => adapter.closeObserver())
    );
  }
}
