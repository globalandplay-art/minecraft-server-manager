// Standing Vanilla test authorization. Fresh UUID copy; original supplies only
// verified JAR and already accepted EULA. Never copies/edits an original world.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../../apps/api/src/app.ts';
import { createLocalAdapters } from '../../apps/api/src/config/bootstrap.ts';
import { LocalRuntimeFactory } from '../../apps/api/src/infra/runtime/index.ts';
import { ActiveWorldStateStore } from '../../apps/api/src/services/active-world-state-store.ts';
import { JsonOperationStore } from '../../apps/api/src/services/operation-store.ts';
import { TransactionJournalStore } from '../../apps/api/src/services/transaction-journal.ts';
import { inventoryRestoreTree, restoreFilesChecksum } from '../../apps/api/src/services/restore-files.ts';
import { AdapterRegistry } from '../../apps/api/src/adapters/registry.ts';
import { OperationService } from '../../apps/api/src/services/operation-service.ts';
import { BackupService } from '../../apps/api/src/services/backup-service.ts';
import { WorldLibraryStore } from '../../apps/api/src/services/world-library-store.ts';
import { WorldCreatePlanService } from '../../apps/api/src/services/world-create-plan-service.ts';
import { WorldCreateService } from '../../apps/api/src/services/world-create-service.ts';
import { WorldGenerationService } from '../../apps/api/src/services/world-generation-service.ts';

assert.equal(process.argv[2], '--execute', 'Explicit authorized acceptance invocation required');
const replacementMode = false;
const managedMode = process.argv[3] === '--managed';
assert.equal(process.argv.length, managedMode ? 4 : 3, 'Unsupported acceptance mode');
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const authorizationBytes = await readFile(path.join(workspace, '.manager/test-instance-authorization.json'));
const configBytes = await readFile(path.join(workspace, '.manager/config.json'));
const authorization = JSON.parse(authorizationBytes.toString('utf8')), config = JSON.parse(configBytes.toString('utf8'));
const source = config.servers.find(server => server.id === 'vanilla-26-3');
assert.equal(authorization.serverId, 'vanilla-26-3'); assert.equal(authorization.minecraftVersion, '26.3'); assert(source);
assert.equal(source.jarFile, authorization.observedJarFile);
const normalize = file => path.resolve(file).toLowerCase();
assert.equal(normalize(source.root), normalize(authorization.canonicalRoot));
async function plain(file, directory = false) {
  const stat = await lstat(file);
  assert(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1));
  assert.equal(normalize(await realpath(file)), normalize(file));
}
for (let cursor = path.resolve(source.root);; cursor = path.dirname(cursor)) {
  await plain(cursor, true); if (path.dirname(cursor) === cursor) break;
}
const sourceJar = path.join(source.root, authorization.observedJarFile), sourceEula = path.join(source.root, 'eula.txt');
await plain(sourceJar); await plain(sourceEula); await plain(source.javaExecutable);
assert.equal(digest(await readFile(sourceJar)), authorization.observedJarSha256);
const eula = await readFile(sourceEula); assert.match(eula.toString('utf8'), /^\s*eula=true\s*$/mu, 'No new EULA acceptance is authorized here');
const runId = `worlds-v2-generation-real-${randomUUID()}`, root = path.join(workspace, 'test-results', runId);
const serverRoot = path.join(root, 'server'), managerRoot = path.join(root, 'manager');
for (let cursor = path.resolve(workspace);; cursor = path.dirname(cursor)) {
  await plain(cursor, true); if (path.dirname(cursor) === cursor) break;
}
const evidenceParent = path.join(workspace, 'test-results');
await plain(evidenceParent, true);
assert.equal(path.dirname(root), evidenceParent);
await assert.rejects(lstat(root), { code: 'ENOENT' });
await mkdir(root); await plain(root, true);
await mkdir(serverRoot); await plain(serverRoot, true);
await mkdir(managerRoot); await plain(managerRoot, true);
await writeFile(path.join(root, 'owner.json'), JSON.stringify({ kind: 'lt-authorized-vanilla-fresh-copy', runId, sourceJarSha256: authorization.observedJarSha256 }));
await copyFile(sourceJar, path.join(serverRoot, 'server.jar')); await copyFile(sourceEula, path.join(serverRoot, 'eula.txt'));
assert.equal(digest(await readFile(path.join(serverRoot, 'server.jar'))), authorization.observedJarSha256);
const secret = randomBytes(32).toString('base64url');
const redact = value => String(value).replaceAll(secret, '[redacted]').replaceAll(source.root, '[source]').replaceAll(source.javaExecutable, '[java]').replaceAll(workspace, '[workspace]');
const report = { runId, result: 'RUNNING', originalWorldAccessed: false, checks: [], launches: [], failures: [], cleanup: null,
  scenario: managedMode ? 'Published initial world plus first managed start/stop; three isolated Java launches' :
    'Unpublished first-generation candidate; one baseline world launch and one controlled generation launch only',
  sourceJarSha256: authorization.observedJarSha256, javaSha256: digest(await readFile(source.javaExecutable)),
  diagnostics: 'NOT_ASSESSED',
  limitations: ['Local isolated Vanilla 26.3 business checks only; no player authentication or other loaders certified.', 'Manager reconstruction is in-process, not an OS process restart.', 'WARN/ERROR logs retained, not waived; no strict diagnostic or whole-stage PASS.', 'No online backup or restic acceptance.'] };
