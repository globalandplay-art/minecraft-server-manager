// Fresh synthetic data only. No Java or user worlds are accessed.
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { buildApp } from '../../../apps/api/src/app.js';
import type { LocalMinecraftServerAdapter } from '../../../apps/api/src/adapters/contract.js';
import { createMockAdapters } from '../../../apps/api/src/fixtures/servers.js';
import { systemClock } from '../../../apps/api/src/clock.js';
import { TransactionJournalStore } from '../../../apps/api/src/services/transaction-journal.js';
import { ActiveWorldStateStore } from '../../../apps/api/src/services/active-world-state-store.js';
const parent = await mkdtemp(path.join(tmpdir(),'mcsm-archive-e2e-'));
console.log(`Fresh synthetic archive root: ${await realpath(parent)}`);
const managerRoot = path.join(parent,'manager'); await mkdir(managerRoot);
function text(value:string) { const bytes = Buffer.from(value),length = Buffer.alloc(2); length.writeUInt16BE(bytes.length); return Buffer.concat([length,bytes]); }
const level = gzipSync(Buffer.concat([Buffer.from([10]),text(''),Buffer.from([10]),text('Data'),Buffer.from([10]),text('Version'),Buffer.from([8]),text('Name'),text('26.3'),Buffer.from([0,0,0])]));
const mock = createMockAdapters(systemClock)[0]!;
const adapters:LocalMinecraftServerAdapter[] = [];
for (const width of [360,768,1440]) {
  const serverRoot = path.join(parent,`server-${width}`); await mkdir(path.join(serverRoot,'world'),{ recursive:true });
  await writeFile(path.join(serverRoot,'world','level.dat'),level);
  for (const folder of ['region','DIM-1/region','DIM1/region','playerdata','data']) {
    await mkdir(path.join(serverRoot,'world',folder),{ recursive:true }); await writeFile(path.join(serverRoot,'world',folder,'marker.dat'),'archive-marker:' + folder);
  }
  await writeFile(path.join(serverRoot,'server.properties'),'level-name=world\nrcon.password=synthetic-private-sentinel\n');
  const info = { ...await mock.getServerInfo(),id:`vanilla-archive-${width}`,name:`Archive fixture ${width}`,type:'vanilla' as const,minecraftVersion:'26.3' };
  adapters.push({ mode:'local',serverId:info.id,plan:{ rootPath:serverRoot,serverInfo:info,eulaAccepted:true },getServerInfo:async () => info,
    getCapabilities:() => mock.getCapabilities(),getStatus:async () => ({ state:'stopped',ownership:'none',source:'process',observedAt:new Date().toISOString(),activeOperationId:null,recoveryRequired:false }),
    getCommandTransport:async () => 'unavailable',getMetrics:() => mock.getMetrics(),getActivity:() => mock.getActivity(),getAlerts:() => mock.getAlerts(),
    start:async () => { throw new Error('Synthetic archive fixture must never start'); },subscribe:() => () => {},closeObserver:async () => {}
  } as unknown as LocalMinecraftServerAdapter);
}
const app = buildApp({ adapters,mode:'local',managerRoot,transactionJournal:new TransactionJournalStore(managerRoot),activeWorldState:new ActiveWorldStateStore(managerRoot,adapters) });
await app.listen({ host:'127.0.0.1',port:8080 });
for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,() => { void app.close().then(() => process.exit(0)); });
