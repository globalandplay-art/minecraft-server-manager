// Fresh synthetic Vanilla world trees only; no Java launch or user server access.
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { buildApp } from '../../../apps/api/src/app.js';
import type { LocalMinecraftServerAdapter } from '../../../apps/api/src/adapters/contract.js';
import { createMockAdapters } from '../../../apps/api/src/fixtures/servers.js';
import { TransactionJournalStore } from '../../../apps/api/src/services/transaction-journal.js';
import { ActiveWorldStateStore } from '../../../apps/api/src/services/active-world-state-store.js';
const parent = await mkdtemp(path.join(tmpdir(), 'mcsm-policy-e2e-'));
console.log(`CONFIRMED FRESH SYNTHETIC POLICY CANONICAL PATH: ${await realpath(parent)}`);
const managerRoot = path.join(parent, 'manager'); await mkdir(managerRoot);
let time = Date.parse('2026-10-01T00:00:00.000Z'); const clock = { now: () => new Date(time) };
function text(value: string) { const bytes = Buffer.from(value), length = Buffer.alloc(2); length.writeUInt16BE(bytes.length); return Buffer.concat([length, bytes]); }
const level = gzipSync(Buffer.concat([Buffer.from([10]), text(''), Buffer.from([10]), text('Data'), Buffer.from([10]), text('Version'), Buffer.from([8]), text('Name'), text('26.3'), Buffer.from([0, 0, 0])]));
const mock = createMockAdapters(clock)[0]!, adapters: LocalMinecraftServerAdapter[] = [];
for (const width of [360, 768, 1440]) {
  const root = path.join(parent, `server-${width}`); await mkdir(path.join(root, 'world'), { recursive: true });
  await writeFile(path.join(root, 'world', 'level.dat'), level);
  for (const folder of ['region', 'DIM-1/region', 'DIM1/region', 'playerdata', 'data']) {
    await mkdir(path.join(root, 'world', folder), { recursive: true }); await writeFile(path.join(root, 'world', folder, 'marker.dat'), `policy-marker:${folder}`);
  }
  await writeFile(path.join(root, 'server.properties'), 'level-name=world\nrcon.password=synthetic-private-sentinel\n');
  const info = { ...await mock.getServerInfo(), id: `vanilla-policy-${width}`, name: `Policy fixture ${width}`, type: 'vanilla' as const, minecraftVersion: '26.3' };
  adapters.push({ mode: 'local', serverId: info.id, plan: { rootPath: root, serverInfo: info, eulaAccepted: true }, getServerInfo: async () => info,
    getCapabilities: () => mock.getCapabilities(), getStatus: async () => ({ state: 'stopped', ownership: 'none', source: 'process', observedAt: clock.now().toISOString(), activeOperationId: null, recoveryRequired: false }),
    getCommandTransport: async () => 'unavailable', getMetrics: () => mock.getMetrics(), getActivity: () => mock.getActivity(), getAlerts: () => mock.getAlerts(),
    start: async () => { throw new Error('Synthetic policy fixture must not start Java'); }, subscribe: () => () => {}, closeObserver: async () => {}
  } as unknown as LocalMinecraftServerAdapter);
}
const app = buildApp({ adapters, mode: 'local', clock, managerRoot, backupSchedulerTimers: false,
  transactionJournal: new TransactionJournalStore(managerRoot), activeWorldState: new ActiveWorldStateStore(managerRoot, adapters) });
const headers = { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:3000', 'x-manager-intent': 'local-ui' };
for (let day = 0; day < 3; day++) {
  time = Date.parse('2026-10-01T00:00:00.000Z') + day * 86400000;
  for (const adapter of adapters) {
    const accepted = await app.inject({ method: 'POST', url: `/api/v1/servers/${adapter.serverId}/backups`, headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { scope: 'world-set', allowStop: false, label: `Old fixture ${day}` } });
    if (accepted.statusCode !== 202) throw new Error(`Seed backup rejected ${accepted.statusCode}: ${accepted.body}`);
    const id = accepted.json().data.operation.id, deadline = Date.now() + 30_000;
    while (true) {
      const operation = (await app.inject({ url: `/api/v1/operations/${id}`, headers })).json().data;
      if (operation.state === 'succeeded') break;
      if (['failed', 'interrupted'].includes(operation.state) || Date.now() > deadline) throw new Error(`Seed backup did not succeed: ${JSON.stringify(operation)}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}
time = Date.parse('2026-11-01T00:00:00.000Z');
await app.listen({ host: '127.0.0.1', port: 8080 });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close().then(() => process.exit(0)); });