const manifestFile = path.join(workspace, managedMode ? 'test-results/worlds-v2-managed-candidate-2026-11-13.json' :
  'test-results/worlds-v2-generation-timestamp-candidate-2026-10-28.json');
const manifestBytes = await readFile(manifestFile), manifest = JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/u, ''));
for (const entry of manifest.files) {
  assert.equal(digest(await readFile(path.join(workspace, entry.path))), entry.sha256, 'FROZEN_CANDIDATE_CHANGED');
}
report.candidate = { manifestSha256: digest(manifestBytes), files: manifest.files,
  harnessSha256: digest(await readFile(fileURLToPath(import.meta.url))) };

const check = name => { report.checks.push(name); console.log(`PASS ${name}`); };
const leases = [];
let gamePort, rconPort;
try {
  for (let index = 0; index < 2; index++) {
    const lease = net.createServer(); leases.push(lease);
    await new Promise((resolve, reject) => { lease.once('error', reject); lease.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve); });
  }
  [gamePort, rconPort] = leases.map(lease => lease.address().port);
} finally {
  for (const lease of leases) if (lease.listening) await new Promise(resolve => lease.close(resolve));
}
await writeFile(path.join(serverRoot, 'server.properties'), `server-ip=127.0.0.1\nserver-port=${gamePort}\nenable-rcon=true\nrcon.port=${rconPort}\nrcon.password=${secret}\nlevel-name=world\nlevel-seed=4726\nonline-mode=true\nmax-players=1\nview-distance=2\nsimulation-distance=2\n`);
const serverId = 'v2-real-test';
await writeFile(path.join(managerRoot, 'config.json'), JSON.stringify({ schemaVersion: 1, servers: [{ id: serverId, name: 'Isolated V2 real acceptance',
  root: serverRoot, javaExecutable: source.javaExecutable, jarFile: 'server.jar', jvmArgs: ['-Xms512M', '-Xmx1G'], serverArgs: ['nogui'] }] }));
