// Actual Fastify/files/journals with synthetic NBT and forbidden Java execution.
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { buildApp } from '../../../apps/api/src/app.js';
import { createMockAdapters } from '../../../apps/api/src/fixtures/servers.js';
import type { LocalMinecraftServerAdapter } from '../../../apps/api/src/adapters/contract.js';
import { AdapterRegistry } from '../../../apps/api/src/adapters/registry.js';
import { systemClock } from '../../../apps/api/src/clock.js';
import { ActiveWorldStateStore } from '../../../apps/api/src/services/active-world-state-store.js';
import { WorldLibraryStore } from '../../../apps/api/src/services/world-library-store.js';
import { OperationService } from '../../../apps/api/src/services/operation-service.js';
import { JsonOperationStore } from '../../../apps/api/src/services/operation-store.js';
import { TransactionJournalStore } from '../../../apps/api/src/services/transaction-journal.js';
import { WorldImportUploadService } from '../../../apps/api/src/services/world-import-upload-service.js';
import { testWorldLevel, testWorldZip } from '../../../apps/api/test/fixtures/world-library-content.js';

await mkdir('test-results', { recursive: true });
const root = await mkdtemp(path.resolve('test-results/worlds-v2-replacement-browser-')), managerRoot = path.join(root, 'manager');
await mkdir(managerRoot); await writeFile(path.join(root, 'owner.json'), JSON.stringify({ kind: 'lt-synthetic-replacement-browser', nonce: randomUUID(), javaAllowed: false }));
const adapters: LocalMinecraftServerAdapter[] = []; let javaAttempts = 0;
for (const width of [360, 768, 1440]) {
  const serverRoot = path.join(root, `server-${width}`); await mkdir(path.join(serverRoot, 'world'), { recursive: true });
  await writeFile(path.join(serverRoot, 'world', 'level.dat'), testWorldLevel(`original-${width}`, true, 5023));
  await writeFile(path.join(serverRoot, 'server.properties'), '# retained\nlevel-name=world\nmax-players=20\n');
  const mock = createMockAdapters(systemClock)[0]!;
  const serverInfo = { ...await mock.getServerInfo(), id: `replace-${width}`, name: `Synthetic replacement ${width}`, type: 'vanilla' as const, minecraftVersion: '26.3' };
  const status = () => ({ state: 'stopped', ownership: 'none', source: 'process', observedAt: new Date().toISOString(), activeOperationId: null, recoveryRequired: false });
  adapters.push({ mode: 'local', serverId: serverInfo.id, plan: { rootPath: serverRoot, serverInfo, eulaAccepted: false },
    getServerInfo: async () => serverInfo, getStatus: async () => status(), getCapabilities: async () => ({ ...await mock.getCapabilities(), worlds: true }),
    getCommandTransport: async () => 'unavailable', getMetrics: () => mock.getMetrics(), getActivity: () => mock.getActivity(), getAlerts: () => mock.getAlerts(),
    subscribe: () => () => {}, closeObserver: async () => {},
    start: async () => { javaAttempts++; throw new Error('Java forbidden in synthetic fixture'); }, stop: async () => { javaAttempts++; throw new Error('Java forbidden in synthetic fixture'); },
    streamSnapshot: async () => ({ streamId: `synthetic-${width}`, latestSequence: 0, status: status(), logs: [] })
  } as unknown as LocalMinecraftServerAdapter);
}
const registry = new AdapterRegistry(adapters), journal = new TransactionJournalStore(managerRoot), store = new JsonOperationStore(managerRoot);
const operations = new OperationService(store, systemClock, journal); await operations.initialize();
const states = new ActiveWorldStateStore(managerRoot, adapters); await states.initialize();
const library = new WorldLibraryStore(managerRoot, systemClock), uploads = new WorldImportUploadService(registry, operations, managerRoot, undefined, journal, systemClock);
for (const adapter of adapters) {
  await library.migrateLegacy({ serverId: adapter.serverId, rootPath: adapter.plan.rootPath }, states.snapshot(adapter.serverId)!);
  await uploads.upload(adapter.serverId, 'synthetic.zip', Readable.from([testWorldZip(testWorldLevel(`new-${adapter.serverId}`, true, 5023))]));
}
const app = buildApp({ mode: 'local', adapters, managerRoot, transactionJournal: journal, operationStore: store,
  activeWorldState: states, backupSchedulerTimers: false, worldReplacementExecution: true });
await app.listen({ host: '127.0.0.1', port: 8080 });
console.log('Owned replacement browser API ready; synthetic worlds; Java forbidden.');
let closing = false;
function close() {
  if (closing) return; closing = true;
  void app.close().then(async () => {
    await writeFile(path.join(root, 'closed.json'), JSON.stringify({ managerClosed: true, javaAttempts })); process.exit(javaAttempts ? 1 : 0);
  });
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, close);
process.on('message', message => { if (message && typeof message === 'object' && 'type' in message && message.type === 'close') close(); });
process.send?.({ type: 'ready' });
