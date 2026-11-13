// Independent Node invocation against a completed, owned isolated acceptance.
// Never launches Minecraft, retries a mutation, or clears a recovery gate.
// Existing registration detection may run the pinned Java binary with -version.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../apps/api/src/app.ts';
import { createLocalAdapters } from '../../apps/api/src/config/bootstrap.ts';
import { LocalRuntimeFactory } from '../../apps/api/src/infra/runtime/index.ts';
import { ActiveWorldStateStore } from '../../apps/api/src/services/active-world-state-store.ts';
import { JsonOperationStore } from '../../apps/api/src/services/operation-store.ts';
import { TransactionJournalStore } from '../../apps/api/src/services/transaction-journal.ts';
import { AdapterRegistry } from '../../apps/api/src/adapters/registry.ts';
import { OperationService } from '../../apps/api/src/services/operation-service.ts';
import { BackupService } from '../../apps/api/src/services/backup-service.ts';
import { WorldLibraryStore } from '../../apps/api/src/services/world-library-store.ts';
import { WorldGenerationService } from '../../apps/api/src/services/world-generation-service.ts';

const settlementMode = process.argv[3] === '--record-settlement';
assert.equal(process.argv.length, settlementMode ? 4 : 3);
const runId = process.argv[2];
assert.match(runId, /^worlds-v2-generation-real-[0-9a-f-]{36}$/u);
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const root = path.join(workspace, 'test-results', runId);
const managerRoot = path.join(root, 'manager'), serverRoot = path.join(root, 'server');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const directory of [workspace, path.join(workspace, 'test-results'), root, managerRoot, serverRoot]) {
  const stat = await lstat(directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink());
  assert.equal((await realpath(directory)).toLowerCase(), path.resolve(directory).toLowerCase());
}
const owner = JSON.parse(await readFile(path.join(root, 'owner.json'), 'utf8'));
const previous = JSON.parse(await readFile(path.join(root, 'result.json'), 'utf8'));
assert.equal(owner.kind, 'lt-authorized-vanilla-fresh-copy'); assert.equal(owner.runId, runId);
assert.equal(previous.result, 'PASS'); assert(previous.managedLifecycle);
assert.equal(previous.cleanup.childrenClosed, true); assert.equal(previous.cleanup.managerClosed, true);
assert.equal(previous.cleanup.generationClosed, true); assert.equal(previous.cleanup.forcedOwnedChildren, 0);
const candidateBytes = settlementMode ? await readFile(path.join(workspace, 'test-results/worlds-v2-settlement-candidate-2026-11-13.json')) : null;
const candidate = candidateBytes ? JSON.parse(candidateBytes.toString('utf8')) : previous.candidate;
for (const entry of candidate.files) {
  assert.equal(hash(await readFile(path.join(workspace, entry.path))), entry.sha256, 'CANDIDATE_CHANGED');
}
const configBytes = await readFile(path.join(managerRoot, 'config.json'));
const config = JSON.parse(configBytes);
assert.equal(config.servers.length, 1);
assert.equal(config.servers[0].id, 'v2-real-test');
assert.equal(path.resolve(config.servers[0].root).toLowerCase(), serverRoot.toLowerCase());
const registration = config.servers[0];
assert.equal(registration.jarFile, 'server.jar');
assert.deepEqual(registration.jvmArgs, ['-Xms512M', '-Xmx1G']);
assert.deepEqual(registration.serverArgs, ['nogui']);
for (const [file, expectedHash] of [[path.join(serverRoot, 'server.jar'), previous.sourceJarSha256],
  [registration.javaExecutable, previous.javaSha256]]) {
  assert(path.isAbsolute(file));
  const stat = await lstat(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  assert.equal((await realpath(file)).toLowerCase(), path.resolve(file).toLowerCase());
  assert.equal(hash(await readFile(file)), expectedHash);
}
let launches = 0, app, generation;
let adapters = [];
const result = { result: 'BLOCKED', runId, nodePid: process.pid, minecraftLaunches: 0,
  scope: settlementMode ? 'Separate Node process stopped-world historical settlement issuance plus read-only HTTP; no Minecraft launch or recovery release' :
    'Separate Node process buildApp startup and read-only HTTP; pinned Java -version detection permitted; no Minecraft launch or recovery release',
  candidateManifestSha256: candidateBytes ? hash(candidateBytes) : previous.candidate.manifestSha256,
  priorRealCandidateManifestSha256: previous.candidate.manifestSha256 };
try {
  adapters = await createLocalAdapters(managerRoot, new LocalRuntimeFactory({ spawnProcess() {
    launches++; throw new Error('MINECRAFT_START_FORBIDDEN');
  } }));
  const states = new ActiveWorldStateStore(managerRoot, adapters);
  app = buildApp({ mode: 'local', adapters, managerRoot, activeWorldState: states,
    transactionJournal: new TransactionJournalStore(managerRoot), operationStore: new JsonOperationStore(managerRoot),
    backupSchedulerTimers: false });
  await app.ready();
  if (settlementMode) {
    const clock = { now: () => new Date() }, registry = new AdapterRegistry(adapters);
    const journal = new TransactionJournalStore(managerRoot), store = new JsonOperationStore(managerRoot);
    const operations = new OperationService(store, clock, journal); await operations.initialize();
    const backups = new BackupService(registry, operations, journal, managerRoot, clock);
    generation = new WorldGenerationService(registry, operations, journal, backups, managerRoot, new WorldLibraryStore(managerRoot, clock), store);
    const recorded = await generation.recordFirstManagedStopSettlement('v2-real-test', previous.managedLifecycle.stopOperationId, () => undefined);
    assert.equal(recorded.historicalEvidenceRecorded, true); assert.equal(recorded.recoveryRequired, true);
    assert.equal(operations.getServerState('v2-real-test').recoveryRequired, true);
    const seal = await store.readWorldGenerationSettlement(previous.managedLifecycle.stopOperationId);
    assert.equal(seal.startOperationId, previous.managedLifecycle.startOperationId);
    assert.equal(seal.worldId, previous.candidateWorldId);
    result.settlement = { historicalEvidenceRecorded: true, recoveryRequired: true, checksum: hash(JSON.stringify(seal)) };
  }
  const response = await app.inject({ method: 'GET', url: '/api/v1/servers/v2-real-test/world-library',
    headers: { host: '127.0.0.1:8080' } });
  assert.equal(response.statusCode, 200);
  const catalog = response.json().data;
  assert.equal(catalog.serverId, 'v2-real-test');
  assert.equal(catalog.state, 'inspection-required');
  assert.equal(catalog.mutationsAvailable, false); assert.equal(catalog.activationAvailable, false);
  assert.equal(catalog.activeWorldId, null);
  assert(catalog.items.some(item => item.worldId === previous.candidateWorldId));
  assert.equal(launches, 0);
  assert.equal(hash(await readFile(path.join(managerRoot, 'config.json'))), hash(configBytes));
  result.catalog = { state: catalog.state, mutationsAvailable: false, activationAvailable: false,
    activeWorldId: null, generatedWorldPresent: true };
  result.result = 'PASS';
} catch (error) {
  result.error = { name: error.name, code: error.code ?? 'ACCEPTANCE_ASSERTION_FAILED' };
  process.exitCode = 1;
} finally {
  try { if (generation) await generation.close(); }
  catch { result.result = 'BLOCKED'; result.cleanup = 'CLEANUP_BLOCKED'; process.exitCode = 1; }
  try { if (app) await app.close(); else await Promise.all(adapters.map(adapter => adapter.closeObserver())); }
  catch { result.result = 'BLOCKED'; result.cleanup = 'CLEANUP_BLOCKED'; process.exitCode = 1; }
  result.minecraftLaunches = launches;
  if (launches) { result.result = 'BLOCKED'; process.exitCode = 1; }
  await writeFile(path.join(root, `reopen-${process.pid}.json`), JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(`${result.result}; separate Node reopen; Minecraft launches=${launches}`);
}
