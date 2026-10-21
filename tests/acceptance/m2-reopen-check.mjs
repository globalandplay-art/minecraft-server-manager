// Fresh Manager process, existing successful isolated M2 evidence; never launch Minecraft.
import assert from 'node:assert/strict';
import { readFile, writeFile, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildApp } from '../../apps/api/src/app.ts';
import { createLocalAdapters } from '../../apps/api/src/config/bootstrap.ts';
import { LocalRuntimeFactory } from '../../apps/api/src/infra/runtime/index.ts';
import { JsonOperationStore } from '../../apps/api/src/services/operation-store.ts';
import { ActiveWorldStateStore } from '../../apps/api/src/services/active-world-state-store.ts';

const runId = process.argv[2];
assert(/^m2-(?:multi|loaders)-real-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(runId ?? ''));
const workspace = fileURLToPath(new URL('../../', import.meta.url)), manager = path.join(workspace, '.manager', runId);
async function plainDirectory(directory) {
  for (let cursor = directory;; cursor = path.dirname(cursor)) {
    const stat = await lstat(cursor); assert(stat.isDirectory() && !stat.isSymbolicLink());
    assert.equal((await realpath(cursor)).toLowerCase(), path.resolve(cursor).toLowerCase());
    if (cursor === path.dirname(cursor)) break;
  }
}
async function readJson(file) {
  await plainDirectory(path.dirname(file));
  const stat = await lstat(file); assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 1024 ** 2);
  return JSON.parse(await readFile(file, 'utf8'));
}
await plainDirectory(manager);
const baseline = await readJson(path.join(manager, 'acceptance-report.json'));
assert.equal(baseline.runId, runId); assert.equal(baseline.businessResult, 'PASS'); assert.equal(baseline.finalStopped, true);
const restartId = baseline.restartId ?? 'm2-a'; assert(['m2-a', 'm2-b'].includes(restartId));
const expectedSet = ['m2-a:start', `${restartId}:restart`, 'm2-a:stop', 'm2-b:start', 'm2-b:stop'].sort();
assert.equal(baseline.operations.length, 5); assert.equal(new Set(baseline.operations.map(row => row.id)).size, 5);
assert.deepEqual(baseline.operations.map(row => `${row.serverId}:${row.kind}`).sort(), expectedSet);
const rawConfig = await readJson(path.join(manager, 'config.json'));
const registrationConfig = await readJson(path.join(workspace, '.manager/config.json'));
const profile = registrationConfig.servers.find(row => row.id === 'vanilla-26-3'); assert(profile);
assert.equal(rawConfig.servers.length, 2);
assert.deepEqual(rawConfig.servers.map(row => row.id).sort(), ['m2-a', 'm2-b']);
for (const row of rawConfig.servers) {
  assert(['m2-a', 'm2-b'].includes(row.id));
  assert.equal(row.root, path.join(workspace, 'runtime', runId, row.id)); assert.equal(row.javaExecutable, profile.javaExecutable);
  for (let cursor = row.root;; cursor = path.dirname(cursor)) {
    assert(!(await lstat(cursor)).isSymbolicLink()); if (cursor === path.dirname(cursor)) break;
  }
  assert.equal((await realpath(row.root)).toLowerCase(), row.root.toLowerCase());
}
let app, launchAttempts = 0;
const result = { runId, result: 'BLOCKED', managerProcessPid: process.pid, checkedOperations: [], statuses: [], launchAttempts: 0 };
try {
  const factory = new LocalRuntimeFactory({ spawnProcess() { launchAttempts++; throw new Error('FORBIDDEN_MINECRAFT_LAUNCH_IN_REOPEN_CHECK'); } });
  const store = new JsonOperationStore(manager); await store.initialize();
  const records = await store.list();
  assert.equal(records.length, 5);
  // Verify the entire replay set before issuing ANY HTTP write request.
  for (const expected of baseline.operations) {
    const record = records.find(row => row.operation.id === expected.id); assert(record);
    assert.equal(record.operation.state, 'succeeded'); assert.equal(record.operation.serverId, expected.serverId); assert.equal(record.operation.kind, expected.kind);
    assert.equal(record.requestFingerprint, createHash('sha256').update(`${expected.serverId}\n${expected.kind}\n{}`).digest('hex'));
    assert(Date.parse(record.expiresAt) - Date.now() > 120000, 'replay key near expiry');
  }
  const adapters = await createLocalAdapters(manager, factory);
  app = buildApp({ mode: 'local', adapters, managerRoot: manager, localRuntimeFactory: factory,
    activeWorldState: new ActiveWorldStateStore(manager, adapters), operationStore: store, backupSchedulerTimers: false }); await app.ready();
  for (const expected of baseline.operations) {
    const record = records.find(row => row.operation.id === expected.id); assert(record); assert.equal(record.operation.state, 'succeeded');
    const response = await app.inject({ method: 'POST', url: `/api/v1/servers/${expected.serverId}/actions/${expected.kind}`, payload: {},
      headers: { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:3000', 'x-manager-intent': 'local-ui', 'idempotency-key': record.idempotencyKey } });
    assert.equal(response.statusCode, 202); const operation = response.json().data.operation;
    assert.equal(operation.id, expected.id); assert.equal(operation.state, 'succeeded'); result.checkedOperations.push(operation.id);
  }
  for (const adapter of adapters) {
    const response = await app.inject({ method: 'GET', url: `/api/v1/servers/${adapter.serverId}`, headers: { host: '127.0.0.1:8080' } });
    assert.equal(response.statusCode, 200); const status = response.json().data.status;
    assert.equal(status.state, 'stopped'); assert.equal(status.ownership, 'none'); assert.equal(status.recoveryRequired, false); assert.equal(status.activeOperationId, null);
    result.statuses.push({ serverId: adapter.serverId, ...status });
  }
  assert.equal(launchAttempts, 0); result.result = 'PASS';
} catch (error) { result.errorCode = error.code ?? 'NO_EXPLICIT_ERROR_CODE'; result.error = String(error.message); }
finally {
  result.launchAttempts = launchAttempts;
  try { if (app) await app.close(); result.helpersClosed = true; } catch { result.helpersClosed = false; result.result = 'BLOCKED'; }
  await plainDirectory(manager);
  await writeFile(path.join(manager, 'manager-reopen-check.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(`${result.result}: Manager reopen ${runId}; launchAttempts=${launchAttempts}`); process.exitCode = result.result === 'PASS' ? 0 : 1;
}