const owned = [], factory = new LocalRuntimeFactory({ spawnProcess(executable, args, options) {
  assert.equal(normalize(executable), normalize(source.javaExecutable)); assert.equal(normalize(options.cwd), normalize(serverRoot));
  assert.deepEqual([...args], ['-Xms512M', '-Xmx1G', '-jar', path.join(serverRoot, 'server.jar'), 'nogui']);
  assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
  assert.ok(owned.length < (managedMode ? 3 : 2), 'isolated Java launch budget exhausted');
  const child = spawn(executable, [...args], options);
  const capture = { child, pid: child.pid, stdout: '', stderr: '', closed: false, code: null, signal: null, overflow: false };
  owned.push(capture); report.launches.push({ pid: child.pid, shell: false, windowsHide: true });
  for (const channel of ['stdout', 'stderr']) child[channel].on('data', bytes => {
    if (capture[channel].length + bytes.length > 8 * 1024 ** 2) capture.overflow = true;
    else capture[channel] += bytes.toString('utf8'); // Redact the complete bounded text at publication, including split secrets.
  });
  child.once('close', (code, signal) => { capture.closed = true; capture.code = code; capture.signal = signal; });
  child.once('error', () => { capture.spawnError = true; });
  child.stdin.on('error', () => {});
  return child;
} });
let app, adapters = [], generationService;
const headers = { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:3000', 'x-manager-intent': 'local-ui' };
const base = `/api/v1/servers/${serverId}`, libraryBase = `${base}/world-library`;
async function request(url, body, key = randomUUID(), extraHeaders = {}) {
  const response = await app.inject({ method: body === undefined ? 'GET' : 'POST', url,
    headers: { ...headers, 'idempotency-key': key, ...extraHeaders }, ...(body === undefined ? {} : { payload: body }) });
  assert(!response.body.includes(secret));
  const json = response.json();
  assert(response.statusCode < 300, `${response.statusCode}:${json.error?.code ?? 'API_ERROR'}`);
  return json.data;
}
async function action(url, body) {
  const accepted = (await request(url, body)).operation, deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const operation = await request(`/api/v1/operations/${accepted.id}`);
    if (['succeeded', 'failed', 'interrupted'].includes(operation.state)) {
      assert.equal(operation.state, 'succeeded', operation.error?.code ?? 'OPERATION_FAILED'); return operation;
    }
    await delay(200);
  }
  throw new Error('BOUNDED_OPERATION_DEADLINE');
}
async function stopped() {
  await action(`${base}/actions/stop`, {});
  const last = owned.at(-1), deadline = Date.now() + 10_000;
  while (!last.closed && Date.now() < deadline) await delay(50);
  assert(last.closed && last.code === 0 && last.signal === null && !last.overflow, 'NORMAL_STOP_NOT_CONFIRMED');
  assert(/Saving (?:chunks|worlds)|All dimensions are saved/u.test(last.stdout), 'WORLD_SAVE_NOT_OBSERVED');
  assert(!/Failed to save|Could not save|Couldn't save|Encountered an unexpected exception|A crash report has been saved/iu.test(last.stdout + last.stderr), 'CRITICAL_SAVE_OR_RUNTIME_ERROR');
}
async function started(name) {
  await action(`${base}/actions/start`, {});
  const last = owned.at(-1); assert(last && !last.closed && !last.overflow);
  assert(/Done \(\d+(?:\.\d+)?s\)!/u.test(last.stdout), 'FRESH_DONE_MISSING');
  assert(last.stdout.includes(`Preparing level "${name}"`), 'EXPECTED_WORLD_NOT_LOADED');
  const overview = await request(base);
  assert.equal(overview.status.state, 'running'); assert.equal(overview.status.ownership, 'managed');
  assert(last.child.pid === last.pid && last.child.exitCode === null && last.child.signalCode === null, 'OWNED_CHILD_NOT_ALIVE');
  const command = await request(`${base}/commands`, { command: 'list' });
  assert.equal(command.status, 'executed'); assert.equal(command.transport, 'rcon'); assert.match(command.output, /players online/u);
  assert(!/Encountered an unexpected exception|A crash report has been saved/u.test(last.stdout + last.stderr));
  Object.assign(report.launches.at(-1), { expectedWorld: name, doneObserved: true, managedObserved: true, rconList: true });
}
async function open(withWorlds) {
  await plain(root, true); await plain(serverRoot, true); await plain(managerRoot, true);
  assert.equal(digest(await readFile(source.javaExecutable)), report.javaSha256);
  adapters = await createLocalAdapters(managerRoot, factory);
  assert.equal(adapters.length, 1);
  const info = await adapters[0].getServerInfo();
  assert.equal(info.type, 'vanilla'); assert.equal(info.minecraftVersion, '26.3'); assert.equal(info.detection.confidence, 'high');
  assert.equal(info.java.requiredMajor, 25);
  assert.equal(Number(/^(?:1\.)?(\d+)/u.exec(info.java.runtimeVersion ?? '')?.[1]), 25);
  report.javaRuntimeVersion = info.java.runtimeVersion;
  const journal = new TransactionJournalStore(managerRoot), store = new JsonOperationStore(managerRoot);
  const states = withWorlds ? new ActiveWorldStateStore(managerRoot, adapters) : undefined;
  if (states && !replacementMode) await states.initialize();
  app = buildApp({ mode: 'local', adapters, managerRoot, transactionJournal: journal, operationStore: store,
    activeWorldState: states, backupSchedulerTimers: false, worldActivationExecution: withWorlds && !replacementMode,
    worldReplacementExecution: withWorlds && replacementMode });
  await app.ready();
  if (replacementMode) await app.managerRecovery.wait();
}
try {
  await open(false); await started('world'); await stopped(); await app.close(); app = undefined;
  check('fresh_old_world_generated_saved_and_closed');
  const oldChecksum = restoreFilesChecksum(await inventoryRestoreTree(path.join(serverRoot, 'world')));
  assert.equal(digest(await readFile(source.javaExecutable)), report.javaSha256);
  adapters = await createLocalAdapters(managerRoot, factory);
  const registry = new AdapterRegistry(adapters), adapter = registry.getLocal(serverId);
  assert(adapter); assert.equal(adapters.length, 1);
  const clock = { now: () => new Date() }, journal = new TransactionJournalStore(managerRoot), store = new JsonOperationStore(managerRoot);
  const operations = new OperationService(store, clock, journal); await operations.initialize();
  const states = new ActiveWorldStateStore(managerRoot, adapters); await states.initialize();
  const library = new WorldLibraryStore(managerRoot, clock), binding = { serverId, rootPath: serverRoot };
  await library.migrateLegacy(binding, states.snapshot(serverId));
  const backups = new BackupService(registry, operations, journal, managerRoot, clock);
  const creator = new WorldCreateService(registry, operations, journal, backups, managerRoot, states, clock, undefined, { library });
  async function settled(id) {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (operations.getServerState(serverId).activeOperationId === null) return (await store.list()).find(item => item.operation.id === id);
      await delay(100);
    }
    throw new Error('BOUNDED_GENERATION_DEADLINE');
  }
  const plan = await new WorldCreatePlanService(registry, operations).plan(serverId, { name: 'Generated-V2', seed: '4927' });
  const preparation = await creator.create(serverId, { name: 'Generated-V2', seed: '4927', allowStop: false,
    worldRevision: plan.worldRevision, confirmWorldName: 'world' }, randomUUID());
  const parent = await settled(preparation.id); assert.equal(parent.operation.state, 'succeeded'); await creator.close();
  const prepared = await library.readPreparedGeneration(binding, journal);
  const target = { preparationOperationId: preparation.id, preparationTransactionId: prepared.record.transactionId,
    worldId: prepared.reservation.worldId, preparedRecordDigest: prepared.recordDigest,
    registeredExecutionDigest: digest(JSON.stringify(adapter.getRegisteredExecutionIdentity())) };
  check('uuid_preparation_and_pinned_guard_persisted_without_launch'); assert.equal(owned.length, 1);
  const service = generationService = new WorldGenerationService(registry, operations, journal, backups, managerRoot, library, store, managedMode);
  const key = randomUUID(), operation = await service.generate(serverId, key, target, () => undefined);
  const raw = await settled(operation.id);
  report.rawGeneration = { state: raw.operation.state, errorCode: raw.operation.error?.code ?? null };
  report.runtimeObservation = adapter.getRuntime().getOwnedLaunchObservation();
  report.candidateWorldId = target.worldId;
  const replay = await service.generate(serverId, key, target, () => undefined); assert.equal(replay.id, operation.id); assert.equal(owned.length, 2);
  if (!managedMode) await service.close();
  assert.equal(raw.operation.state, 'succeeded', raw.operation.error?.code ?? 'GENERATION_NOT_COMPLETED');
  assert.equal(owned.length, 2); assert(owned.every(child => child.closed && child.code === 0 && child.signal === null && !child.overflow && !child.spawnError), 'COMPLETE_NORMAL_LAUNCH_EVIDENCE_REQUIRED');
  assert(owned[1].stdout.includes('Preparing level "Generated-V2"'));
  assert(/Done \(\d+(?:\.\d+)?s\)!/u.test(owned[1].stdout));
  assert(/Saving (?:chunks|worlds)|All dimensions are saved/u.test(owned[1].stdout));
  assert(!/Failed to save|Could not save|Couldn't save|Encountered an unexpected exception|A crash report has been saved/iu.test(owned[1].stdout + owned[1].stderr));
  assert.equal(restoreFilesChecksum(await inventoryRestoreTree(path.join(serverRoot, 'world'))), oldChecksum);
  const executionEvidence = managedMode
    ? (await library.readPublishedGenerationEvidence(binding, journal, store)).birth.value.execution
    : (await library.readGenerationExecutionSeal(binding, journal, store)).execution;
  assert.equal(executionEvidence.executionOperationId, operation.id); assert.equal(executionEvidence.worldId, target.worldId);
  assert.equal(operations.get(operation.id).state, 'interrupted'); assert.equal(operations.getServerState(serverId).recoveryRequired, true);

  assert.equal((await readdir(path.join(serverRoot, 'crash-reports')).catch(() => [])).length, 0);
  check('one_owned_generation_loaded_saved_and_closed_old_world_unchanged_gate_retained');
  if (managedMode) {
    await service.finalizePublishedGeneration(serverId, operation.id, () => undefined);
    const started = await service.startFirstManagedWorld(serverId, operation.id, randomUUID(), () => undefined);
    assert.equal(owned.length, 3);
    assert.equal(adapter.getRuntime().getOwnedLaunchObservation().ownerOperationId, started.id);
    const stopped = await service.stopFirstManagedWorld(serverId, started.id, randomUUID(), () => undefined);
    const receipt = await store.readWorldStopSeal(stopped.id);
    assert.equal(receipt.stopOperationId, stopped.id);
    assert(owned.every(child => child.closed && child.code === 0 && child.signal === null && !child.overflow && !child.spawnError));
    assert(owned[2].stdout.includes('Preparing level "Generated-V2"'));
    assert(/Done \(\d+(?:\.\d+)?s\)!/u.test(owned[2].stdout));
    assert(/Saving (?:chunks|worlds)|All dimensions are saved/u.test(owned[2].stdout));
    assert(!/Failed to save|Could not save|Couldn't save|Encountered an unexpected exception|A crash report has been saved/iu.test(owned[2].stdout + owned[2].stderr));
    const recovered = new OperationService(new JsonOperationStore(managerRoot), clock, journal);
    await recovered.initialize();
    const chain = await recovered.readStartupWorldStopCandidate(serverId);
    assert.equal(chain.start.operation.id, started.id);
    assert.equal(chain.stop.operation.id, stopped.id);
    assert.equal(recovered.getServerState(serverId).recoveryRequired, true);
    assert.equal(restoreFilesChecksum(await inventoryRestoreTree(path.join(serverRoot, 'world'))), oldChecksum);
    assert.equal((await readdir(path.join(serverRoot, 'crash-reports')).catch(() => [])).length, 0);
    await service.close();
    report.managedLifecycle = { startOperationId: started.id, stopOperationId: stopped.id,
      persistedChainReloaded: true, recoveryRequired: true };
    check('first_managed_world_loaded_saved_closed_and_stop_chain_reloaded');
  }
  report.result = 'PASS';
} catch (error) {
  report.result = 'BLOCKED'; report.failures.push({ name: error.name, message: redact(error.message) }); process.exitCode = 1;
} finally {
  for (const capture of owned.filter(capture => !capture.closed)) { if (capture.child.stdin.writable) capture.child.stdin.write('stop\n'); }
  let deadline = Date.now() + 20_000;
  while (owned.some(capture => !capture.closed) && Date.now() < deadline) await delay(100);
  const forced = owned.filter(capture => !capture.closed); for (const capture of forced) capture.child.kill();
  deadline = Date.now() + 10_000;
  while (owned.some(capture => !capture.closed) && Date.now() < deadline) await delay(100);
  let generationClosed = !generationService;
  if (generationService) {
    try { await generationService.close(); generationClosed = true; }
    catch { report.failures.push({ code: 'GENERATION_CLEANUP_BLOCKED' }); }
  }
  let managerClosed = false;
  let timer;
  if (owned.every(capture => capture.closed) && generationClosed) try {
    const closing = app ? app.close() : Promise.all(adapters.map(adapter => adapter.closeObserver()));
    await Promise.race([closing, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('CLEANUP_BLOCKED')), 10_000); })]);
    managerClosed = true;
  } catch { report.failures.push({ code: 'MANAGER_CLOSE_FAILED' }); }
  finally { clearTimeout(timer); }
  else report.failures.push({ code: 'RUNTIME_DISPOSAL_BLOCKED' });
  report.cleanup = { childrenClosed: owned.every(capture => capture.closed), forcedOwnedChildren: forced.length, managerClosed, generationClosed };
  if (!report.cleanup.childrenClosed || forced.length || !managerClosed || !generationClosed) { report.result = 'BLOCKED'; process.exitCode = 1; }
  for (const [index, capture] of owned.entries()) {
    Object.assign(report.launches[index], { closed: capture.closed, code: capture.code, signal: capture.signal, overflow: capture.overflow, spawnError: !!capture.spawnError,
      warningLines: (capture.stdout.match(/\bWARN\b/gu) ?? []).length, errorLines: (capture.stdout.match(/\bERROR\b/gu) ?? []).length });
    await writeFile(path.join(root, `java-${index + 1}.stdout.log`), redact(capture.stdout)); await writeFile(path.join(root, `java-${index + 1}.stderr.log`), redact(capture.stderr));
  }
  const sourceUnchanged = digest(await readFile(source.javaExecutable)) === report.javaSha256 && digest(await readFile(sourceJar)) === authorization.observedJarSha256 && digest(await readFile(sourceEula)) === digest(eula) &&
    digest(await readFile(path.join(workspace, '.manager/config.json'))) === digest(configBytes) &&
    digest(await readFile(path.join(workspace, '.manager/test-instance-authorization.json'))) === digest(authorizationBytes);
  report.sourceUnchanged = sourceUnchanged; if (!sourceUnchanged) { report.result = 'BLOCKED'; process.exitCode = 1; }
  await writeFile(path.join(root, 'result.json'), JSON.stringify(report, null, 2));
  console.log(`${report.result}; evidence test-results/${runId}/result.json`);
}
