// Harness regression only: real HTTP/browser/filesystem, synthetic lifecycle.
// Never starts Java and never establishes P3.5 real acceptance PASS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { buildApp } from '../../apps/api/src/app.ts';
import { createMockAdapters } from '../../apps/api/src/fixtures/servers.ts';
import { TransactionJournalStore } from '../../apps/api/src/services/transaction-journal.ts';
import { JsonOperationStore } from '../../apps/api/src/services/operation-store.ts';
import { ActiveWorldStateStore } from '../../apps/api/src/services/active-world-state-store.ts';
import { inventoryRestoreTree, verifyRestoreTree } from '../../apps/api/src/services/restore-files.ts';
import { runBrowserAcceptance, faultCheckpoint, assertHTTPPortsFree } from './phase35-browser-flow.mjs';
const workspace = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const parent = await mkdtemp(path.join(tmpdir(), 'mcsm-p35-browser-synthetic-'));
console.log(`CONFIRMED NEW SYNTHETIC CANONICAL PATH: ${await realpath(parent)}`);
const serverRoot = path.join(parent, 'server'), managerRoot = path.join(parent, 'manager'), evidenceRoot = path.join(parent, 'evidence');
for (const dir of [serverRoot, managerRoot, evidenceRoot]) await mkdir(dir);
const root = path.join(serverRoot, 'generated-world'); await mkdir(root);
function text(value) { const bytes = Buffer.from(value), length = Buffer.alloc(2); length.writeUInt16BE(bytes.length); return Buffer.concat([length, bytes]); }
await writeFile(path.join(root, 'level.dat'), gzipSync(Buffer.concat([Buffer.from([10]), text(''), Buffer.from([10]), text('Data'), Buffer.from([10]), text('Version'), Buffer.from([8]), text('Name'), text('26.3'), Buffer.from([0, 0, 0])])));
for (const dir of ['region', 'DIM-1/region', 'DIM1/region', 'playerdata', 'data']) { await mkdir(path.join(root, dir), { recursive: true }); await writeFile(path.join(root, dir, 'marker.dat'), 'synthetic:' + dir); }
await writeFile(path.join(serverRoot, 'server.properties'), 'level-name=generated-world\n');
const id = 'p35-synthetic', base = `/api/v1/servers/${id}`, clock = { now: () => new Date() };
const mock = createMockAdapters(clock)[0], info = { ...await mock.getServerInfo(), id, type: 'vanilla', minecraftVersion: '26.3' };
const state = { state: 'stopped', ownership: 'none', source: 'process', observedAt: clock.now().toISOString(), activeOperationId: null, recoveryRequired: false };
const adapter = { mode: 'local', serverId: id, plan: { rootPath: serverRoot, serverInfo: info, eulaAccepted: true }, getServerInfo: async () => info,
  getCapabilities: () => mock.getCapabilities(), getStatus: async () => ({ ...state, observedAt: clock.now().toISOString() }),
  getCommandTransport: async () => state.state === 'running' ? 'rcon' : 'unavailable', getMetrics: () => mock.getMetrics(), getActivity: () => mock.getActivity(), getAlerts: () => mock.getAlerts(),
  start: async () => { throw new Error('Synthetic harness must never start Java'); }, subscribe: () => () => {}, closeObserver: async () => {} };
let app, journal, armed = false, count = 0;
async function openApp() {
  journal = new TransactionJournalStore(managerRoot);
  const append = journal.appendCheckpoint.bind(journal);
  journal.appendCheckpoint = async (sid, tid, point) => { const record = await append(sid, tid, point);
    if (armed && sid === id && record.intent.kind === 'restore' && point.name === faultCheckpoint) { armed = false; count++; throw new Error('synthetic known interruption'); } return record; };
  app = buildApp({ adapters: [adapter], mode: 'local', managerRoot, backupSchedulerTimers: false, transactionJournal: journal,
    operationStore: new JsonOperationStore(managerRoot), activeWorldState: new ActiveWorldStateStore(managerRoot, [adapter]) }); await app.ready();
}
const headers = { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:3000', 'x-manager-intent': 'local-ui' };
async function request(url, payload) { const r = await app.inject({ method: payload ? 'POST' : 'GET', url, headers: { ...headers, 'idempotency-key': randomUUID() }, ...(payload ? { payload } : {}) });
  assert(r.statusCode < 300, `${r.statusCode} ${r.body}`); return r.json().data; }
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function terminal(get, op) { const deadline = Date.now() + 30_000; while (true) { const result = await get(op); if (['succeeded', 'failed', 'interrupted'].includes(result.state)) return result;
  assert(Date.now() < deadline, 'synthetic operation deadline'); await wait(20); } }
async function command(line) {
  const dimension = line.match(/execute in (\S+)/u)?.[1]; const dir = ({ 'minecraft:overworld': 'region', 'minecraft:the_nether': 'DIM-1/region', 'minecraft:the_end': 'DIM1/region' })[dimension]; assert(dir);
  const marker = path.join(root, dir, 'marker.dat');
  if (line.includes('run setblock')) await writeFile(marker, line.split(' ').at(-1));
  if (line.includes('if block')) assert.equal(await readFile(marker, 'utf8'), line.split(' ').at(-1));
  return 'Test passed'; // Explicit synthetic callback; no RCON or Java claim.
}
const report = { result: 'SYNTHETIC_RUNNING', realAcceptance: 'NOT_RUN', browserRuns: [] };
try {
  await openApp();
  await runBrowserAcceptance({ workspace, serverRoot, managerRoot, evidenceRoot, id, base, report, request, terminal,
    start: async () => { state.state = 'running'; state.ownership = 'managed'; }, stop: async () => { state.state = 'stopped'; state.ownership = 'none'; }, command,
    manifest: async (bid) => JSON.parse(await readFile(path.join(managerRoot, 'backups', id, bid, 'manifest.json'), 'utf8')),
    verifyRestoreTree, inventoryRestoreTree, openApp, closeApp: async () => { await app.close(); app = undefined; }, wait,
    getJournal: () => journal, armFault: () => { assert(!armed); armed = true; }, faultCount: () => count,
    listen: () => app.listen({ host: '127.0.0.1', port: 8080 }), check: (message) => console.log(`SYNTHETIC PASS: ${message}`),
    rejectStart: () => app.inject({ method: 'POST', url: `${base}/actions/start`, headers: { ...headers, 'idempotency-key': randomUUID() }, payload: {} }) });
  report.result = 'SYNTHETIC_PASS';
} catch (error) { report.result = 'SYNTHETIC_FAIL'; report.error = error.stack; console.error(error); process.exitCode = 1; }
finally { await app?.close(); await assertHTTPPortsFree(); await writeFile(path.join(evidenceRoot, 'synthetic-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ result: report.result, realAcceptance: report.realAcceptance, evidenceRoot })); }
