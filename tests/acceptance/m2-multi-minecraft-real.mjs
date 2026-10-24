// Requires authorization for two new isolated instances of the selected pair.
// Does not operate existing registrations or copy any existing world/player data.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, realpath, lstat, readdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { freemem } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../apps/api/src/app.ts';
import { createLocalAdapters } from '../../apps/api/src/config/bootstrap.ts';
import { parseProperties } from '../../apps/api/src/config/properties.ts';
import { LocalRuntimeFactory } from '../../apps/api/src/infra/runtime/index.ts';
import { verifyWindowsTcpPeer } from '../../apps/api/src/infra/runtime/tcp-peer-owner.ts';
import { JsonOperationStore } from '../../apps/api/src/services/operation-store.ts';
import { ActiveWorldStateStore } from '../../apps/api/src/services/active-world-state-store.ts';
import { createRedactor } from '../../apps/api/src/infra/runtime/redactor.ts';
import { classifyDiagnosticText, diagnosticsAllowed } from './import-diagnostics.mjs';
import { sourcePreflight } from './phase55-source-preflight.mjs';
import { readPrivatePropertiesFile } from '../../apps/api/src/services/properties-private-file.ts';
import { hasRuntimeException } from './m2-runtime-exception-check.mjs';
import { forgeSourcePreflight } from './forge-source-preflight.mjs';
import { neoForgeSourcePreflight } from './neoforge-source-preflight.mjs';
import { captureNeoForgeLaunchBinding } from '../../apps/api/src/services/neoforge-launch-binding.ts';
import { buildMarkerMod } from './m3-build-marker-mod.mjs';
import { TransactionJournalStore } from '../../apps/api/src/services/transaction-journal.ts';

assert.equal(process.platform, 'win32');
const loaderPair = process.env.LT_M2_LOADER_PAIR;
const modLifecycle = process.env.LT_M3_REAL_LIFECYCLE === 'AUTHORIZED_FRESH_LOADER_MODS';
if (modLifecycle) assert(['forge-vanilla', 'neoforge-vanilla'].includes(loaderPair));
assert(loaderPair === undefined || loaderPair === 'paper-fabric' || loaderPair === 'forge-vanilla' || loaderPair === 'neoforge-vanilla', 'unsupported acceptance loader pair');
const restartId = process.env.LT_M2_RESTART_TARGET ?? 'm2-a';
assert(['m2-a', 'm2-b'].includes(restartId));
assert.equal(process.env.LT_FRESH_MULTI_REAL, loaderPair ? 'AUTHORIZED_TWO_ISOLATED_LOADERS' : 'AUTHORIZED_TWO_ISOLATED_INSTANCES');
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const auth = JSON.parse(await readFile(path.join(workspace, '.manager/test-instance-authorization.json'), 'utf8'));
const config = JSON.parse(await readFile(path.join(workspace, '.manager/config.json'), 'utf8'));
assert.equal(auth.serverId, 'vanilla-26-3'); assert.equal(auth.minecraftVersion, '26.3');
const source = config.servers.find(row => row.id === auth.serverId); assert(source);
const sourceRoot = await realpath(source.root); assert.equal(sourceRoot.toLowerCase(), auth.canonicalRoot.toLowerCase());
async function plainPath(target) {
  for (let cursor = target;; cursor = path.dirname(cursor)) {
    assert(!(await lstat(cursor)).isSymbolicLink(), 'linked acceptance path');
    if (cursor === path.dirname(cursor)) break;
  }
}
await plainPath(sourceRoot);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inputs = {};
for (const name of [source.jarFile, 'eula.txt']) {
  assert.equal(path.basename(name), name); const file = path.join(sourceRoot, name), stat = await lstat(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  assert(stat.size <= 64 * 1024 ** 2); inputs[name] = await readFile(file);
}
assert.equal(hash(inputs[source.jarFile]), auth.observedJarSha256);
assert.equal(parseProperties(inputs['eula.txt'].toString('utf8')).get('eula'), 'true', 'source EULA must already be accepted');
// Exact Paper/Fabric test sources were authorized for isolated testing during P5.5.
// Reuse their launcher-derived whitelist, never scan/copy source properties/worlds.
const manifests = loaderPair === 'neoforge-vanilla' ? [await neoForgeSourcePreflight(), undefined]
  : loaderPair === 'forge-vanilla' ? [await forgeSourcePreflight(), undefined]
  : loaderPair ? await Promise.all(['paper', 'fabric'].map(kind => sourcePreflight(kind, source.javaExecutable))) : [];
const { stdout: processCount } = await promisify(execFile)('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -match '^javaw?\\.exe$' }).Count"],
  { shell: false, windowsHide: true, timeout: 10000, maxBuffer: 4096 });
assert.equal(processCount.trim(), '0', 'existing Java: no adoption or termination');
assert(freemem() >= 4 * 1024 ** 3, 'insufficient available memory for dual Minecraft acceptance');

const runId = `m2-${loaderPair ? 'loaders' : 'multi'}-real-${randomUUID()}`, evidence = path.join(workspace, '.manager', runId);
const runtime = path.join(workspace, 'runtime', runId);
await plainPath(path.dirname(evidence)); await plainPath(path.dirname(runtime));
await mkdir(evidence); await mkdir(runtime);
const endpoints = [], reservations = [];
try {
  for (let i = 0; i < 4; i++) {
    const server = net.createServer(); reservations.push(server);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); endpoints.push(server.address().port);
  }
} finally { for (const server of reservations) if (server.listening) await new Promise(resolve => server.close(resolve)); }
const secrets = [randomBytes(24).toString('hex'), randomBytes(24).toString('hex')];
const redactor = createRedactor({ secrets: () => secrets });
const children = [], observations = [], checks = [], registrations = [];
const report = { runId, kind: loaderPair === 'neoforge-vanilla' ? 'REAL_NEOFORGE_VANILLA_DUAL_INSTANCE' : loaderPair === 'forge-vanilla' ? 'REAL_FORGE_VANILLA_DUAL_INSTANCE' : loaderPair ? 'REAL_PAPER_FABRIC_DUAL_INSTANCE' : 'REAL_VANILLA_DUAL_INSTANCE', restartId, result: 'BLOCKED', businessResult: 'BLOCKED', checks, observations, operations: [], sourceWorldAccessed: false,
  sourceManifests: manifests.filter(Boolean).map(manifest => ({ kind: manifest.kind, files: manifest.files.length, manifestSha256: manifest.manifestSha256, noFetchProof: manifest.noFetchProof })) };
