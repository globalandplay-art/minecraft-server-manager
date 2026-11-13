// Real Fastify/application services over owned synthetic files. Never starts Java.
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
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
import { WorldLibraryImportService } from '../../../apps/api/src/services/world-library-import-service.js';
import { testWorldLevel, testWorldZip } from '../../../apps/api/test/fixtures/world-library-content.js';

await mkdir('test-results', { recursive: true });
const root = await mkdtemp(path.resolve('test-results/worlds-v2-browser-'));
const managerRoot = path.join(root, 'manager'), serverRoot = path.join(root, 'server');
await mkdir(managerRoot); await mkdir(path.join(serverRoot, 'world'), { recursive: true });
await writeFile(path.join(root, 'owner.json'), JSON.stringify({ kind: 'lt-synthetic-browser-fixture', nonce: randomUUID(), javaAllowed: false }));
await writeFile(path.join(serverRoot, 'world', 'level.dat'), testWorldLevel('original'));
await writeFile(path.join(serverRoot, 'server.properties'), '# retained\nlevel-name=world\nmax-players=20\n');
const mock = createMockAdapters(systemClock)[0]!;
const serverInfo = { ...await mock.getServerInfo(), id: 'v2-browser', name: 'Synthetic V2 browser fixture', type: 'vanilla' as const, minecraftVersion: '26.3' };
const status = () => ({ state: 'stopped', ownership: 'none', source: 'process', observedAt: new Date().toISOString(), activeOperationId: null, recoveryRequired: false });
const adapter = { mode: 'local', serverId: serverInfo.id, plan: { rootPath: serverRoot, serverInfo, eulaAccepted: false },
  getServerInfo: async () => serverInfo, getStatus: async () => status(), getCapabilities: async () => ({ ...await mock.getCapabilities(), worlds: true }),
  getCommandTransport: async () => 'unavailable', getMetrics: () => mock.getMetrics(), getActivity: () => mock.getActivity(), getAlerts: () => mock.getAlerts(),
  subscribe: () => () => {}, closeObserver: async () => {},
  start: async () => { throw new Error('Java forbidden in synthetic fixture'); }, stop: async () => { throw new Error('Java forbidden in synthetic fixture'); },
  streamSnapshot: async () => ({ streamId: 'synthetic-runtime', latestSequence: 0, status: status(), logs: [] })
} as unknown as LocalMinecraftServerAdapter;
const registry = new AdapterRegistry([adapter]), journal = new TransactionJournalStore(managerRoot);
const store = new JsonOperationStore(managerRoot), operations = new OperationService(store, systemClock, journal); await operations.initialize();
const states = new ActiveWorldStateStore(managerRoot, [adapter]); await states.initialize();
const library = new WorldLibraryStore(managerRoot, systemClock); await library.migrateLegacy({ serverId: adapter.serverId, rootPath: serverRoot }, states.snapshot(adapter.serverId)!);
const uploads = new WorldImportUploadService(registry, operations, managerRoot, undefined, journal, systemClock);
const imports = new WorldLibraryImportService(registry, operations, journal, library, uploads, states, systemClock);
for (const width of [360, 768, 1440]) {
  const upload = await uploads.upload(adapter.serverId, `synthetic-${width}.zip`, Readable.from([testWorldZip(testWorldLevel(`synthetic-${width}`))]));
  const plan = await imports.plan(adapter.serverId, { name: `Browser-${width}`, uploadId: upload.id });
  const operation = await imports.importIndependent(adapter.serverId, plan, randomUUID());
  const deadline = Date.now() + 10_000;
  while (!['succeeded', 'failed', 'interrupted'].includes(operations.get(operation.id)?.state ?? '')) {
    if (Date.now() >= deadline) throw new Error('Synthetic import fixture deadline');
    await delay(20);
  }
  if (operations.get(operation.id)?.state !== 'succeeded') throw new Error('Synthetic import fixture failed');
}
const app = buildApp({ mode: 'local', adapters: [adapter], managerRoot, transactionJournal: journal, operationStore: store,
  activeWorldState: states, backupSchedulerTimers: false, worldActivationExecution: true });
await app.listen({ host: '127.0.0.1', port: 8080 });
console.log('Owned synthetic V2 browser API ready; Java disabled; evidence retained.');
let closing = false;
function close() {
  if (closing) return; closing = true;
  void app.close().then(async () => {
    await writeFile(path.join(root, 'closed.json'), JSON.stringify({ managerClosed: true, javaStarts: 0, javaStops: 0 }));
    process.exit(0);
  });
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, close);
process.on('message', message => { if (message && typeof message === 'object' && 'type' in message && message.type === 'close') close(); });
process.send?.({ type: 'ready' });
