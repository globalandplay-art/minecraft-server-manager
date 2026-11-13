// Independent OS-process startup observation of an existing owned real fixture.
// Never launches Minecraft, sends a command, repairs evidence or deletes files.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../../apps/api/src/app.ts';
import { createLocalAdapters } from '../../apps/api/src/config/bootstrap.ts';
import { LocalRuntimeFactory } from '../../apps/api/src/infra/runtime/index.ts';
import { ActiveWorldStateStore } from '../../apps/api/src/services/active-world-state-store.ts';
import { JsonOperationStore } from '../../apps/api/src/services/operation-store.ts';
import { TransactionJournalStore } from '../../apps/api/src/services/transaction-journal.ts';
import { inventoryRestoreTree, restoreFilesChecksum } from '../../apps/api/src/services/restore-files.ts';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const runId = process.argv[2];
assert(/^worlds-v2-real-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(runId ?? ''));
const root = path.join(workspace, 'test-results', runId), managerRoot = path.join(root, 'manager'), serverRoot = path.join(root, 'server');
const normalize = value => path.resolve(value).toLowerCase();
for (let cursor = root;; cursor = path.dirname(cursor)) {
  const info = await lstat(cursor); assert(info.isDirectory() && !info.isSymbolicLink());
  assert.equal(normalize(await realpath(cursor)), normalize(cursor));
  if (path.dirname(cursor) === cursor) break;
}
for (const directory of [managerRoot, serverRoot]) {
  const info = await lstat(directory);
  assert(info.isDirectory() && !info.isSymbolicLink());
  assert.equal(normalize(await realpath(directory)), normalize(directory));
}
const checkedRead = async file => {
  const info = await lstat(file);
  assert(info.isFile() && !info.isSymbolicLink() && info.nlink === 1);
  assert.equal(normalize(await realpath(file)), normalize(file));
  return readFile(file);
};
const json = async relative => JSON.parse((await checkedRead(path.join(root, relative))).toString('utf8'));
const owner = await json('owner.json'), original = await json('result.json'), config = await json('manager/config.json');
assert.equal(owner.kind, 'lt-authorized-vanilla-fresh-copy'); assert.equal(owner.runId, runId);
assert.equal(original.result, 'PASS'); assert(original.cleanup.childrenClosed && original.cleanup.managerClosed && original.sourceUnchanged);
assert.equal(config.servers.length, 1); assert.equal(config.servers[0].id, 'v2-real-test');
assert.equal(normalize(config.servers[0].root), normalize(serverRoot));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(digest(await checkedRead(path.join(serverRoot, 'server.jar'))), owner.sourceJarSha256);
const java = config.servers[0].javaExecutable, javaInfo = await lstat(java);
assert(javaInfo.isFile() && !javaInfo.isSymbolicLink() && javaInfo.nlink === 1);
assert.equal(normalize(await realpath(java)), normalize(java));
assert.equal(digest(await readFile(java)), original.javaSha256);
const names = ['world', 'Imported-V2'];
const before = await Promise.all(names.map(async name => restoreFilesChecksum(await inventoryRestoreTree(path.join(serverRoot, name)))));
const configBefore = digest(await checkedRead(path.join(serverRoot, 'server.properties')));
const evidence = { result: 'BLOCKED', pid: process.pid, javaServerStarts: 0, javaVersionProbesAllowed: true, parentRunId: runId, recoveryAvailable: false,
  serverBytesUnchanged: false, managerClosed: false, errors: [] };
let app, adapters = [], timer;
try {
  const factory = new LocalRuntimeFactory({ spawnProcess() { evidence.javaServerStarts++; throw new Error('JAVA_START_FORBIDDEN'); } });
  adapters = await createLocalAdapters(managerRoot, factory);
  const journal = new TransactionJournalStore(managerRoot), states = new ActiveWorldStateStore(managerRoot, adapters);
  // Do not pre-initialize/repair a missing active slot. Production recovery owns
  // initialization and must reject ambiguous physical evidence before admission.
  app = buildApp({ mode: 'local', adapters, managerRoot, transactionJournal: journal,
    operationStore: new JsonOperationStore(managerRoot), activeWorldState: states, backupSchedulerTimers: false, worldActivationExecution: true });
  await app.ready();
  const deadline = Date.now() + 30_000;
  while (!app.managerRecovery.available && app.managerRecovery.state !== 'failed' && Date.now() < deadline) await delay(50);
  assert(app.managerRecovery.available, 'MANAGER_RECOVERY_NOT_CONFIRMED'); evidence.recoveryAvailable = true;
  const base = '/api/v1/servers/v2-real-test';
  const headers = { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:3000' };
  const library = await app.inject({ method: 'GET', url: `${base}/world-library`, headers }); assert.equal(library.statusCode, 200);
  const catalog = library.json().data; assert.equal(catalog.state, 'ready');
  assert.equal(catalog.items.find(item => item.worldId === catalog.activeWorldId)?.levelName, 'world');
  const summary = await app.inject({ method: 'GET', url: base, headers }); assert.equal(summary.statusCode, 200);
  assert.equal(summary.json().data.status.recoveryRequired, false); assert.equal(summary.json().data.status.state, 'stopped');
  evidence.stages = app.managerRecovery.stages; evidence.activeWorldId = catalog.activeWorldId;
  evidence.serverBytesUnchanged = configBefore === digest(await checkedRead(path.join(serverRoot, 'server.properties'))) &&
    (await Promise.all(names.map(async name => restoreFilesChecksum(await inventoryRestoreTree(path.join(serverRoot, name)))))).every((value, index) => value === before[index]);
  assert(evidence.serverBytesUnchanged); assert.equal(evidence.javaServerStarts, 0); evidence.result = 'PASS';
} catch (error) { evidence.errors.push(error.code ?? error.name); process.exitCode = 1; }
finally {
  try {
    await Promise.race([app ? app.close() : Promise.all(adapters.map(adapter => adapter.closeObserver())),
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('CLEANUP_BLOCKED')), 10_000); })]);
    evidence.managerClosed = true;
  } catch { evidence.errors.push('CLEANUP_BLOCKED'); evidence.result = 'BLOCKED'; process.exitCode = 1; }
  finally { clearTimeout(timer); }
  const file = `startup-observation-${randomUUID()}.json`;
  await writeFile(path.join(root, file), JSON.stringify(evidence, null, 2), { flag: 'wx' });
  console.log(`${evidence.result}: test-results/${runId}/${file}`);
}
