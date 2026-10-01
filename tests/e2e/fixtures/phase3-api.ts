// Synthetic local filesystem only. No Minecraft process is launched.
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../../../apps/api/src/app.js';
import { AdapterRegistry } from '../../../apps/api/src/adapters/registry.js';
import type { LocalMinecraftServerAdapter } from '../../../apps/api/src/adapters/contract.js';
import { createMockAdapters } from '../../../apps/api/src/fixtures/servers.js';
import { systemClock } from '../../../apps/api/src/clock.js';
import { BackupService } from '../../../apps/api/src/services/backup-service.js';
import { OperationService } from '../../../apps/api/src/services/operation-service.js';
import { MemoryOperationStore } from '../../../apps/api/src/services/operation-store.js';
import { TransactionJournalStore } from '../../../apps/api/src/services/transaction-journal.js';

const parent = await mkdtemp(path.join(tmpdir(), 'mcsm-export-e2e-'));
const managerRoot = path.join(parent, 'manager'); const serverRoot = path.join(parent, 'synthetic-world');
await mkdir(managerRoot);
await mkdir(path.join(serverRoot, 'world', 'region'), { recursive: true });
await writeFile(path.join(serverRoot, 'world', 'level.dat'), 'synthetic level data');
await writeFile(path.join(serverRoot, 'world', 'region', 'r.0.0.mca'), 'synthetic region data');
await writeFile(path.join(serverRoot, 'server.properties'), 'level-name=world\nrcon.password=synthetic-private-sentinel\n');
await writeFile(path.join(serverRoot, 'server.jar'), 'synthetic jar, never executed');
await writeFile(path.join(serverRoot, 'eula.txt'), 'eula=false');
const mock = createMockAdapters(systemClock)[0]!;
const serverInfo = { ...await mock.getServerInfo(), id: 'vanilla-test', name: 'Synthetic export fixture', type: 'vanilla' as const };
const adapter = { mode: 'local', serverId: serverInfo.id,
  plan: { rootPath: serverRoot, jarPath: path.join(serverRoot, 'server.jar'), serverInfo, eulaAccepted: false },
  getServerInfo: async () => serverInfo, getCapabilities: () => mock.getCapabilities(),
  getStatus: async () => ({ state: 'stopped', ownership: 'none', source: 'process', observedAt: new Date().toISOString(), activeOperationId: null, recoveryRequired: false }),
  getCommandTransport: async () => 'unavailable', getMetrics: () => mock.getMetrics(), getActivity: () => mock.getActivity(), getAlerts: () => mock.getAlerts(),
  subscribe: () => () => {}, closeObserver: async () => {}
} as unknown as LocalMinecraftServerAdapter;
const journal = new TransactionJournalStore(managerRoot); await journal.initialize();
const store = new MemoryOperationStore(); const operations = new OperationService(store, systemClock, journal); await operations.initialize();
const backups = new BackupService(new AdapterRegistry([adapter]), operations, journal, managerRoot, systemClock);
for (const scope of ['world-set', 'server-snapshot'] as const) {
  const op = await backups.create(adapter.serverId, { scope, allowStop: false, label: 'Export browser fixture' }, randomUUID());
  const deadline = Date.now() + 10_000;
  while (!['succeeded', 'failed', 'interrupted'].includes(operations.get(op.id)?.state ?? '')) {
    if (Date.now() > deadline) throw new Error('fixture backup timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (operations.get(op.id)?.state !== 'succeeded') throw new Error('fixture backup failed');
}
const app = buildApp({ adapters: [adapter], mode: 'local', managerRoot, transactionJournal: journal, transactionRecovery: journal, operationStore: store });
await app.listen({ host: '127.0.0.1', port: 8080 });
console.log(`Synthetic export API PID ${process.pid}; no Minecraft process`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close().then(() => process.exit(0)); });
