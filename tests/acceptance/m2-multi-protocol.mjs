// Synthetic launch plans, real Node children/TCP/RCON/Windows ownership and LT HTTP.
// This is NOT real Minecraft, loader detection or game-world acceptance.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../apps/api/src/app.ts';
import { LocalJavaAdapter } from '../../apps/api/src/adapters/local.ts';
import { LocalRuntimeFactory } from '../../apps/api/src/infra/runtime/index.ts';
import { verifyWindowsTcpPeer } from '../../apps/api/src/infra/runtime/tcp-peer-owner.ts';
import { JsonOperationStore } from '../../apps/api/src/services/operation-store.ts';

assert.equal(process.platform, 'win32', 'native ownership acceptance requires Windows');
const workspace = fileURLToPath(new URL('../../', import.meta.url)), runId = `m2-multi-protocol-${randomUUID()}`;
const evidence = path.join(workspace, 'test-results', runId); await mkdir(evidence);
const children = [], observations = [], checks = [];
const report = { runId, kind: 'NODE_PROTOCOL_FIXTURE', realMinecraft: 'NOT RUN', result: 'BLOCKED', checks, observations };
const headers = { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:3000', 'x-manager-intent': 'local-ui' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)); let app;
const endpoints = [], reservations = [];
try {
  for (let i = 0; i < 4; i++) {
    const server = net.createServer(); reservations.push(server);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); endpoints.push(server.address().port);
  }
} finally { for (const server of reservations) if (server.listening) await new Promise(resolve => server.close(resolve)); }
async function released(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port }); let done = false;
    const finish = value => { if (done) return; done = true; socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(false)); socket.once('error', e => finish(e.code === 'ECONNREFUSED')); socket.setTimeout(1000, () => finish(false));
  });
}
async function request(url, payload, key = randomUUID()) {
  const response = await app.inject({ method: payload === undefined ? 'GET' : 'POST', url,
    headers: { ...headers, 'idempotency-key': key }, ...(payload === undefined ? {} : { payload }) });
  assert(response.statusCode < 300, `HTTP ${response.statusCode}: ${response.json().error?.code}`); return response.json().data;
}
async function action(id, kind, key = randomUUID()) {
  if (kind === 'stop' || kind === 'restart') { const row = children.filter(row => row.id === id).at(-1); if (row) row.stopRequested = true; }
  const { operation } = await request(`/api/v1/servers/${id}/actions/${kind}`, {}, key), deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const current = await request(`/api/v1/operations/${operation.id}`);
    if (['succeeded', 'failed', 'interrupted'].includes(current.state)) { assert.equal(current.state, 'succeeded', current.error?.code); return current; }
    await sleep(50);
  }
  throw new Error('protocol-operation-deadline');
}
async function command(id, line) {
  const result = await request(`/api/v1/servers/${id}/commands`, { command: line });
  assert.equal(result.transport, 'rcon'); assert.equal(result.output, `${id.toUpperCase()}:${line}`);
}
try {
  const factory = new LocalRuntimeFactory({
    tcpPeerVerifier: async (peer, pid) => { await verifyWindowsTcpPeer(peer, pid); assert(observations.length < 1000); observations.push({ ...peer, pid }); },
    spawnProcess(executable, argv, options) {
      assert.equal(executable, process.execPath); assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
      const id = path.basename(options.cwd).slice(-1); assert(['a', 'b'].includes(id));
      const child = spawn(executable, [...argv], { ...options, env: { ...process.env, LT_PROTOCOL_FIXTURE: '1' } });
      const row = { id, child, closed: false, stdout: '', stderr: '', stopRequested: false }; children.push(row);
      for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
        if (row[stream].length + chunk.length > 65536) report.captureOverflow = true; else row[stream] += chunk.toString('utf8');
      });
      child.once('exit', (code, signal) => { row.exitCode = code; row.exitSignal = signal; row.premature = !row.stopRequested; });
      child.once('close', () => { row.closed = true; }); return child;
    }
  });
  const adapters = [];
  for (const [index, id] of ['a', 'b'].entries()) {
    const root = path.join(evidence, `instance-${id}`); await mkdir(path.join(root, 'logs'), { recursive: true }); await writeFile(path.join(root, 'logs/latest.log'), '');
    const plan = { id, name: `Protocol ${id}`, rootPath: root, javaExecutable: process.execPath, jarPath: path.join(root, 'synthetic-not-a-jar'),
      argv: ['--import', 'tsx', path.join(workspace, 'tests/fixtures/m2-protocol-child.mjs'), String(endpoints[index * 2]), String(endpoints[index * 2 + 1]), id.toUpperCase()],
      statusEndpoint: { host: '127.0.0.1', port: endpoints[index * 2] }, eulaAccepted: true,
      serverInfo: { id, name: `Protocol ${id}`, type: 'vanilla', minecraftVersion: 'protocol-fixture',
        java: { runtimeVersion: process.version, requiredMajor: null }, detection: { confidence: 'high', evidence: ['synthetic-plan-not-detection'], warnings: [] } },
      getRconConnection: async () => ({ host: '127.0.0.1', port: endpoints[index * 2 + 1], password: 'protocol-fixture-only' }) };
    adapters.push(new LocalJavaAdapter({ plan, revalidateBeforeStart: async () => {} }, await factory.create(plan)));
  }
  app = buildApp({ mode: 'local', adapters, managerRoot: evidence, localRuntimeFactory: factory,
    operationStore: new JsonOperationStore(evidence), backupSchedulerTimers: false }); await app.ready();
  const firstKey = randomUUID(); const [first, second] = await Promise.all([action('a', 'start', firstKey), action('b', 'start', firstKey)]);
  assert.notEqual(first.id, second.id); assert.equal(first.serverId, 'a'); assert.equal(second.serverId, 'b');
  assert.equal(children.length, 2); assert(children.every(row => row.child.exitCode === null)); checks.push('two live independent Node protocol processes');
  await Promise.all([command('a', 'say alpha'), command('b', 'say beta')]); checks.push('HTTP RCON marker responses bound to selected instance');
  const firstPid = children.find(row => row.id === 'a').child.pid, bPid = children.find(row => row.id === 'b').child.pid;
  await action('a', 'restart'); assert.equal(children.length, 3); assert.notEqual(children.at(-1).child.pid, firstPid);
  assert.equal(children.find(row => row.id === 'b').child.pid, bPid); assert.equal(children.find(row => row.id === 'b').child.exitCode, null);
  const replay = await request('/api/v1/servers/a/actions/start', {}, firstKey); assert.equal(replay.operation.id, first.id); assert.equal(children.length, 3);
  checks.push('restart changes only A generation; same-key replay creates no child');
  await command('a', 'say delta'); await action('a', 'stop'); await command('b', 'say gamma'); await action('b', 'stop');
  checks.push('stopping A leaves B command channel usable');
  for (const [id, expected] of [['a', ['say alpha', 'stop', 'say delta', 'stop']], ['b', ['say beta', 'say gamma', 'stop']]]) {
    const rows = (await readFile(path.join(evidence, `instance-${id}/received.jsonl`), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert(rows.every(row => row.marker === id.toUpperCase())); assert.deepEqual(rows.map(row => row.command), expected);
  }
  for (const row of children) {
    const index = row.id === 'a' ? 0 : 2;
    for (const port of endpoints.slice(index, index + 2)) assert(observations.some(proof => proof.pid === row.child.pid && proof.serverPort === port));
  }
  checks.push('per-process game/RCON native ownership evidence and exact non-crossed command logs'); report.result = 'PASS';
} catch (error) { report.errorCode = typeof error?.code === 'string' ? error.code : 'NO_EXPLICIT_ERROR_CODE'; report.error = String(error?.message ?? 'protocol-acceptance-failed'); }
finally {
  report.cleanupErrors = [];
  for (const row of children) if (row.child.exitCode === null && row.child.signalCode === null) {
    report.diagnosticStdinStop = true; row.stopRequested = true;
    row.child.stdin.once('error', () => report.cleanupErrors.push('FIXTURE_STDIN_FAILED'));
    try { row.child.stdin.write('stop\n', error => { if (error) report.cleanupErrors.push('FIXTURE_STDIN_FAILED'); }); }
    catch { report.cleanupErrors.push('FIXTURE_STDIN_FAILED'); }
  }
  for (let i = 0; children.some(row => !row.closed) && i < 100; i++) await sleep(100);
  report.finalStopped = children.every(row => row.closed);
  try { if (app) await app.close(); report.helpersClosed = true; } catch { report.cleanupErrors.push('APP_CLOSE_FAILED'); }
  report.portsReleased = (await Promise.all(endpoints.map(released))).every(Boolean);
  report.launches = children.map(row => ({ id: row.id, pid: row.child.pid, closed: row.closed, exitCode: row.exitCode, exitSignal: row.exitSignal, premature: row.premature }));
  for (const [index, row] of children.entries()) for (const stream of ['stdout', 'stderr']) await writeFile(path.join(evidence, `launch-${index + 1}-${stream}.log`), row[stream]);
  if (!report.finalStopped || !report.helpersClosed || !report.portsReleased || report.captureOverflow || report.cleanupErrors.length || report.diagnosticStdinStop ||
    report.launches.some(row => row.exitCode !== 0 || row.exitSignal !== null || row.premature)) report.result = 'BLOCKED';
  if (!report.finalStopped) report.cleanup = 'CLEANUP_BLOCKED';
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2)); console.log(`${report.result}: ${runId}`);
  process.exitCode = report.result === 'PASS' ? 0 : 1;
}
