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
const workspace = fileURLToPath(new URL('../../', import.meta.url)), root = process.env.LT_M12_ROOT;
assert(root && path.dirname(root).toLowerCase() === path.join(workspace, 'test-results').toLowerCase());
assert(/^m12-real-[0-9a-f-]{36}$/u.test(path.basename(root))); assert.equal(await realpath(root), root);
assert(process.send, 'IPC fixture must be launched by its owner');
const children = [], requests = [];
const factory = new LocalRuntimeFactory({ spawnProcess(executable, argv, options) {
  const relative = path.relative(root, options.cwd); assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  const child = spawn(executable, [...argv], options), row = { pid: child.pid, closed: false, stdout: '', stderr: '' }; children.push(row);
  for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => { if (row[stream].length < 1024 ** 2) row[stream] += chunk.toString('utf8'); });
  child.once('exit', (code, signal) => { row.exitCode = code; row.exitSignal = signal; }); child.once('close', () => { row.closed = true; }); return child;
} });
const manager = path.join(root, 'manager'), adapters = await createLocalAdapters(manager, factory);
const journal = new TransactionJournalStore(manager);
const app = buildApp({ mode: 'local', managerRoot: manager, adapters, localRuntimeFactory: factory,
  activeWorldState: new ActiveWorldStateStore(manager, adapters), transactionJournal: journal, transactionRecovery: journal,
  operationStore: new JsonOperationStore(manager), backupSchedulerTimers: false });
app.addHook('onResponse', async (request, reply) => { if (requests.length < 3000) requests.push({ method: request.method, path: request.url.split('?')[0], status: reply.statusCode }); });
await app.listen({ host: '127.0.0.1', port: 8080 }); process.send({ type: 'ready', mode: 'local', pid: process.pid });
process.on('message', async message => {
  if (message !== 'close') return;
  try {
    const items = (await app.inject({ method: 'GET', url: '/api/v1/servers', headers: { host: '127.0.0.1:8080' } })).json().data.items;
    assert(items.every(item => item.status.state === 'stopped' && item.status.ownership === 'none' && !item.status.activeOperationId), 'CLEANUP_BLOCKED: stop owned Minecraft first');
    await app.close();
    for (const [index, row] of children.entries()) for (const stream of ['stdout', 'stderr']) await writeFile(path.join(root, `java-${process.pid}-${index}-${stream}.log`), row[stream]);
    process.send({ type: 'closed', pid: process.pid, requests, children: children.map(({ stdout, stderr, ...row }) => row) }); process.disconnect();
  } catch { process.send({ type: 'close-blocked' }); }
});
