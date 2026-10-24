// Real production app/services on an isolated local Manager root; no fake adapter/API.
import assert from 'node:assert/strict';
import path from 'node:path';
import { realpath, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../apps/api/src/app.ts';
import { createLocalAdapters } from '../../apps/api/src/config/bootstrap.ts';
import { LocalRuntimeFactory } from '../../apps/api/src/infra/runtime/index.ts';
import { ActiveWorldStateStore } from '../../apps/api/src/services/active-world-state-store.ts';
import { TransactionJournalStore } from '../../apps/api/src/services/transaction-journal.ts';
import { JsonOperationStore } from '../../apps/api/src/services/operation-store.ts';
import { OperationService } from '../../apps/api/src/services/operation-service.ts';
const workspace = fileURLToPath(new URL('../../', import.meta.url)), root = process.env.LT_M12_ROOT;
assert(root && path.dirname(root).toLowerCase() === path.join(workspace, 'test-results').toLowerCase());
assert(/^m12-real-[0-9a-f-]{36}$/u.test(path.basename(root))); assert.equal(await realpath(root), root);
assert(process.send, 'IPC fixture must be launched by its owner');
const children = [], requests = [];
const timingEnabled = process.env.LT_M3_COMPLETION_TIMING === '1';
const timingEvents = [], timingStates = new Set(['queued', 'running', 'succeeded', 'failed', 'interrupted']);
let timingOverflow = false;
function recordTiming(phase, operation) {
  try {
    if (!timingEnabled || operation.kind !== 'addon-change' || !/^neo-(360|768|1440)$/u.test(operation.serverId) ||
      !/^[0-9a-f-]{36}$/u.test(operation.id) || !timingStates.has(operation.state)) return;
    if (timingEvents.length >= 2000) { timingOverflow = true; return; }
    timingEvents.push({ phase, operationId: operation.id, serverId: operation.serverId, state: operation.state, atMs: performance.now() });
  } catch { /* Observation must not affect the original operation. */ }
}
let launchAttempts = 0;
const factory = new LocalRuntimeFactory({ spawnProcess(executable, argv, options) {
  launchAttempts++;
  assert.notEqual(process.env.LT_M12_FORBID_MINECRAFT, '1', 'Minecraft launch forbidden in registration-only acceptance');
  const relative = path.relative(root, options.cwd); assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  const child = spawn(executable, [...argv], options), row = { pid: child.pid, closed: false, stdout: '', stderr: '' }; children.push(row);
  for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => { if (row[stream].length < 1024 ** 2) row[stream] += chunk.toString('utf8'); });
  child.once('exit', (code, signal) => { row.exitCode = code; row.exitSignal = signal; }); child.once('close', () => { row.closed = true; }); return child;
} });
const manager = path.join(root, 'manager'), adapters = await createLocalAdapters(manager, factory);
const journal = new TransactionJournalStore(manager);
const operationStore = new JsonOperationStore(manager);
if (timingEnabled) {
  const append = journal.appendCheckpoint.bind(journal), setState = journal.setState.bind(journal);
  journal.appendCheckpoint = async (...args) => {
    const result = await append(...args);
    recordTiming(`journal-${args[2].name}`, { id: result.intent.operationId, serverId: result.intent.serverId, kind: 'addon-change', state: 'running' });
    return result;
  };
  journal.setState = async (...args) => {
    const result = await setState(...args);
    recordTiming(`journal-state-${args[2]}`, { id: result.intent.operationId, serverId: result.intent.serverId, kind: 'addon-change', state: 'running' });
    return result;
  };
  const save = operationStore.save.bind(operationStore);
  operationStore.save = async record => {
    recordTiming('store-save-begin', record.operation);
    try { await save(record); recordTiming('store-save-end', record.operation); }
    catch (error) { recordTiming('store-save-failed', record.operation); throw error; }
  };
}
const originalSubscribe = OperationService.prototype.subscribe;
if (timingEnabled) OperationService.prototype.subscribe = function (listener) {
  // Observe the existing synchronous publication listener, without adding scheduling or an await.
  return originalSubscribe.call(this, operation => { recordTiming('operation-emitted', operation); listener(operation); });
};
let app;
try { app = buildApp({ mode: 'local', managerRoot: manager, adapters, localRuntimeFactory: factory,
  activeWorldState: new ActiveWorldStateStore(manager, adapters), transactionJournal: journal, transactionRecovery: journal,
  operationStore, backupSchedulerTimers: false });
} finally { if (timingEnabled) OperationService.prototype.subscribe = originalSubscribe; }
app.addHook('onResponse', async (request, reply) => { if (requests.length < 3000) requests.push({ method: request.method, path: request.url.split('?')[0], status: reply.statusCode }); });
if (timingEnabled) app.addHook('onSend', (request, _reply, payload, done) => {
  try {
    if (request.method === 'GET' && /^\/api\/v1\/operations\/[0-9a-f-]{36}$/u.test(request.url) &&
      typeof payload === 'string' && Buffer.byteLength(payload) <= 65536) {
      recordTiming('operation-api-serialized', JSON.parse(payload).data);
    }
  } catch { timingOverflow = true; }
  done(null, payload);
});
await app.listen({ host: '127.0.0.1', port: 8080 }); process.send({ type: 'ready', mode: 'local', pid: process.pid });
process.on('message', async message => {
  if (message !== 'close') return;
  try {
    if (app.managerRecovery.available) {
      const items = (await app.inject({ method: 'GET', url: '/api/v1/servers', headers: { host: '127.0.0.1:8080' } })).json().data.items;
      assert(items.every(item => item.status.state === 'stopped' && item.status.ownership === 'none' && !item.status.activeOperationId), 'CLEANUP_BLOCKED: stop owned Minecraft first');
    } else assert(children.every(child => child.closed), 'CLEANUP_BLOCKED: owned child during startup');
    await app.close();
    for (const [index, row] of children.entries()) for (const stream of ['stdout', 'stderr']) await writeFile(path.join(root, `java-${process.pid}-${index}-${stream}.log`), row[stream]);
    let timingWriteFailed = false;
    if (timingEnabled) try { await writeFile(path.join(root, `manager-${process.pid}-timing.json`), JSON.stringify({ clock: 'manager-node-performance', overflow: timingOverflow, events: timingEvents }, null, 2), { flag: 'wx' }); }
    catch { timingWriteFailed = true; }
    process.send({ type: 'closed', pid: process.pid, requests, launchAttempts, recoveryStages: app.managerRecovery.stages, children: children.map(({ stdout, stderr, ...row }) => row),
      ...(timingEnabled ? { timingWriteFailed } : {}) }); process.disconnect();
  } catch { process.send({ type: 'close-blocked' }); }
});
