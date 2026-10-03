// Synthetic directories only; Java is never started and no real world is read.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { buildApp } from '../../../apps/api/src/app.js';
import type { LocalMinecraftServerAdapter } from '../../../apps/api/src/adapters/contract.js';
import { createMockAdapters } from '../../../apps/api/src/fixtures/servers.js';
import { systemClock } from '../../../apps/api/src/clock.js';
import { TransactionJournalStore } from '../../../apps/api/src/services/transaction-journal.js';
import { ActiveWorldStateStore } from '../../../apps/api/src/services/active-world-state-store.js';

const parent = await mkdtemp(path.join(tmpdir(), 'mcsm-upload-e2e-'));
const managerRoot = path.join(parent, 'manager'), serverRoot = path.join(parent, 'server');
await mkdir(managerRoot); await mkdir(path.join(serverRoot, 'world'), { recursive: true });
function text(value: string) { const bytes = Buffer.from(value), length = Buffer.alloc(2); length.writeUInt16BE(bytes.length); return Buffer.concat([length, bytes]); }
await writeFile(path.join(serverRoot, 'world', 'level.dat'), gzipSync(Buffer.concat([
  Buffer.from([10]), text(''), Buffer.from([10]), text('Data'), Buffer.from([10]), text('Version'),
  Buffer.from([8]), text('Name'), text('26.3'), Buffer.from([0, 0, 0])
])));
await writeFile(path.join(serverRoot, 'server.properties'), 'level-name=world\nrcon.password=synthetic-private-sentinel\n');
const mock = createMockAdapters(systemClock)[0]!;
const info = { ...await mock.getServerInfo(), id: 'vanilla-upload', name: 'Isolated upload fixture', type: 'vanilla' as const, minecraftVersion: '26.3' };
const adapter = { mode: 'local', serverId: info.id, plan: { rootPath: serverRoot, serverInfo: info },
  getServerInfo: async () => info, getCapabilities: () => mock.getCapabilities(),
  getStatus: async () => ({ state: 'stopped', ownership: 'none', source: 'process', observedAt: new Date().toISOString(), activeOperationId: null, recoveryRequired: false }),
  getCommandTransport: async () => 'unavailable', getMetrics: () => mock.getMetrics(), getActivity: () => mock.getActivity(), getAlerts: () => mock.getAlerts(),
  subscribe: () => () => {}, closeObserver: async () => {}
} as unknown as LocalMinecraftServerAdapter;
const journal = new TransactionJournalStore(managerRoot);
const activeWorldState = new ActiveWorldStateStore(managerRoot, [adapter]);
const app = buildApp({ adapters: [adapter], mode: 'local', managerRoot, transactionJournal: journal, activeWorldState });
await app.listen({ host: '127.0.0.1', port: 8080 });
console.log('Synthetic upload API; no Minecraft process');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close().then(() => process.exit(0)); });
