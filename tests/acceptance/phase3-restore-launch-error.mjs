// Supplements a failed isolated run without suppressing Minecraft ERROR logs.
// node --import tsx tests/acceptance/phase3-restore-launch-error.mjs p32-real-<UUID>
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../apps/api/src/app.ts';
import { createLocalAdapters } from '../../apps/api/src/config/bootstrap.ts';
import { LocalRuntimeFactory } from '../../apps/api/src/infra/runtime/index.ts';
import { JsonOperationStore } from '../../apps/api/src/services/operation-store.ts';
import { OperationService } from '../../apps/api/src/services/operation-service.ts';
import { TransactionJournalStore } from '../../apps/api/src/services/transaction-journal.ts';
import { ActiveWorldStateStore } from '../../apps/api/src/services/active-world-state-store.ts';
import { AdapterRegistry } from '../../apps/api/src/adapters/registry.ts';
import { BackupService } from '../../apps/api/src/services/backup-service.ts';
import { RestoreService } from '../../apps/api/src/services/restore-service.ts';
import { verifyRestoreTree } from '../../apps/api/src/services/restore-files.ts';

const runId = process.argv[2];
assert(/^p32-real-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(runId ?? ''), 'isolated run ID required');
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const managerRoot = path.join(workspace, '.manager', runId);
const serverRoot = path.join(workspace, 'runtime', runId);
const config = JSON.parse(await readFile(path.join(managerRoot, 'config.json'), 'utf8'));
assert.equal(config.servers.length, 1); assert.equal(config.servers[0].root, serverRoot);
const originalReport = JSON.parse(await readFile(path.join(managerRoot, 'acceptance-report.json'), 'utf8'));
assert.equal(originalReport.runId, runId); assert.equal(originalReport.finalStatus, 'stopped'); assert.equal(originalReport.result, 'FAIL');
const id = config.servers[0].id; const base = `/api/v1/servers/${id}`;
const headers = { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:3000', 'x-manager-intent': 'local-ui' };
const clock = { now: () => new Date() }; const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { schemaVersion: 1, runId, startedAt: new Date().toISOString(), result: 'RUNNING', checks: [], originalAcceptanceResult: 'FAIL' };
const check = (text) => { report.checks.push(text); console.log(`PASS: ${text}`); };
let app; let adapters = []; let launches = 0; let subscriptions = [];
async function open() {
  adapters = await createLocalAdapters(managerRoot, new LocalRuntimeFactory());
  assert(adapters.every((a) => a.plan.rootPath === serverRoot));
  subscriptions = adapters.map((a) => a.subscribe((event) => { if (event.type === 'status' && event.status.state === 'starting') launches++; }));
  const journal = new TransactionJournalStore(managerRoot);
  app = buildApp({ mode: 'local', adapters, managerRoot, transactionJournal: journal, transactionRecovery: journal,
    operationStore: new JsonOperationStore(managerRoot), activeWorldState: new ActiveWorldStateStore(managerRoot, adapters) });
  await app.ready();
}
async function close() { for (const unsubscribe of subscriptions) unsubscribe(); subscriptions = []; if (app) await app.close(); app = undefined; }
async function request(url, payload) {
  const response = await app.inject({ method: payload === undefined ? 'GET' : 'POST', url,
    headers: { ...headers, 'idempotency-key': randomUUID() }, ...(payload === undefined ? {} : { payload }) });
  assert(response.statusCode < 300, `API ${url.split('/').at(-1)} rejected (${response.statusCode})`); return response.json().data;
}
async function terminal(service, operationId) {
  for (let n = 0; n < 300; n++) { const op = await service(operationId); if (['succeeded', 'failed', 'interrupted'].includes(op.state)) return op; await wait(100); }
  throw new Error('supplemental operation timeout');
}
async function rollback(parentId) {
  const plan = await request(`${base}/operations/${parentId}/rollback`);
  const m = JSON.parse(await readFile(path.join(managerRoot, 'backups', id, plan.backupId, 'manifest.json'), 'utf8'));
  assert.equal(m.pinned, true);
  const accepted = await request(`${base}/operations/${parentId}/rollback`, { confirmWorldName: plan.worldName, worldRevision: plan.worldRevision, startAfterRollback: false });
  assert.equal((await terminal((operationId) => request(`/api/v1/operations/${operationId}`), accepted.operation.id)).state, 'succeeded');
  await verifyRestoreTree(path.join(serverRoot, plan.worldName), m.files.map((f) => ({ ...f, path: f.path.slice(plan.worldName.length + 1) })));
  assert.equal(JSON.parse(await readFile(path.join(managerRoot, 'backups', id, plan.backupId, 'manifest.json'), 'utf8')).pinned, true);
}
try {
  await open(); const journal = new TransactionJournalStore(managerRoot); const scan = await journal.scan();
  const parent = scan.records.filter((r) => r.intent.kind === 'restore' && r.intent.restore?.startAfter && r.state === 'recovery-required').at(-1);
  assert(parent, 'failed explicit launch transaction required');
  assert(parent.checkpoints.some((c) => c.name === 'start-intent'));
  assert(!parent.checkpoints.some((c) => c.name === 'start-verified'));
  assert.equal((await request(`/api/v1/operations/${parent.intent.operationId}`)).state, 'interrupted');
  let state = (await request(base)).status;
  assert.equal(state.state, 'stopped'); assert.equal(state.ownership, 'none'); assert.equal(state.recoveryRequired, true);
  const logs = await adapters[0].getLogs(undefined, 500);
  const errors = logs.items.filter((line) => line.level === 'error');
  assert(errors.some((line) => line.text.includes('Unable to locate English counter names in registry Perflib 009')));
  report.diagnostics = logs.items.filter((line) => /Perflib 009|COM exception querying Win32_|Unable to locate English counter names|Win32Exception:|Error 0x80070057/u.test(line.text)).map((line) => ({ level: line.level, text: line.text }));
  check('actual Perflib ERROR prevents restore commit, preserves recovery gate and confirms graceful stopped state');
  await rollback(parent.intent.operationId);
  state = (await request(base)).status;
  assert.equal(state.state, 'stopped'); assert.equal(state.recoveryRequired, false); assert.equal(launches, 0);
  check('pinned guard survives and explicit rollback restores all world files without implicit start');

  await close(); adapters = await createLocalAdapters(managerRoot, new LocalRuntimeFactory());
  const ops = new OperationService(new JsonOperationStore(managerRoot), clock, journal); await ops.initialize();
  const registry = new AdapterRegistry(adapters); const backups = new BackupService(registry, ops, journal, managerRoot, clock);
  const failing = new RestoreService(registry, ops, backups, journal, managerRoot, clock, async (point) => { if (point === 'after:rename-old') throw new Error('controlled crash window'); });
  const plan = await failing.plan(id, parent.intent.restore.backupId);
  const accepted = await failing.restore(id, plan.backupId, { restoreScope: 'world-set', confirmWorldName: plan.worldName, worldRevision: plan.worldRevision, allowStop: true, startAfterRestore: false }, randomUUID());
  assert.equal((await terminal(async (operationId) => ops.get(operationId), accepted.id)).state, 'interrupted');
  for (const adapter of adapters) await adapter.closeObserver(); adapters = [];
  await open(); assert.equal((await request(base)).status.recoveryRequired, true);
  const blocked = await app.inject({ method: 'POST', url: base + '/actions/start', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: {} });
  assert.equal(blocked.statusCode, 409); assert.equal(blocked.json().error.code, 'RECOVERY_REQUIRED');
  await rollback(accepted.id); assert.equal((await request(base)).status.recoveryRequired, false); assert.equal(launches, 0);
  check('physical rename interruption survives manager restart; start is blocked and explicit rollback clears only verified recovery');
  report.result = 'BLOCKED'; report.blockedGate = 'Successful restore/rollback launch: actual host Perflib ERROR must be resolved without suppressing detection';
  report.minecraftVersion = originalReport.minecraftVersion; report.javaVersion = originalReport.javaVersion;
  process.exitCode = 2;
} catch (error) { report.result = 'FAIL'; report.error = String(error?.message ?? 'supplemental failure'); process.exitCode = 1; }
finally {
  if (adapters.length) report.finalStatus = (await adapters[0].getStatus()).state;
  if (report.finalStatus !== 'stopped') { report.result = 'FAIL'; report.cleanupError = 'isolated process is not confirmed stopped'; process.exitCode = 1; }
  await close(); report.finishedAt = new Date().toISOString();
  await writeFile(path.join(managerRoot, 'launch-error-evidence.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.result}: .manager/${runId}/launch-error-evidence.json`);
}
