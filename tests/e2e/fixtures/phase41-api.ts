// Deterministic read-only transport fixture. No Java, filesystem/world access or secrets.
import { buildApp } from '../../../apps/api/src/app.js';
import { createMockAdapters } from '../../../apps/api/src/fixtures/servers.js';
import type { LocalMinecraftServerAdapter } from '../../../apps/api/src/adapters/contract.js';
const clock = { now: () => new Date() };
const mock = createMockAdapters(clock)[0]!;
const base = await mock.getServerInfo();
const adapters: LocalMinecraftServerAdapter[] = [];
for (const width of [360, 768, 1440]) for (const kind of ['names', 'empty', 'stopped']) {
  const info = { ...base, id: `players-${kind}-${width}`, name: `Players ${kind} ${width}`, type: 'vanilla' as const };
  adapters.push({ mode: 'local', serverId: info.id, plan: { serverInfo: info, eulaAccepted: true },
    getServerInfo: async () => info, getCapabilities: () => mock.getCapabilities(),
    getMetrics: () => mock.getMetrics(), getActivity: async () => [], getAlerts: async () => [],
    getStatus: async () => ({ state: kind === 'stopped' ? 'stopped' : 'running', ownership: kind === 'stopped' ? 'none' : 'managed', source: 'process',
      observedAt: clock.now().toISOString(), activeOperationId: null, recoveryRequired: false }),
    getCommandTransport: async () => kind === 'stopped' ? 'unavailable' : 'rcon',
    command: async (line: string) => {
      if (line !== 'list' || kind === 'stopped') throw new Error('Fixture only permits fixed list');
      return { status: 'executed', transport: 'rcon', output: kind === 'names' ?
        'There are 2 of a max of 20 players online: Steve, Alex' : 'There are 0 of a max of 20 players online: ' };
    }, subscribe: () => () => {}, closeObserver: async () => {}
  } as unknown as LocalMinecraftServerAdapter);
}
const app = buildApp({ adapters, mode: 'local', clock });
await app.listen({ host: '127.0.0.1', port: 8080 });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