const headers = { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:3000', 'x-manager-intent': 'local-ui' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)); let app;
async function request(url, payload, key = randomUUID()) {
  const response = await app.inject({ method: payload === undefined ? 'GET' : 'POST', url,
    headers: { ...headers, 'idempotency-key': key }, ...(payload === undefined ? {} : { payload }) });
  assert(secrets.every(secret => !response.body.includes(secret)));
  assert(response.statusCode < 300, `HTTP ${response.statusCode}: ${response.json().error?.code}`); return response.json().data;
}
async function action(id, kind, key = randomUUID()) {
  if (kind === 'stop' || kind === 'restart') children.filter(row => row.id === id).at(-1).stopRequested = true;
  const { operation } = await request(`/api/v1/servers/${id}/actions/${kind}`, {}, key), deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const current = await request(`/api/v1/operations/${operation.id}`);
    if (['succeeded', 'failed', 'interrupted'].includes(current.state)) {
      assert.equal(current.state, 'succeeded', current.error?.code);
      report.operations.push({ id: current.id, serverId: id, kind, state: current.state }); return current;
    }
    await sleep(300);
  }
  throw new Error('multi-real-operation-deadline');
}
async function verify(id, seed) {
  const child = children.filter(row => row.id === id).at(-1); assert(child); assert.equal(child.child.exitCode, null);
  const status = (await request(`/api/v1/servers/${id}`)).status;
  assert.equal(status.state, 'running'); assert.equal(status.ownership, 'managed'); assert.equal(status.recoveryRequired, false);
  for (const [command, expected] of [['list', /players online/u], ['seed', new RegExp(`Seed: \\[${seed}\\]`, 'u')]]) {
    const result = await request(`/api/v1/servers/${id}/commands`, { command });
    assert.equal(result.transport, 'rcon'); assert.match(result.output, expected);
  }
  assert.match(child.stdout, /Done \([^)]+\)!/u);
  assert(!/Encountered an unexpected exception|crash report has been saved|Stopping server/iu.test(child.stdout + child.stderr));
  const index = id === 'm2-a' ? 0 : 2;
  for (const port of endpoints.slice(index, index + 2)) assert(observations.some(proof => proof.pid === child.child.pid && proof.serverPort === port));
}
async function released(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port }); let done = false;
    const finish = value => { if (done) return; done = true; socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(false)); socket.once('error', error => finish(error.code === 'ECONNREFUSED'));
    socket.setTimeout(1000, () => finish(false));
  });
}
try {
  for (const [index, id] of ['m2-a', 'm2-b'].entries()) {
    const root = path.join(runtime, id); await mkdir(root); await plainPath(root);
    const canonical = await realpath(root); assert.equal(canonical.toLowerCase(), root.toLowerCase());
    console.log(`CONFIRMED FRESH TEST CANONICAL PATH: ${canonical}`);
    const manifest = manifests[index];
    if (manifest) {
      for (const entry of manifest.files) {
        assert(entry.target === 'server.jar' || entry.target === 'eula.txt' || /^(?:libraries|versions|cache|\.fabric\/server)\/[a-zA-Z0-9_+.\/-]+\.jar$/u.test(entry.target) ||
          (manifest.kind === 'neoforge' && ['run.bat', 'libraries/net/neoforged/neoforge/26.3.0.95/win_args.txt'].includes(entry.target)));
        assert(entry.target.split('/').every(part => part !== '..' && part !== '.' && part !== ''));
        const destination = path.join(root, entry.target), relative = path.relative(root, destination);
        assert(relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
        await mkdir(path.dirname(destination), { recursive: true }); await plainPath(path.dirname(destination));
        const file = await readPrivatePropertiesFile(path.join(manifest.sourceRoot, entry.relative), 64 * 1024 ** 2);
        assert.equal(file.identity, entry.identity); assert.equal(file.checksum, entry.sha256);
        await writeFile(destination, file.bytes, { flag: 'wx', mode: 0o600 });
        assert.equal((await readPrivatePropertiesFile(destination, 64 * 1024 ** 2)).checksum, entry.sha256);
      }
      await mkdir(path.join(root, manifest.kind === 'paper' ? 'plugins' : 'mods'));
      if (modLifecycle && index === 0) await mkdir(path.join(root, 'disabled-mods'));
      if (manifest.kind === 'neoforge') await writeFile(path.join(root, 'eula.txt'), inputs['eula.txt'], { flag: 'wx' });
    } else {
      for (const [name, bytes] of Object.entries(inputs)) await writeFile(path.join(root, name), bytes, { flag: 'wx' });
    }
    const fields = { 'server-ip': '127.0.0.1', 'server-port': endpoints[index * 2], 'enable-rcon': 'true',
      'rcon.port': endpoints[index * 2 + 1], 'rcon.password': secrets[index], 'level-name': 'world',
      'level-seed': index === 0 ? '111111' : '222222', 'view-distance': 2, 'simulation-distance': 2,
      'online-mode': 'true', 'enable-query': 'false', 'management-server-enabled': 'false' };
    await writeFile(path.join(root, 'server.properties'), Object.entries(fields).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { flag: 'wx' });
    registrations.push({ ...source, id, name: `M2 isolated ${manifest?.kind ?? 'vanilla'} ${id}`, root,
      jarFile: manifest?.kind === 'neoforge' ? 'run.bat' : manifest ? 'server.jar' : source.jarFile, jvmArgs: ['-Xms256M', '-Xmx1G'] });
  }
  await writeFile(path.join(evidence, 'config.json'), JSON.stringify({ schemaVersion: 1, servers: registrations }), { flag: 'wx' });
  const neoProfiles = new Map();
  for (const [index, registration] of registrations.entries()) if (manifests[index]?.kind === 'neoforge') {
    neoProfiles.set(registration.id, await captureNeoForgeLaunchBinding(registration.root, path.join(registration.root, 'run.bat')));
  }
  const factory = new LocalRuntimeFactory({
    tcpPeerVerifier: async (peer, pid) => { await verifyWindowsTcpPeer(peer, pid); assert(observations.length < 1000); observations.push({ ...peer, pid }); },
    spawnProcess(executable, argv, options) {
      const registration = registrations.find(row => row.root.toLowerCase() === options.cwd.toLowerCase()); assert(registration);
      assert.equal(executable, registration.javaExecutable); assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
      const forge = manifests[registrations.indexOf(registration)]?.kind === 'forge';
      const neo = neoProfiles.get(registration.id);
      assert.deepEqual([...argv], [...registration.jvmArgs, ...(neo ? neo.argv : [...(forge ? ['-Djava.net.preferIPv6Addresses=system'] : []), '-jar', path.join(registration.root, registration.jarFile)]), ...registration.serverArgs]);
      const child = spawn(executable, [...argv], options), row = { id: registration.id, child, stdout: '', stderr: '', closed: false, stopRequested: false }; children.push(row);
      for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
        const safe = redactor.redactText(chunk.toString('utf8'));
        if (row[stream].length + safe.length > 4 * 1024 ** 2) report.captureOverflow = true; else row[stream] += safe;
      });
      child.once('exit', (code, signal) => { row.exitCode = code; row.exitSignal = signal; row.premature = !row.stopRequested; });
      child.once('close', () => { row.closed = true; }); return child;
    }
  });
  const adapters = await createLocalAdapters(evidence, factory);
  report.detectedServers = [];
  for (const [index, adapter] of adapters.entries()) {
    const info = await adapter.getServerInfo(); assert.equal(info.type, manifests[index]?.kind ?? 'vanilla');
    assert.equal(info.minecraftVersion, manifests[index]?.version ?? (manifests[index] ? '26.2' : '26.3'));
    assert.match(info.java.runtimeVersion, /^25\./u);
    report.detectedServers.push({ id: info.id, type: info.type, minecraftVersion: info.minecraftVersion, javaVersion: info.java.runtimeVersion });
  }
  app = buildApp({ mode: 'local', adapters, managerRoot: evidence, localRuntimeFactory: factory,
    ...(modLifecycle ? { transactionJournal: new TransactionJournalStore(evidence) } : {}),
    activeWorldState: new ActiveWorldStateStore(evidence, adapters), operationStore: new JsonOperationStore(evidence), backupSchedulerTimers: false }); await app.ready();
  await app.managerRecovery.wait();
  report.startupStages = app.managerRecovery.stages;
  if (modLifecycle) {
    report.modLifecycle = { result: 'BLOCKED', phases: [], managerReplay: false };
    const built = await buildMarkerMod({ manifest: manifests[0], javaExecutable: source.javaExecutable, evidence, runId });
    report.modLifecycle.markerSha256 = built.sha256; report.modLifecycle.sourceSha256 = built.sourceSha256;
    const accepted = await app.inject({ method: 'POST', url: '/api/v1/servers/m2-a/addons/uploads',
      headers: { ...headers, 'content-type': 'application/java-archive', 'x-upload-filename': 'lt-m3-marker.jar' }, payload: built.bytes });
    assert.equal(accepted.statusCode, 201, `upload:${accepted.json().error?.code}`);
    const stage = accepted.json().data;
    const poll = async operation => {
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        const current = await request(`/api/v1/operations/${operation.id}`);
        if (['succeeded', 'failed', 'interrupted'].includes(current.state)) { assert.equal(current.state, 'succeeded', current.error?.code); return current; }
        await sleep(300);
      }
      throw new Error('mod-operation-deadline');
    };
    const before = await request('/api/v1/servers/m2-a/addons');
    const installed = await request('/api/v1/servers/m2-a/addons/install', { uploadId: stage.id, uploadRevision: stage.revision,
      inventoryRevision: before.revision, confirmUnknownCompatibility: true });
    await poll(installed.operation); assert.equal(children.length, 0, 'install must not implicitly launch');
    await action('m2-b', 'start'); await verify('m2-b', 222222);
    const loaded = async (phase, expected) => {
      await action('m2-a', 'start'); await verify('m2-a', 111111);
      const child = children.filter(row => row.id === 'm2-a').at(-1);
      assert.equal((child.stdout + child.stderr).includes(built.marker), expected, `${phase}:actual marker load/omission`);
      await verify('m2-b', 222222); await action('m2-a', 'stop');
      assert.equal(child.exitCode, 0); assert.equal(child.exitSignal, null); assert.equal(child.closed, true);
      report.modLifecycle.phases.push({ phase, expectedLoaded: expected, markerObserved: expected, exitCode: child.exitCode, exitSignal: child.exitSignal });
    };
    const mutate = async actionName => {
      const list = await request('/api/v1/servers/m2-a/addons');
      const item = list.items.find(item => item.filename === 'lt-m3-marker.jar'); assert(item);
      const count = children.length, key = randomUUID(), body = { revision: list.revision,
        ...(actionName === 'enable' ? { confirmUnknownCompatibility: true } : {}) };
      const url = `/api/v1/servers/m2-a/addons/${item.id}/${actionName}`;
      const response = await request(url, body, key); await poll(response.operation);
      assert.equal((await request(url, body, key)).operation.id, response.operation.id);
      assert.equal(children.length, count, 'lifecycle must not implicitly launch');
      return response.operation;
    };
    const restore = async expectedState => {
      const count = children.length;
      const list = await request('/api/v1/servers/m2-a/addons/trash');
      const item = list.items.find(item => item.filename === 'lt-m3-marker.jar'); assert.equal(item?.originalState, expectedState);
      assert.equal(item.declaredMetadata.loader, manifests[0].kind);
      const response = await request(`/api/v1/servers/m2-a/addons/trash/${item.id}/restore`, { revision: list.revision,
        ...(expectedState === 'enabled' ? { confirmUnknownCompatibility: true } : {}) });
      await poll(response.operation);
      assert.equal(children.length, count, 'restore must not implicitly launch');
    };
    await loaded('installed', true);
    await mutate('disable'); await loaded('disabled', false);
    await mutate('enable'); await loaded('enabled', true);
    await mutate('trash'); await loaded('trashed-enabled', false);
    await restore('enabled'); await loaded('restored-enabled', true);
    await mutate('disable'); await mutate('trash'); await restore('disabled'); await loaded('restored-disabled', false);
    await mutate('enable'); await action('m2-b', 'stop');
    const count = children.length; await app.close(); app = undefined;
    const reopened = await createLocalAdapters(evidence, factory);
    app = buildApp({ mode: 'local', adapters: reopened, managerRoot: evidence, localRuntimeFactory: factory,
      transactionJournal: new TransactionJournalStore(evidence),
      activeWorldState: new ActiveWorldStateStore(evidence, reopened), operationStore: new JsonOperationStore(evidence), backupSchedulerTimers: false }); await app.ready();
    await app.managerRecovery.wait(); report.reconstructionStages = app.managerRecovery.stages;
    assert.equal(children.length, count);
    const state = (await request('/api/v1/servers/m2-a')).status;
    assert.equal(state.state, 'stopped'); assert.equal(state.recoveryRequired, false); assert.equal(state.activeOperationId, null);
    assert.equal((await request(`/api/v1/operations/${installed.operation.id}`)).state, 'succeeded');
    assert.equal((await request('/api/v1/servers/m2-a/addons/trash')).items.length, 0);
    assert.equal(hash(await readFile(path.join(registrations[0].root, 'mods/lt-m3-marker.jar'))), built.sha256);
    report.modLifecycle.managerReplay = true; report.modLifecycle.replayScope = 'same-process app/adapter/store reconstruction';
    report.modLifecycle.osProcessRestart = 'NOT_RUN'; report.modLifecycle.result = 'PASS';
    checks.push('actual local marker mod install/disable/enable/trash/both restore states; peer isolation and same-process Manager reconstruction');
  } else {
  const startKey = randomUUID(); const starts = await Promise.allSettled([action('m2-a', 'start', startKey), action('m2-b', 'start', startKey)]);
  assert(starts.every(row => row.status === 'fulfilled'), 'parallel start did not reach two succeeded operations');
  assert.notEqual(starts[0].value.id, starts[1].value.id); assert.equal(children.length, 2);
  await verify('m2-a', 111111); await verify('m2-b', 222222); checks.push('two actual Minecraft children with distinct world seeds and owned game/RCON channels');
  const original = children.find(row => row.id === restartId), peer = children.find(row => row.id !== restartId), restartKey = randomUUID();
  const restart = await action(restartId, 'restart', restartKey);
  assert.equal(children.length, 3); assert.notEqual(children.at(-1).child.pid, original.child.pid);
  assert.equal(original.exitCode, 0); assert.equal(original.exitSignal, null); assert.equal(peer.child.exitCode, null);
  await verify('m2-a', 111111); await verify('m2-b', 222222);
  const replay = await request(`/api/v1/servers/${restartId}/actions/restart`, {}, restartKey); assert.equal(replay.operation.id, restart.id); assert.equal(children.length, 3);
  checks.push(`${restartId} restart preserves its world seed; peer remains original live generation; replay does not launch`);
  await action('m2-a', 'stop'); await verify('m2-b', 222222); await action('m2-b', 'stop');
  checks.push('stopping A leaves B responsive; explicit normal shutdown for both');
  }
  for (const registration of registrations) {
    const crashes = await readdir(path.join(registration.root, 'crash-reports')).catch(error => { if (error.code === 'ENOENT') return []; throw error; }); assert.equal(crashes.length, 0);
    assert((await lstat(path.join(registration.root, 'world/level.dat'))).isFile());
  }
  report.noCrashReport = true; report.businessResult = 'PASS';
} catch (error) {
  report.errorCode = typeof error?.code === 'string' ? error.code : 'NO_EXPLICIT_ERROR_CODE';
  report.error = redactor.redactText(String(error?.message ?? 'multi-real-failed'));
} finally {
  report.cleanupErrors = [];
  for (const row of children) if (row.child.exitCode === null && row.child.signalCode === null) {
    report.diagnosticStdinStop = true; row.stopRequested = true;
    row.child.stdin.once('error', () => report.cleanupErrors.push('OWNED_STDIN_STOP_FAILED'));
    try { row.child.stdin.write('stop\n', error => { if (error) report.cleanupErrors.push('OWNED_STDIN_STOP_FAILED'); }); }
    catch { report.cleanupErrors.push('OWNED_STDIN_STOP_FAILED'); }
  }
  for (let i = 0; children.some(row => !row.closed) && i < 150; i++) await sleep(100);
  report.finalStopped = children.every(row => row.closed);
  try { if (app) await app.close(); report.helpersClosed = true; } catch { report.cleanupErrors.push('APP_CLOSE_FAILED'); }
  report.portsReleased = (await Promise.all(endpoints.map(released))).every(Boolean);
  report.sourceInputsUnchanged = true;
  try {
    for (const [name, bytes] of Object.entries(inputs)) if (!bytes.equals(await readFile(path.join(sourceRoot, name)))) report.sourceInputsUnchanged = false;
    for (const manifest of manifests.filter(Boolean)) assert.deepEqual(manifest.kind === 'neoforge' ? await neoForgeSourcePreflight() : manifest.kind === 'forge' ? await forgeSourcePreflight() : await sourcePreflight(manifest.kind, source.javaExecutable), manifest);
  }
  catch { report.sourceInputsUnchanged = false; report.cleanupErrors.push('SOURCE_RECHECK_FAILED'); }
  report.launches = children.map(row => ({ id: row.id, pid: row.child.pid, closed: row.closed, exitCode: row.exitCode, exitSignal: row.exitSignal, premature: row.premature }));
  for (const [index, row] of children.entries()) for (const stream of ['stdout', 'stderr']) await writeFile(path.join(evidence, `launch-${index + 1}-${stream}.log`), row[stream]);
  report.diagnostics = classifyDiagnosticText({ stdout: children.map(row => row.stdout).join('\n'), stderr: children.map(row => row.stderr).join('\n'),
    captureOverflow: !!report.captureOverflow, prematureExit: children.some(row => row.premature), shutdownAuthorized: children.length > 0 && children.every(row => row.stopRequested) });
  report.strictDiagnostics = diagnosticsAllowed(report.diagnostics) ? 'PASS' : 'BLOCKED';
  // Do not rely on a mixed-source classifier's loader-specific exception context.
  report.runtimeExceptionLaunches = children.flatMap((row, index) =>
    hasRuntimeException(row.stdout) || hasRuntimeException(row.stderr) ? [index + 1] : []);
  if (report.runtimeExceptionLaunches.length) report.strictDiagnostics = 'BLOCKED';
  if (!report.finalStopped || !report.helpersClosed || !report.portsReleased || !report.sourceInputsUnchanged || report.captureOverflow || report.cleanupErrors.length || report.diagnosticStdinStop ||
    report.launches.some(row => row.exitCode !== 0 || row.exitSignal !== null || row.premature)) report.businessResult = 'BLOCKED';
  report.result = report.businessResult === 'PASS' && report.strictDiagnostics === 'PASS' ? 'PASS' : 'BLOCKED';
  if (!report.finalStopped) report.cleanup = 'CLEANUP_BLOCKED';
  await writeFile(path.join(evidence, 'acceptance-report.json'), JSON.stringify(report, null, 2));
  console.log(`${report.result}: ${runId}; business=${report.businessResult}; diagnostics=${report.strictDiagnostics}; stopped=${report.finalStopped}`);
  process.exitCode = report.result === 'PASS' ? 0 : 1;
}
