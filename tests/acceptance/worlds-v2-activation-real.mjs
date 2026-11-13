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
import { createWorldFolderArchive } from '../../apps/web/src/worldFolderArchive.ts';

assert.equal(process.argv[2], '--execute', 'Explicit authorized acceptance invocation required');
const replacementMode = process.argv[3] === '--replacement';
assert(process.argv.length === 3 || replacementMode && process.argv.length === 4, 'Unsupported acceptance mode');
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
const runId = `worlds-v2-${replacementMode ? 'replacement-real' : 'real'}-${randomUUID()}`, root = path.join(workspace, 'test-results', runId);
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
  scenario: replacementMode ? 'Restore a generated isolated world snapshot; old-only test marker proves replacement; not arbitrary-world compatibility.' : 'Independent import and activation',
  sourceJarSha256: authorization.observedJarSha256, javaSha256: digest(await readFile(source.javaExecutable)),
  diagnostics: 'NOT_ASSESSED',
  limitations: ['Local isolated Vanilla 26.3 business checks only; no player authentication or other loaders certified.', 'Manager reconstruction is in-process, not an OS process restart.', 'WARN/ERROR logs retained, not waived; no strict diagnostic or whole-stage PASS.', 'No online backup or restic acceptance.'] };
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
let app, adapters = [];
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
  check('fresh_original_world_generated_and_saved');
  const originalTree = await inventoryRestoreTree(path.join(serverRoot, 'world')), originalChecksum = restoreFilesChecksum(originalTree);
  const files = [];
  for (const entry of originalTree) {
    const bytes = await readFile(path.join(serverRoot, 'world', entry.path));
    const file = new File([bytes], path.posix.basename(entry.path));
    Object.defineProperty(file, 'webkitRelativePath', { value: `world/${entry.path}` }); files.push(file);
  }
  const archive = await createWorldFolderArchive(files), archiveBytes = Buffer.from(await archive.arrayBuffer());
  await open(true);
  const before = await request(libraryBase), originalId = before.activeWorldId;
  const upload = await request(`${base}/worlds/import-uploads`, archiveBytes, randomUUID(), { 'content-type': 'application/zip', 'x-upload-filename': 'isolated-world.zip' });
  if (replacementMode) {
    const marker = 'lt-owned-replacement-marker.txt';
    await writeFile(path.join(serverRoot, 'world', marker), runId);
    const preservedChecksum = restoreFilesChecksum(await inventoryRestoreTree(path.join(serverRoot, 'world')));
    assert.notEqual(preservedChecksum, originalChecksum);
    const plan = await request(`${libraryBase}/replacement-plan`, { uploadId: upload.id });
    assert.equal(plan.executionAvailable, true); assert.equal(plan.currentWorldId, originalId);
    const replaced = await action(`${libraryBase}/replace`, { uploadId: plan.uploadId, uploadRevision: plan.uploadRevision,
      libraryRevision: plan.libraryRevision, currentWorldId: plan.currentWorldId, currentWorldRevision: plan.currentWorldRevision,
      currentContentRevision: plan.currentContentRevision, propertiesRevision: plan.propertiesRevision, confirmWorldName: plan.currentWorldName });
    const nextId = replaced.result.resourceId; assert.notEqual(nextId, originalId);
    const scan = await new TransactionJournalStore(managerRoot).scan();
    assert.equal(scan.issues.length, 0); const records = scan.records.filter(record => record.intent.worldReplacement);
    assert.equal(records.length, 1); assert.equal(records[0].state, 'committed');
    const value = records[0].intent.worldReplacement, retained = path.join(serverRoot, value.workspaceName, 'previous-world');
    assert.equal(restoreFilesChecksum(await inventoryRestoreTree(retained)), preservedChecksum);
    assert.equal(restoreFilesChecksum(await inventoryRestoreTree(path.join(serverRoot, 'world'))), originalChecksum);
    assert.equal(await readFile(path.join(retained, marker), 'utf8'), runId);
    await assert.rejects(lstat(path.join(serverRoot, 'world', marker)), { code: 'ENOENT' });
    check('replacement_installed_snapshot_with_new_id_and_retained_original');
    const verified = await request(`${libraryBase}/replacement-verification`, { operationId: replaced.id, intent: 'confirm-current-state' });
    assert.equal(verified.state, 'succeeded'); assert.equal(verified.result.resourceId, nextId);
    await app.close(); app = undefined;
    await open(true);
    const denied = await app.inject({ method: 'POST', url: `${base}/actions/start`, headers: { ...headers, 'idempotency-key': randomUUID() }, payload: {} });
    assert.equal(denied.statusCode, 409); assert.equal(denied.json().error.code, 'RECOVERY_REQUIRED');
    assert.equal(owned.length, 1);
    const confirmed = await request(`${libraryBase}/replacement-verification`, { operationId: replaced.id, intent: 'confirm-current-state' });
    assert.equal(confirmed.state, 'succeeded'); check('manager_reconstruction_requires_explicit_verification_without_replay');
    await started('world'); await stopped();
    assert.equal(restoreFilesChecksum(await inventoryRestoreTree(retained)), preservedChecksum);
    const saved = await request(`${libraryBase}/replacement-verification`, { operationId: replaced.id, intent: 'confirm-current-state' });
    assert.equal(saved.state, 'succeeded');
    const after = await request(libraryBase); assert.equal(after.activeWorldId, nextId);
    assert(after.items.some(item => item.worldId === originalId && item.state === 'retired'));
    assert.equal((await readdir(path.join(serverRoot, 'crash-reports')).catch(() => [])).length, 0);
    check('replacement_world_actually_loaded_saved_and_reverified_after_normal_changes');
  } else {
  const importPlan = await request(`${libraryBase}/import-plan`, { uploadId: upload.id, name: 'Imported-V2' });
  const imported = await action(`${libraryBase}/import`, { mode: importPlan.mode, name: importPlan.name, uploadId: importPlan.uploadId,
    uploadRevision: importPlan.uploadRevision, libraryRevision: importPlan.libraryRevision,
    currentWorldId: importPlan.currentWorldId, currentWorldRevision: importPlan.currentWorldRevision });
  const importedId = imported.result.resourceId; assert.notEqual(importedId, originalId);
  assert.equal((await request(libraryBase)).activeWorldId, originalId);
  assert.equal(restoreFilesChecksum(await inventoryRestoreTree(path.join(serverRoot, 'world'))), originalChecksum);
  check('real_folder_zip_import_is_inactive_and_preserves_original');
  async function activate(worldId) {
    const plan = await request(`${libraryBase}/activation-plan`, { worldId });
    const result = await action(`${libraryBase}/activate`, { worldId: plan.worldId, libraryRevision: plan.libraryRevision,
      currentWorldId: plan.currentWorldId, currentWorldRevision: plan.currentWorldRevision, targetWorldRevision: plan.targetWorldRevision,
      currentContentRevision: plan.currentContentRevision, targetContentRevision: plan.targetContentRevision,
      propertiesRevision: plan.propertiesRevision, confirmWorldName: plan.levelName });
    assert.equal(result.result.resourceId, worldId); assert.equal((await request(libraryBase)).activeWorldId, worldId);
  }
  await activate(importedId); await started('Imported-V2'); await stopped();
  assert.equal(restoreFilesChecksum(await inventoryRestoreTree(path.join(serverRoot, 'world'))), originalChecksum);
  const importedChecksum = restoreFilesChecksum(await inventoryRestoreTree(path.join(serverRoot, 'Imported-V2')));
  check('imported_world_actually_loaded_and_saved_without_changing_original');
  await activate(originalId); await started('world'); await stopped();
  assert.equal(restoreFilesChecksum(await inventoryRestoreTree(path.join(serverRoot, 'Imported-V2'))), importedChecksum);
  check('original_world_return_actually_loaded_and_saved');
  const scan = await new TransactionJournalStore(managerRoot).scan();
  assert(scan.records.filter(record => record.intent.worldActivation).every(record => record.state === 'committed'));
  assert.equal(scan.issues.length, 0); assert.equal((await readdir(path.join(serverRoot, 'crash-reports')).catch(() => [])).length, 0);
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
  let managerClosed = false;
  let timer;
  try {
    const closing = app ? app.close() : Promise.all(adapters.map(adapter => adapter.closeObserver()));
    await Promise.race([closing, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('CLEANUP_BLOCKED')), 10_000); })]);
    managerClosed = true;
  } catch { report.failures.push({ code: 'MANAGER_CLOSE_FAILED' }); }
  finally { clearTimeout(timer); }
  report.cleanup = { childrenClosed: owned.every(capture => capture.closed), forcedOwnedChildren: forced.length, managerClosed };
  if (!report.cleanup.childrenClosed || forced.length || !managerClosed) { report.result = 'BLOCKED'; process.exitCode = 1; }
  for (const [index, capture] of owned.entries()) {
    Object.assign(report.launches[index], { closed: capture.closed, code: capture.code, signal: capture.signal, overflow: capture.overflow,
      warningLines: (capture.stdout.match(/\bWARN\b/gu) ?? []).length, errorLines: (capture.stdout.match(/\bERROR\b/gu) ?? []).length });
    await writeFile(path.join(root, `java-${index + 1}.stdout.log`), redact(capture.stdout)); await writeFile(path.join(root, `java-${index + 1}.stderr.log`), redact(capture.stderr));
  }
  const sourceUnchanged = digest(await readFile(sourceJar)) === authorization.observedJarSha256 && digest(await readFile(sourceEula)) === digest(eula) &&
    digest(await readFile(path.join(workspace, '.manager/config.json'))) === digest(configBytes) &&
    digest(await readFile(path.join(workspace, '.manager/test-instance-authorization.json'))) === digest(authorizationBytes);
  report.sourceUnchanged = sourceUnchanged; if (!sourceUnchanged) { report.result = 'BLOCKED'; process.exitCode = 1; }
  await writeFile(path.join(root, 'result.json'), JSON.stringify(report, null, 2));
  console.log(`${report.result}; evidence test-results/${runId}/result.json`);
}
