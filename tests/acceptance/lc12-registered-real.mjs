// Explicitly authorized registered test instance only. Never selects arbitrary roots.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildApp } from '../../apps/api/src/app.ts';
import { createLocalAdapters } from '../../apps/api/src/config/bootstrap.ts';
import { parseProperties } from '../../apps/api/src/config/properties.ts';
import { LocalRuntimeFactory } from '../../apps/api/src/infra/runtime/index.ts';
import { ActiveWorldStateStore } from '../../apps/api/src/services/active-world-state-store.ts';
import { JsonOperationStore } from '../../apps/api/src/services/operation-store.ts';
import { TransactionJournalStore } from '../../apps/api/src/services/transaction-journal.ts';
import { patchPropertiesExact } from '../../apps/api/src/services/properties-patch.ts';
import { createRedactor } from '../../apps/api/src/infra/runtime/redactor.ts';
import { classifyDiagnosticText, diagnosticsAllowed } from './import-diagnostics.mjs';

assert.equal(process.env.LT_REGISTERED_REAL, '1', 'explicit registered-instance test opt-in required');
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const auth = JSON.parse(await readFile(path.join(workspace, '.manager/test-instance-authorization.json'), 'utf8'));
assert.equal(auth.serverId, 'vanilla-26-3'); assert.equal(auth.minecraftVersion, '26.3');
const config = JSON.parse(await readFile(path.join(workspace, '.manager/config.json'), 'utf8'));
const registration = config.servers.find(row => row.id === auth.serverId);
assert(registration); assert.equal(registration.root, auth.canonicalRoot);
const root = await realpath(registration.root);
assert.equal(root.toLowerCase(), path.resolve(auth.canonicalRoot).toLowerCase());
for (let cursor = root;; cursor = path.dirname(cursor)) {
  assert(!(await lstat(cursor)).isSymbolicLink(), 'linked test root');
  if (path.dirname(cursor) === cursor) break;
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(digest(await readFile(path.join(root, registration.jarFile))), auth.observedJarSha256);
const runId = `lc12-real-${randomUUID()}`, managerRoot = path.join(workspace, '.manager', runId);
await mkdir(managerRoot); await mkdir(path.join(managerRoot, 'originals'));
const report = { runId, serverId: auth.serverId, result: 'BLOCKED', LC1: 'NOT RUN', LC2: 'NOT RUN',
  checks: [], launches: [], finalStopped: false, restored: false, helpersClosed: false };
const originals = new Map();
for (const name of ['server.properties', 'whitelist.json', 'usercache.json']) {
  const file = path.join(root, name);
  let bytes = null;
  try { const stat = await lstat(file); assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1); bytes = await readFile(file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  originals.set(name, bytes);
  if (bytes) await writeFile(path.join(managerRoot, 'originals', name), bytes, { flag: 'wx' });
}
const secret = randomBytes(24).toString('hex');
const previousSecret = parseProperties(originals.get('server.properties').toString('utf8')).get('rcon.password');
const redactor = createRedactor({ secrets: () => [secret, previousSecret] });
const redact = value => redactor.redactText(String(value));
const base = `/api/v1/servers/${auth.serverId}`;
const headers = { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:3000', 'x-manager-intent': 'local-ui' };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let app, adapters, prepared = false, appClosed = true;
const originalCrashReports = await readdir(path.join(root, 'crash-reports')).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
const children = [];
const check = name => { report.checks.push(name); console.log(`PASS: ${name}`); };
async function replace(name, bytes) {
  assert.equal((await realpath(root)).toLowerCase(), auth.canonicalRoot.toLowerCase());
  const file = path.join(root, name), stage = `${file}.${runId}.tmp`;
  await writeFile(stage, bytes, { flag: 'wx' }); await rename(stage, file);
}
async function freePorts() {
  const sockets = [];
  try {
    for (let i = 0; i < 2; i++) {
      const server = net.createServer(); sockets.push(server);
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve); });
    }
    return sockets.map(server => server.address().port);
  } finally { for (const server of sockets) if (server.listening) await new Promise(resolve => server.close(resolve)); }
}
async function connected(port) {
  return new Promise(resolve => { const socket = net.connect({ host: '127.0.0.1', port });
    const done = result => { socket.destroy(); resolve(result); };
    socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.setTimeout(1000, () => done(false)); });
}
const runtimeFactory = new LocalRuntimeFactory({ spawnProcess(executable, argv, options) {
  assert.equal(options.cwd.toLowerCase(), root.toLowerCase()); assert.equal(executable, registration.javaExecutable);
  assert.deepEqual([...argv], [...registration.jvmArgs, '-jar', path.join(root, registration.jarFile), ...registration.serverArgs]);
  assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
  const child = spawn(executable, [...argv], options);
  const row = { child, stdout: '', stderr: '', closed: false, stopRequested: false, exitCode: null, exitSignal: null };
  children.push(row); report.launches.push({ pid: child.pid, javaVerified: true, launcherVerified: true });
  for (const channel of ['stdout', 'stderr']) child[channel].on('data', data => {
    row[channel] += redact(data.toString('utf8'));
    if (row[channel].length > 8 * 1024 ** 2) report.captureOverflow = true;
  });
  child.once('exit', (code, signal) => { row.exitCode = code; row.exitSignal = signal; row.prematureExit = !row.stopRequested; });
  child.once('close', () => { row.closed = true; });
  return child;
} });
async function openApp() {
  adapters = await createLocalAdapters(managerRoot, runtimeFactory);
  assert.equal(adapters.length, 1); assert.equal(adapters[0].serverId, auth.serverId);
  const journal = new TransactionJournalStore(managerRoot);
  app = buildApp({ adapters, mode: 'local', managerRoot, transactionJournal: journal, transactionRecovery: journal,
    operationStore: new JsonOperationStore(managerRoot), activeWorldState: new ActiveWorldStateStore(managerRoot, adapters) });
  appClosed = false;
  await app.ready();
}
async function request(url, payload, method = payload === undefined ? 'GET' : 'POST', extra = {}) {
  const response = await app.inject({ method, url, headers: { ...headers, 'idempotency-key': randomUUID(), ...extra },
    ...(payload === undefined ? {} : { payload }) });
  assert(!response.body.includes(secret), 'secret disclosure');
  const body = response.json();
  assert(response.statusCode < 300, `${method} ${url}: HTTP ${response.statusCode} ${body.error?.code}`);
  return body.data;
}
async function terminal(operation) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const current = await request(`/api/v1/operations/${operation.id}`);
    if (['succeeded', 'failed', 'interrupted'].includes(current.state)) {
      assert.equal(current.state, 'succeeded', JSON.stringify(current.error)); return current;
    }
    await wait(300);
  }
  throw new Error('acceptance operation deadline');
}
async function action(name) {
  if (name === 'stop') children.at(-1).stopRequested = true;
  const result = await request(`${base}/actions/${name}`, {}); await terminal(result.operation);
}
async function stop() {
  const status = (await request(base)).status;
  if (status.ownership === 'managed' && ['running', 'starting'].includes(status.state)) await action('stop');
  for (let i = 0; children.some(row => !row.closed) && i < 100; i++) await wait(100);
  assert(children.every(row => row.closed), 'CLEANUP_BLOCKED: managed process not closed');
  report.finalStopped = (await request(base)).status.state === 'stopped';
  assert(report.finalStopped);
}
async function save(changes, revision, key = randomUUID()) {
  const result = await request(`${base}/properties`, { changes, confirmOfflineIdentity: true }, 'PATCH',
    { 'if-match': `"${revision}"`, 'idempotency-key': key });
  return terminal(result.operation);
}
try {
  console.log(`AUTHORIZED TEST ROOT: ${root}`); console.log(`Run: ${runId}`);
  // Conservative host precondition: no existing Java process, regardless of its root.
  // Do not alter ports/configuration to manufacture a stopped-state observation.
  const query = await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -match '^javaw?\\.exe$' }).Count"],
    { windowsHide: true, timeout: 10_000, maxBuffer: 4096 });
  assert.equal(query.stdout.trim(), '0', 'existing Java process: do not change test instance');
  report.preExistingJavaProcesses = 0;
  const originalFields = parseProperties(originals.get('server.properties').toString('utf8'));
  assert.equal(originalFields.get('online-mode'), 'true', 'this real-account test requires online-mode unchanged');
  for (const port of [Number(originalFields.get('server-port')), Number(originalFields.get('rcon.port'))])
    assert(!(await connected(port)), 'existing listener on original instance port');
  const [gamePort, rconPort] = await freePorts(); report.gamePort = gamePort; report.rconPort = rconPort;
  const setup = { 'server-ip': '127.0.0.1', 'server-port': String(gamePort), 'rcon.port': String(rconPort), 'enable-rcon': 'true', 'rcon.password': secret };
  let text = originals.get('server.properties').toString('utf8');
  for (const [key, value] of Object.entries(setup)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const pattern = new RegExp(`^${escaped}=.*$`, 'gmu');
    assert.equal([...text.matchAll(pattern)].length, 1, 'ambiguous test preparation field');
    text = text.replace(pattern, `${key}=${value}`);
  }
  text += '\n# LT dynamic-discovery acceptance\nlt-acceptance-option=12\n';
  await replace('server.properties', text); prepared = true;
  await writeFile(path.join(managerRoot, 'config.json'), JSON.stringify({ schemaVersion: 1, servers: [registration] }));
  await openApp();
  let properties = await request(`${base}/properties`);
  const discovered = properties.discovery.items.find(row => row.key === 'lt-acceptance-option');
  assert(discovered); assert.equal(discovered.editable, false);
  assert.equal(properties.discovery.items.filter(row => row.key === 'motd').length, 1);
  const changes = { motd: `LT ${runId}`, 'max-players': '7', difficulty: 'hard', gamemode: 'creative' };
  const beforeSave = await readFile(path.join(root, 'server.properties'));
  const key = randomUUID(), saved = await save(changes, properties.revision, key);
  assert.equal(children.length, 0, 'configuration save launched Java');
  const afterSave = await readFile(path.join(root, 'server.properties'));
  assert(afterSave.equals(Buffer.from(patchPropertiesExact(beforeSave.toString('utf8'), changes))));
  const scan = await new TransactionJournalStore(managerRoot).scan(); assert.deepEqual(scan.issues, []);
  assert.equal(scan.records.find(row => row.intent.operationId === saved.id)?.state, 'committed');
  const guardFile = path.join(managerRoot, 'properties-backups', auth.serverId, saved.result.resourceId, 'original.properties');
  assert((await readFile(guardFile)).equals(beforeSave));
  const replay = await save(changes, properties.revision, key); assert.equal(replay.id, saved.id);
  await app.close(); appClosed = true; app = undefined; await openApp();
  const restartReplay = await save(changes, properties.revision, key); assert.equal(restartReplay.id, saved.id);
  properties = await request(`${base}/properties`);
  for (const [name, value] of Object.entries(changes)) assert.equal(String(properties.fields[name]), value);
  check('LC1 dynamic discovery, exact incremental save, pinned original, committed journal and restart idempotency');
  await action('start'); await wait(1500);
  const row = children.at(-1), launch = report.launches.at(-1);
  assert(!row.closed); assert.match(row.stdout, /Done \([^)]+\)!/u); assert.match(row.stdout, /Default game type: CREATIVE/u);
  assert.match(row.stdout, /Preparing level "world"/u);
  assert.deepEqual(await readdir(path.join(root, 'crash-reports')).catch(error => { if (error.code === 'ENOENT') return []; throw error; }), originalCrashReports);
  assert(await connected(gamePort)); assert(await connected(rconPort));
  const command = async text => { await wait(3500); return request(`${base}/commands`, { command: text }); };
  assert.match((await command('difficulty')).output, /hard/iu);
  assert.match((await command('list')).output, /max of 7/u);
  const log = await readFile(path.join(root, 'logs/latest.log'), 'utf8');
  const diagnostics = classifyDiagnosticText({ log, stdout: row.stdout, stderr: row.stderr, captureOverflow: !!report.captureOverflow });
  launch.diagnostics = diagnostics;
  launch.readiness = { processAlive: true, managedChild: true, freshDone: true, rconReady: true, listSucceeded: true,
    expectedWorldLoaded: true, gamePortReady: true, rconPortReady: true, noCrashReport: !/crash report has been saved/u.test(log), noPrematureShutdown: !row.closed };
  // Keep diagnostics as a mandatory final Gate. A healthy test process can still
  // supply separate business-test evidence; collecting it never clears this Gate.
  launch.startupDiagnosticsPassed = diagnosticsAllowed(diagnostics, launch.readiness);
  assert(!/Encountered an unexpected exception|crash report has been saved|Stopping server/u.test(log), 'unsafe runtime baseline');
  report.LC1 = 'PASS'; check('LC1 real Vanilla startup: saved difficulty, gamemode and player capacity effective');
  const beforeList = await request(`${base}/whitelist`); assert.equal(beforeList.membershipWritable, true);
  // Prefer an actual historical candidate. Ask Minecraft to resolve the account;
  // never invent or inject a UUID, including when the cache is empty.
  const candidateBefore = await request(`${base}/whitelist/candidates`);
  const player = candidateBefore.items[0]?.name ?? 'Notch';
  report.testPlayerSource = candidateBefore.items.length ? 'actual-usercache-candidate' : 'manual-input';
  assert(!beforeList.items.some(item => item.name.toLowerCase() === player.toLowerCase()));
  const mutate = async (actionName, expected) => {
    const list = await request(`${base}/whitelist`);
    const result = await request(`${base}/whitelist/members`, { action: actionName, name: player, revision: list.revision, confirm: true });
    report.checks.push({ action: actionName, outcome: result.outcome, code: result.code });
    assert.equal(result.outcome, expected, JSON.stringify(result)); return result;
  };
  await mutate('add', 'succeeded');
  assert((await request(`${base}/whitelist`)).items.some(item => item.name === player));
  assert.equal((await mutate('add', 'failed')).code, 'ALREADY_WHITELISTED');
  await mutate('remove', 'succeeded');
  assert(!(await request(`${base}/whitelist`)).items.some(item => item.name === player));
  assert.equal((await mutate('remove', 'failed')).code, 'NOT_WHITELISTED');
  const candidates = await request(`${base}/whitelist/candidates`);
  report.candidateAvailability = candidates.availability;
  assert.equal(candidates.availability, 'available');
  assert((await request(base)).status.state === 'running');
  report.LC2 = 'PASS'; check('LC2 real add/delete, duplicate/missing results, disk/live agreement and candidate reading');
  await stop();
  for (const owned of children) { assert.equal(owned.exitCode, 0); assert.equal(owned.exitSignal, null); }
  assert(!(await connected(gamePort))); assert(!(await connected(rconPort)));
  check('normal explicit stop, exit 0/null, ports released');
  assert(launch.startupDiagnosticsPassed, 'startup diagnostics blocked; business checks do not override this Gate');
  const finalLog = await readFile(path.join(root, 'logs/latest.log'), 'utf8');
  assert(diagnosticsAllowed(classifyDiagnosticText({ log: finalLog, stdout: row.stdout, stderr: row.stderr,
    captureOverflow: !!report.captureOverflow, shutdownAuthorized: true }), launch.readiness), 'shutdown diagnostics blocked');
  report.result = 'PASS';
} catch (error) {
  report.failure = { code: error.code ?? 'NO_EXPLICIT_ERROR_CODE', message: redact(error.message), stack: redact(error.stack) };
  console.log(`BLOCKED: ${report.failure.code}: ${report.failure.message}`);
} finally {
  try { if (app) await stop(); } catch (error) { report.cleanupError = redact(error.message); }
  try { if (app && children.every(row => row.closed)) { await app.close(); appClosed = true; } } catch (error) { report.closeError = redact(error.message); }
  report.appClosed = appClosed;
  report.helpersClosed = children.every(row => row.closed);
  // Restore only after all captured Java handles have closed. Never force-clean uncertain resources.
  if (prepared && report.helpersClosed) {
    for (const [name, bytes] of originals) {
      if (bytes) await replace(name, bytes);
      else await unlink(path.join(root, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    report.restored = true;
    for (const [name, bytes] of originals) if (bytes) assert((await readFile(path.join(root, name))).equals(bytes));
  }
  for (const [index, owned] of children.entries()) {
    await writeFile(path.join(managerRoot, `launch-${index + 1}-stdout.log`), owned.stdout);
    await writeFile(path.join(managerRoot, `launch-${index + 1}-stderr.log`), owned.stderr);
    Object.assign(report.launches[index], { exitCode: owned.exitCode, exitSignal: owned.exitSignal, closed: owned.closed });
  }
  report.crashReportNames = await readdir(path.join(root, 'crash-reports')).catch(() => []);
  if (!report.helpersClosed || !report.appClosed || !report.restored || !report.finalStopped) report.result = 'BLOCKED';
  await writeFile(path.join(managerRoot, 'acceptance-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ runId, result: report.result, LC1: report.LC1, LC2: report.LC2, finalStopped: report.finalStopped,
    restored: report.restored, helpersClosed: report.helpersClosed, report: path.join(managerRoot, 'acceptance-report.json') }, null, 2));
}
process.exitCode = report.result === 'PASS' ? 0 : 1;
