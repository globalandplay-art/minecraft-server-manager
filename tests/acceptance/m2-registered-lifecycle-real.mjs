// Standing grant applies only to the recorded registered Vanilla test instance.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, realpath, lstat, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildApp } from '../../apps/api/src/app.ts';
import { createLocalAdapters } from '../../apps/api/src/config/bootstrap.ts';
import { parseProperties } from '../../apps/api/src/config/properties.ts';
import { LocalRuntimeFactory } from '../../apps/api/src/infra/runtime/index.ts';
import { verifyWindowsTcpPeer } from '../../apps/api/src/infra/runtime/tcp-peer-owner.ts';
import { JsonOperationStore } from '../../apps/api/src/services/operation-store.ts';
import { createRedactor } from '../../apps/api/src/infra/runtime/redactor.ts';
import { ActiveWorldStateStore } from '../../apps/api/src/services/active-world-state-store.ts';
import { classifyDiagnosticText, diagnosticsAllowed } from './import-diagnostics.mjs';

assert.equal(process.env.LT_REGISTERED_REAL, '1');
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const auth = JSON.parse(await readFile(path.join(workspace, '.manager/test-instance-authorization.json'), 'utf8'));
const config = JSON.parse(await readFile(path.join(workspace, '.manager/config.json'), 'utf8'));
assert.equal(auth.serverId, 'vanilla-26-3'); assert.equal(auth.minecraftVersion, '26.3');
const registration = config.servers.find(row => row.id === auth.serverId); assert(registration);
const root = await realpath(registration.root); assert.equal(root.toLowerCase(), auth.canonicalRoot.toLowerCase());
for (let cursor = root;; cursor = path.dirname(cursor)) {
  assert(!(await lstat(cursor)).isSymbolicLink()); if (cursor === path.dirname(cursor)) break;
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(await readFile(path.join(root, registration.jarFile))), auth.observedJarSha256);
console.log(`CONFIRMED AUTHORIZED TEST CANONICAL PATH: ${root}`);
const runId = `m2-real-${randomUUID()}`, evidence = path.join(workspace, '.manager', runId);
await mkdir(evidence);
const propertiesFile = path.join(root, 'server.properties'), stat = await lstat(propertiesFile);
assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
const original = await readFile(propertiesFile), originalFields = parseProperties(original.toString('utf8'));
await writeFile(path.join(evidence, 'original.properties'), original, { flag: 'wx' });
const secret = randomBytes(24).toString('hex');
const redactor = createRedactor({ secrets: () => [secret, originalFields.get('rcon.password')] });
const children = [], observations = [];
const restartAcceptance = process.env.LT_M2_RESTART === '1';
const report = { runId, result: 'BLOCKED', serverId: auth.serverId, restartAcceptance, operations: [], checks: [], finalStopped: false, restored: false, helpersClosed: false, observations };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const crashesBefore = await readdir(path.join(root, 'crash-reports')).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
let app, changed = false, preparedHash;
async function replace(bytes) {
  assert.equal((await realpath(root)).toLowerCase(), auth.canonicalRoot.toLowerCase());
  const current = await lstat(propertiesFile); assert(current.isFile() && !current.isSymbolicLink() && current.nlink === 1);
  const stage = `${propertiesFile}.${runId}.tmp`; await writeFile(stage, bytes, { flag: 'wx' }); await rename(stage, propertiesFile);
}
const headers = { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:3000', 'x-manager-intent': 'local-ui' };
async function request(url, payload, key = randomUUID()) {
  const response = await app.inject({ method: payload === undefined ? 'GET' : 'POST', url,
    headers: { ...headers, 'idempotency-key': key }, ...(payload === undefined ? {} : { payload }) });
  assert(!response.body.includes(secret)); assert(response.statusCode < 300, `HTTP ${response.statusCode}: ${response.json().error?.code}`);
  return response.json().data;
}
const base = `/api/v1/servers/${auth.serverId}`;
async function action(kind, key = randomUUID()) {
  if (kind === 'stop' || kind === 'restart') children.at(-1).stopRequested = true;
  const { operation } = await request(`${base}/actions/${kind}`, {}, key), deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const current = await request(`/api/v1/operations/${operation.id}`);
    if (['succeeded', 'failed', 'interrupted'].includes(current.state)) {
      assert.equal(current.state, 'succeeded', current.error?.code);
      report.operations.push({ id: current.id, kind, state: current.state }); return current;
    }
    await sleep(300);
  }
  throw new Error('acceptance-operation-deadline');
}
async function verifyLaunch() {
  const row = children.at(-1); assert(row); assert.equal(row.child.exitCode, null);
  const status = (await request(base)).status; assert.equal(status.state, 'running'); assert.equal(status.ownership, 'managed');
  assert.equal(status.recoveryRequired, false);
  const command = await request(`${base}/commands`, { command: 'list' }); assert.equal(command.transport, 'rcon'); assert.match(command.output, /players online/u);
  for (const port of [report.gamePort, report.rconPort]) assert(observations.some(proof => proof.pid === row.child.pid && proof.serverPort === port));
  assert.match(row.stdout, /Done \([^)]+\)!/u); assert(!report.captureOverflow);
  assert(!/Encountered an unexpected exception|crash report has been saved|Stopping server/iu.test(row.stdout + row.stderr));
  return classifyDiagnosticText({ stdout: row.stdout, stderr: row.stderr, captureOverflow: !!report.captureOverflow });
}
async function portReleased(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port }); let done = false;
    const finish = value => { if (done) return; done = true; socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(false)); socket.once('error', error => finish(error.code === 'ECONNREFUSED'));
    socket.setTimeout(1000, () => finish(false));
  });
}
try {
  const { stdout } = await promisify(execFile)('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -match '^javaw?\\.exe$' }).Count"],
    { windowsHide: true, timeout: 10000, maxBuffer: 4096 });
  assert.equal(stdout.trim(), '0', 'pre-existing Java; do not modify or take ownership');
  const reservations = [];
  try {
    for (let i = 0; i < 2; i++) { const server = net.createServer(); reservations.push(server);
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
    [report.gamePort, report.rconPort] = reservations.map(server => server.address().port);
  } finally { for (const server of reservations) if (server.listening) await new Promise(resolve => server.close(resolve)); }
  let text = original.toString('utf8');
  for (const [key, value] of Object.entries({ 'server-ip': '127.0.0.1', 'server-port': report.gamePort, 'rcon.port': report.rconPort, 'enable-rcon': 'true', 'rcon.password': secret })) {
    const expression = new RegExp(`^${key.replaceAll('.', '\\.') }=.*$`, 'gmu');
    assert.equal([...text.matchAll(expression)].length, 1, 'ambiguous preparation field'); text = text.replace(expression, `${key}=${value}`);
  }
  assert.equal(hash(await readFile(propertiesFile)), hash(original), 'external config change');
  await replace(Buffer.from(text)); changed = true; preparedHash = hash(Buffer.from(text));
  await writeFile(path.join(evidence, 'config.json'), JSON.stringify({ schemaVersion: 1, servers: [registration] }));
  const factory = new LocalRuntimeFactory({
    tcpPeerVerifier: async (peer, pid) => { await verifyWindowsTcpPeer(peer, pid); assert(observations.length < 1000); observations.push({ ...peer, pid }); },
    spawnProcess(executable, argv, options) {
      assert.equal(options.cwd.toLowerCase(), root.toLowerCase()); assert.equal(executable, registration.javaExecutable);
      assert.deepEqual([...argv], [...registration.jvmArgs, '-jar', path.join(root, registration.jarFile), ...registration.serverArgs]);
      assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
      const child = spawn(executable, [...argv], options), row = { child, stdout: '', stderr: '', closed: false, stopRequested: false };
      children.push(row);
      for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
        const redacted = redactor.redactText(chunk.toString('utf8')); if (row[stream].length + redacted.length > 4 * 1024 ** 2) report.captureOverflow = true;
        else row[stream] += redacted;
      });
      child.once('exit', (code, signal) => { row.exitCode = code; row.exitSignal = signal; row.premature = !row.stopRequested; });
      child.once('close', () => { row.closed = true; }); return child;
    }
  });
  const adapters = await createLocalAdapters(evidence, factory);
  app = buildApp({ mode: 'local', adapters, managerRoot: evidence, localRuntimeFactory: factory,
    activeWorldState: new ActiveWorldStateStore(evidence, adapters), operationStore: new JsonOperationStore(evidence), backupSchedulerTimers: false });
  await app.ready(); await action('start');
  report.startupDiagnostics = await verifyLaunch();
  report.checks.push('fresh Done + game established-socket PID + managed running', 'RCON established-socket PID + real list');
  if (restartAcceptance) {
    const originalPid = children[0].child.pid, key = randomUUID();
    const operation = await action('restart', key);
    assert.equal(children.length, 2); assert.notEqual(children[1].child.pid, originalPid);
    assert.equal(children[0].exitCode, 0); assert.equal(children[0].exitSignal, null);
    report.restartDiagnostics = await verifyLaunch();
    const replay = await request(`${base}/actions/restart`, {}, key);
    assert.equal(replay.operation.id, operation.id); assert.equal(children.length, 2);
    report.restartReplayVerified = true;
    report.checks.push('explicit restart: old generation exit0/null; new PID + fresh Done + owned game/RCON + real list', 'same-key restart replay returns original operation without extra launch');
  }
  await action('stop'); report.checks.push('explicit normal stop');
  assert.equal(children.length, restartAcceptance ? 2 : 1, 'no implicit launch');
  const crashesAfter = await readdir(path.join(root, 'crash-reports')).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
  assert.deepEqual(crashesAfter, crashesBefore); report.noNewCrashReport = true;
  report.result = 'PASS';
} catch (error) {
  report.errorCode = typeof error?.code === 'string' ? error.code : 'NO_EXPLICIT_ERROR_CODE';
  report.error = redactor.redactText(String(error?.message ?? 'acceptance-failed'));
} finally {
  report.cleanupErrors = [];
  for (const row of children) if (row.child.exitCode === null && row.child.signalCode === null) {
    // Authorized diagnostic fallback only for this exact captured child, not a product transport fallback.
    row.stopRequested = true; report.diagnosticStdinStop = true;
    row.child.stdin.once('error', () => report.cleanupErrors.push('OWNED_STDIN_STOP_FAILED'));
    try { row.child.stdin.write('stop\n', error => { if (error) report.cleanupErrors.push('OWNED_STDIN_STOP_FAILED'); }); }
    catch { report.cleanupErrors.push('OWNED_STDIN_STOP_FAILED'); }
  }
  for (let i = 0; children.some(row => !row.closed) && i < 150; i++) await sleep(100);
  report.finalStopped = children.every(row => row.closed);
  if (report.finalStopped && changed) {
    try {
      await writeFile(path.join(evidence, 'post-run.properties'), await readFile(propertiesFile), { flag: 'wx' });
      await replace(original); report.restored = (await readFile(propertiesFile)).equals(original);
    } catch { report.cleanupErrors.push('ORIGINAL_CONFIG_RESTORE_FAILED'); }
  }
  try { if (app) await app.close(); report.helpersClosed = true; }
  catch { report.cleanupErrors.push('APPLICATION_CLOSE_FAILED'); }
  report.portsReleased = (await Promise.all([report.gamePort, report.rconPort].filter(Number.isInteger).map(portReleased))).every(Boolean);
  report.launches = children.map(({ child, stdout, stderr, closed, exitCode, exitSignal, premature }) => ({ pid: child.pid, closed, exitCode, exitSignal, premature }));
  for (const [i, row] of children.entries()) for (const stream of ['stdout', 'stderr']) await writeFile(path.join(evidence, `launch-${i + 1}-${stream}.log`), row[stream]);
  report.environmentDiagnostics = children.some(row => /Perflib|0x80070057/u.test(row.stdout + row.stderr)) ? 'PERFLIB_OBSERVED' : 'NOT_OBSERVED';
  report.diagnostics = classifyDiagnosticText({ stdout: children.map(row => row.stdout).join('\n'), stderr: children.map(row => row.stderr).join('\n'),
    captureOverflow: !!report.captureOverflow, prematureExit: children.some(row => row.premature), shutdownAuthorized: children.length > 0 && children.every(row => row.stopRequested) });
  report.strictDiagnostics = diagnosticsAllowed(report.diagnostics) ? 'PASS' : 'BLOCKED';
  report.originalConfigSha256 = hash(original); report.preparedConfigSha256 = preparedHash;
  if (!report.finalStopped || !report.restored || !report.helpersClosed || !report.portsReleased || report.diagnosticStdinStop || report.cleanupErrors.length || report.launches.some(row => row.exitCode !== 0 || row.exitSignal !== null || row.premature)) report.result = 'BLOCKED';
  report.businessResult = report.result;
  if (report.strictDiagnostics !== 'PASS') report.result = 'BLOCKED';
  if (!report.finalStopped) report.cleanup = 'CLEANUP_BLOCKED';
  await writeFile(path.join(evidence, 'acceptance-report.json'), JSON.stringify(report, null, 2));
  console.log(`${report.result}: ${runId}; business=${report.businessResult}; diagnostics=${report.strictDiagnostics}; stopped=${report.finalStopped}; restored=${report.restored}`);
  process.exitCode = report.result === 'PASS' ? 0 : 1;
}
