// Explicit opt-in only. Fresh UUID isolated Paper/Fabric, exact verified JAR/EULA/dependency whitelist.
// Run with the project's TS loader after review; node --check never launches Java.
import assert from 'node:assert/strict';
import { prepareIsolation } from './phase55-isolation.mjs';
import { addonFlow } from './phase55-addon-flow.mjs';
import { sourcePreflight } from './phase55-source-preflight.mjs';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../apps/api/src/app.ts';
import { createLocalAdapters } from '../../apps/api/src/config/bootstrap.ts';
import { parseProperties } from '../../apps/api/src/config/properties.ts';
import { LocalRuntimeFactory } from '../../apps/api/src/infra/runtime/index.ts';
import { ActiveWorldStateStore, worldIdentity } from '../../apps/api/src/services/active-world-state-store.ts';
import { JsonOperationStore } from '../../apps/api/src/services/operation-store.ts';
import { TransactionJournalStore } from '../../apps/api/src/services/transaction-journal.ts';
import { classifyDiagnosticText, diagnosticsAllowed, fabricFinalDiagnosticsAllowed, paperFinalDiagnosticsAllowed, runtimeDiagnostic } from './import-diagnostics.mjs';
import { verifyPaperDiagnosticFiles } from './phase55-paper-diagnostics.mjs';
import { verifyFabricDiagnosticFiles } from './phase55-fabric-diagnostics.mjs';
import { inventoryRestoreTree, restoreFilesChecksum, verifyRestoreTree } from '../../apps/api/src/services/restore-files.ts';

if (process.env.MCSM_P55_REAL !== '1') {
  console.error('BLOCKED: requires exact MCSM_P55_REAL=1 opt-in; no instance created or Java launched.');
  process.exit(1);
}
if (process.env.MCSM_P55_CONSENT !== '1') {
  console.error('BLOCKED: host wrapper -ConfirmIsolatedAddons is required for isolated configuration acceptance; no Java launched.'); process.exit(1);
}
const workspace = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const kind = process.env.MCSM_P55_KIND;
assert(kind === 'paper' || kind === 'fabric');
const sourceInstance = 'readonly-' + kind + '-26.2';
const runId = process.env.MCSM_P55_RUN_ID;
if (!/^p55-(?:paper|fabric)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(runId ?? '')) {
  console.error('BLOCKED: requires the host PowerShell wrapper fresh UUID run ID; no Java launched.'); process.exit(1);
}
const serverRoot = path.join(workspace, 'runtime', runId);
const managerRoot = path.join(workspace, '.manager', runId);
const evidenceRoot = path.join(managerRoot, 'evidence');
const id = 'p55-addon-acceptance';
const base = `/api/v1/servers/${id}`;
const secret = randomBytes(32).toString('base64url');
const headers = { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:3000', 'x-manager-intent': 'local-ui' };
const clock = { now: () => new Date() };
const report = { runId, startedAt: new Date().toISOString(), result: 'RUNNING', checks: [], launches: [],
  gamePort: null, rconPort: null, sourceInstance, finalStopped: false, addons: 'BLOCKED',
  environment: { os: process.platform, powershell: null, java: null, minecraft: '26.2' },
  hostPreconditions: {}, isolation: { managerRoot, serverRoot, originalUserWorldTouched: false },
  finalState: { minecraftStopped: false, javaProcessStopped: false, portsReleased: false, managerStopped: false, noActiveOperation: false },
  evidence: { root: evidenceRoot, managerEvents: path.join(evidenceRoot, 'manager-events.jsonl') }, failures: [],
  limitations: ['Port selection releases reservations before Java binds; every launch rechecks both ports and refuses conflicts.',
    'This run checks explicit real addon loading/omission and manager recreation, not sudden power loss or player sessions.',
    'Manager runs in-process with logger disabled; manager-events.jsonl records API/operation evidence, not a separate Manager stdout stream.'] };
let app; let adapters = []; let evidenceCreated = false; let configuredJava; let sourceHashes;
let paperDiagnosticBaseline;
let fabricDiagnosticBaseline;
let phase = 'host-preconditions'; let currentOperationId = null; let lastRecoveryState = null;
let runtimeFailure = null;
const managerEvents = [];
const captures = new Map();
const logSnapshots = new Map();
// Private handles are never serialized; only these exact children may be cleaned up.
const ownedChildren = new Map();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const redact = (value) => String(value).replaceAll(secret, '[redacted]')
  .replace(/((?:rcon\.password|password|access[_-]?token|authorization)\s*[=:]\s*)[^\s,;]+/giu, '$1[redacted]');
const normalize = (value) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const check = (name) => { report.checks.push(name); console.log(`PASS: ${name}`); };
function recordFailure(code, message, logExcerpt = '', failurePhase = phase, operationId = currentOperationId) {
  report.failures.push({ phase: failurePhase, code, operationId, relevantLogExcerpt: redact(logExcerpt),
    recoveryState: lastRecoveryState, message: redact(message) });
}
function assertRuntimeHealthy() {
  if (runtimeFailure && phase !== 'final-cleanup') {
    const error = new Error('Minecraft runtime diagnostic observed; acceptance stopped without Windows repair');
    error.code = runtimeFailure.code ?? 'MINECRAFT_RUNTIME_DIAGNOSTIC'; throw error;
  }
}
async function plain(file, directory = false) {
  const stat = await lstat(file);
  assert(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1), 'unsafe path');
  assert.equal(normalize(await realpath(file)), normalize(file), 'noncanonical path');
  return stat;
}
async function absent(file) { await assert.rejects(lstat(file), { code: 'ENOENT' }); }
async function assertFreePorts() {
  // Bind rather than interpreting refused connections; busy/forbidden ports abort.
  const sockets = [];
  try {
    for (const port of [report.gamePort, report.rconPort]) {
      assert(Number.isInteger(port) && port > 0 && port <= 65535, 'ports not assigned');
      const socket = net.createServer(); sockets.push(socket);
      await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen({ host: '127.0.0.1', port, exclusive: true }, resolve); });
    }
  } finally {
    for (const socket of sockets) if (socket.listening) await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  }
}
async function selectPorts() {
  const sockets = [];
  try {
    for (let n = 0; n < 2; n++) {
      const socket = net.createServer(); sockets.push(socket);
      await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve); });
    }
    [report.gamePort, report.rconPort] = sockets.map((socket) => socket.address().port);
    assert.notEqual(report.gamePort, report.rconPort);
  } finally {
    for (const socket of sockets) if (socket.listening) await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  }
}
async function connected(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(1500); socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false)); socket.once('timeout', () => finish(false));
  });
}
const runtimeFactory = new LocalRuntimeFactory({ spawnProcess(executable, argv, options) {
  assert.equal(normalize(options.cwd), normalize(serverRoot), 'launch outside fresh isolated root');
  assert.equal(normalize(executable), normalize(configuredJava), 'unexpected Java executable');
  assert.deepEqual([...argv], ['-Xms512M', '-Xmx1G', '-jar', path.join(serverRoot, 'server.jar'), 'nogui']);
  assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
  const environment = options.env ?? process.env;
  const launch = { executable, argv: [...argv], cwd: options.cwd, shell: options.shell, windowsHide: options.windowsHide,
    environment: { inherited: options.env === undefined, variableHashes: Object.fromEntries(Object.entries(environment).map(([key, value]) => [key, digest(String(value))])) },
    pid: null, stdout: '', stderr: '', captureOverflow: false, spawnedAt: new Date().toISOString() };
  report.launches.push(launch);
  const capture = { stdout: '', stderr: '', bytes: { stdout: 0, stderr: 0 } }; captures.set(launch, capture);
  const child = spawn(executable, [...argv], options);
  const owned = { child, pid: child.pid, exited: false, closed: false, diagnosticTail: { stdout: '', stderr: '' },
    identity: Object.freeze({ executable, cwd: options.cwd, argv: Object.freeze([...argv]) }) };
  ownedChildren.set(launch, owned);
  child.once('spawn', () => { launch.pid = child.pid; owned.pid = child.pid; });
  for (const channel of ['stdout', 'stderr']) child[channel].on('data', (chunk) => {
    const remaining = Math.max(0, 16 * 1024 ** 2 - capture.bytes[channel]);
    capture[channel] += chunk.subarray(0, remaining).toString('utf8'); capture.bytes[channel] += Math.min(chunk.length, remaining);
    if (chunk.length > remaining) {
      launch.captureOverflow = true;
      runtimeFailure ??= { code: 'ACCEPTANCE_CAPTURE_LIMIT', launch: report.launches.length, channel, excerpt: 'Captured stream exceeded hard 16MiB limit; retained bounded prefix only; acceptance aborted.' };
    }
    const diagnosticText = owned.diagnosticTail[channel] + chunk.toString('utf8');
    if (runtimeDiagnostic(diagnosticText)) runtimeFailure ??= { launch: report.launches.length, channel, excerpt: redact(diagnosticText) };
    owned.diagnosticTail[channel] = diagnosticText.slice(-4096);
  });
  child.once('exit', (code, signal) => { owned.exited = true; launch.exitCode = code; launch.exitSignal = signal;
    launch.prematureExit = !launch.stopRequestedAt; });
  child.once('close', () => { owned.closed = true; });
  child.once('error', (error) => { launch.spawnError = redact(error.message); });
  child.stdin.on('error', (error) => { launch.stdinError = redact(error.message); });
  return child;
} });
async function request(url, payload, key = randomUUID(), extraHeaders = {}) {
  assertRuntimeHealthy();
  const response = await app.inject({ method: payload === undefined ? 'GET' : 'POST', url,
    headers: { ...headers, 'idempotency-key': key, ...extraHeaders }, ...(payload === undefined ? {} : { payload }) });
  assert(!response.body.includes(secret), 'API disclosed secret');
  const body = response.json();
  managerEvents.push({ at: new Date().toISOString(), phase, method: payload === undefined ? 'GET' : 'POST', url,
    statusCode: response.statusCode, data: body.data ?? null, error: body.error ?? null });
  if (response.statusCode >= 300) {
    const error = new Error(`HTTP ${response.statusCode} ${body.error?.code}`); error.code = body.error?.code; throw error;
  }
  if (body.data?.status) lastRecoveryState = body.data.status.recoveryRequired;
  return body.data;
}
async function terminal(get, operationId) {
  for (let n = 0; n < 600; n++) {
    assertRuntimeHealthy();
    const operation = await get(operationId);
    if (operation && ['succeeded', 'failed', 'interrupted'].includes(operation.state)) return operation;
    await wait(300);
  }
  throw new Error('operation timeout; retained evidence requires inspection');
}
async function operation(url, payload, key = randomUUID()) {
  const accepted = (await request(url, payload, key)).operation;
  currentOperationId = accepted.id;
  const completed = await terminal((operationId) => request(`/api/v1/operations/${operationId}`), accepted.id);
  if (completed.state !== 'succeeded') {
    const error = new Error(`${completed.kind}: ${completed.error?.code ?? completed.state}`); error.code = completed.error?.code ?? completed.state; throw error;
  }
  return completed;
}
async function openApp() {
  adapters = await createLocalAdapters(managerRoot, runtimeFactory);
  assert.equal(adapters.length, 1); assert.equal(adapters[0].serverId, id);
  assert.equal(normalize(adapters[0].plan.rootPath), normalize(serverRoot));
  const journal = new TransactionJournalStore(managerRoot);
  app = buildApp({ adapters, mode: 'local', managerRoot, transactionJournal: journal, transactionRecovery: journal,
    operationStore: new JsonOperationStore(managerRoot), activeWorldState: new ActiveWorldStateStore(managerRoot, adapters) });
  await app.ready();
}
async function closeApp() { if (app) { await app.close(); app = undefined; adapters = []; } }
async function stopped() {
  const status = (await request(base)).status;
  assert.equal(status.state, 'stopped'); assert.equal(status.ownership, 'none'); return status;
}
async function command(text) {
  // Preserve the real acceptance scripts' interval for the server's command gate.
  await wait(3500);
  const result = await request(`${base}/commands`, { command: text });
  assert.equal(result.transport, 'rcon'); return result.output;
}
// Paper opt-in binds each capture to the current launch and unchanged isolated artifacts.
// Recognition is conditional; final acceptance separately requires complete stop evidence.
async function classifyDiagnostics(launch, log) {
  const capture = captures.get(launch); launch.stdout = redact(capture.stdout); launch.stderr = redact(capture.stderr);
  let paperContext = null;
  let fabricContext = null;
  if (kind === 'paper' && paperDiagnosticBaseline) {
    const proof = await verifyPaperDiagnosticFiles(sourceHashes, serverRoot, paperDiagnosticBaseline);
    paperContext = { kind, javaMajor: Number(report.javaVersion?.split('.')[0]), launchId: `${runId}:${launch.pid}`,
      ...proof, startupWindow: { spawnedAt: launch.spawnedAt, doneAt: launch.doneAt } };
    launch.paperDiagnosticArtifactEvidence = proof;
  }
  if (kind === 'fabric' && fabricDiagnosticBaseline) {
    const proof = await verifyFabricDiagnosticFiles(sourceHashes, serverRoot, fabricDiagnosticBaseline);
    fabricContext = { kind, javaMajor: Number(report.javaVersion?.split('.')[0]), minecraftVersion: report.minecraftVersion,
      loaderVersion: '0.19.5', launchId: `${runId}:${launch.pid}`, captureSessionId: `${runId}:${ownedChildren.get(launch)?.pid}`,
      serverRoot, isolationRootIdentity: fabricDiagnosticBaseline.rootIdentity, ...proof };
    launch.fabricDiagnosticArtifactEvidence = proof;
  }
  const diagnostics = classifyDiagnosticText({ log, stdout: launch.stdout, stderr: launch.stderr, captureOverflow: launch.captureOverflow,
    prematureExit: launch.prematureExit, shutdownAuthorized: Boolean(launch.stopRequestedAt), paperContext, fabricContext });
  Object.assign(launch, diagnostics);
  return diagnosticsAllowed(diagnostics, launch.verifiedReadiness);
}
async function captureLog() {
  const launch = report.launches.at(-1); if (!launch) return null;
  const file = path.join(serverRoot, 'logs', 'latest.log');
  let log = '';
  try { await plain(file); log = redact(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const clean = await classifyDiagnostics(launch, log);
  logSnapshots.set(launch, log);
  await writeFile(path.join(evidenceRoot, `launch-${report.launches.length}-latest.log`), log, { mode: 0o600 });
  launch.cleanDiagnostics = clean;
  return { launch, log, clean };
}
async function runningEvidence(label, worldName) {
  await wait(2000); const status = (await request(base)).status;
  assert.equal(status.state, 'running'); assert.equal(status.ownership, 'managed');
  const evidence = await captureLog(); const { launch } = evidence;
  assert(launch.pid); process.kill(launch.pid, 0);
  launch.done = launch.stdout.split(/\r?\n/u).find((line) => /(?:^|\]:? )Done \(\d+(?:\.\d+)?s\)! For help, type "help"(?:,.*)?$/u.test(line));
  assert(launch.done, 'fresh process Done missing');
  // Paper stdout supplies a local HH:mm:ss timestamp. Resolve it in this
  // launch's local day (including midnight), never use readiness probe time.
  const doneClock = /^\[(\d\d):(\d\d):(\d\d) INFO\]:/u.exec(launch.done);
  if (doneClock) {
    const date = new Date(launch.spawnedAt); date.setHours(Number(doneClock[1]), Number(doneClock[2]), Number(doneClock[3]), 999);
    if (date.getTime() < Date.parse(launch.spawnedAt)) date.setDate(date.getDate() + 1);
    launch.doneAt = date.toISOString();
  }
  launch.rcon = launch.stdout.split(/\r?\n/u).find((line) => line.includes(`RCON running on 127.0.0.1:${report.rconPort}`));
  assert(launch.rcon, 'fresh RCON readiness missing');
  assert(launch.stdout.includes(`Preparing level "${worldName}"`), 'unexpected configured world');
  assert(!/Encountered an unexpected exception|crash report has been saved|Stopping server/u.test([evidence.log, launch.stdout, launch.stderr].join('\n')), 'fatal startup or premature shutdown');
  assert(await connected(report.gamePort)); assert(await connected(report.rconPort));
  launch.list = await command('list'); assert.match(launch.list, /There are .* players online/u);
  await plain(path.join(serverRoot, worldName), true); await plain(path.join(serverRoot, worldName, 'level.dat'));
  // Re-capture after all probes; warnings/errors may have arrived during RCON.
  const latest = await captureLog();
  const combined = [latest.log, launch.stdout, launch.stderr].join('\n');
  assert(!/Encountered an unexpected exception|crash report has been saved|Stopping server/u.test(combined), 'fatal startup or premature shutdown');
  const crashes = await readdir(path.join(serverRoot, 'crash-reports')).catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
  assert.deepEqual(crashes, [], 'crash report present');
  const owned = ownedChildren.get(launch);
  assert(owned && !owned.exited && owned.pid === launch.pid && owned.child.pid === launch.pid, 'managed child exited or changed');
  process.kill(launch.pid, 0);
  const finalStatus = (await request(base)).status;
  assert.equal(finalStatus.state, 'running'); assert.equal(finalStatus.ownership, 'managed');
  assert(await connected(report.gamePort)); assert(await connected(report.rconPort));
  const finalCapture = await captureLog();
  assert(!/Encountered an unexpected exception|crash report has been saved|Stopping server/u.test(
    [finalCapture.log, launch.stdout, launch.stderr].join('\n')), 'fatal startup or premature shutdown');
  assert(!owned.exited, 'managed child exited during readiness probes');
  assertOwnedLiveChild(launch, owned);
  launch.verifiedReadiness = { processAlive: true, managedChild: true, freshDone: true, rconReady: true, listSucceeded: true,
    expectedWorldLoaded: true, gamePortReady: true, rconPortReady: true, noCrashReport: true, noPrematureShutdown: true, ownedChildIdentityValid: true };
  launch.cleanDiagnostics = await classifyDiagnostics(launch, finalCapture.log);
  assert(launch.cleanDiagnostics, `${label}: ERROR or unclassified WARN; captured unchanged; no repair permitted`);
  check(label);
}
async function start(worldName, label) {
  await assertFreePorts(); await operation(`${base}/actions/start`, {}); await runningEvidence(label, worldName);
}
async function stop() {
  await authorizeNormalStop();
  await operation(`${base}/actions/stop`, {}); await stopped();
  report.launches.at(-1).normalManagerStopSucceeded = true;
  assert(await waitChildClose(ownedChildren.get(report.launches.at(-1)), 10_000), 'child output pipes did not close after normal stop');
  const evidence = await captureLog(); assert(evidence.clean, 'shutdown ERROR/unclassified WARN');
  assert.equal(evidence.launch.exitCode, 0); assert.equal(evidence.launch.exitSignal, null);
  await assertFreePorts();
}
async function manifest(backupId) {
  const file = path.join(managerRoot, 'backups', id, backupId, 'manifest.json'); await plain(file);
  return JSON.parse(await readFile(file, 'utf8'));
}
async function bounded(action, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([action(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: bounded cleanup timeout`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
const childExited = (owned) => owned.exited || (!owned.pid && owned.closed) || owned.child.exitCode !== null || owned.child.signalCode !== null;
async function waitChildExit(owned, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!childExited(owned) && Date.now() < deadline) await wait(100);
  return childExited(owned);
}
async function waitChildClose(owned, timeoutMs) {
  assert(owned, 'captured child handle missing');
  const deadline = Date.now() + timeoutMs;
  while (!owned.closed && Date.now() < deadline) await wait(100);
  return owned.closed;
}
function assertOwnedLiveChild(launch, owned) {
  const { child, identity } = owned;
  assert.equal(ownedChildren.get(launch), owned); assert(!childExited(owned));
  assert(Number.isSafeInteger(owned.pid) && owned.pid > 0);
  assert.equal(child.pid, owned.pid); assert.equal(launch.pid, owned.pid);
  assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
  assert.equal(normalize(identity.cwd), normalize(serverRoot)); assert.equal(normalize(launch.cwd), normalize(identity.cwd));
  assert.equal(normalize(identity.executable), normalize(configuredJava));
  assert.equal(normalize(launch.executable), normalize(identity.executable));
  assert.equal(normalize(child.spawnfile), normalize(identity.executable));
  assert.deepEqual(launch.argv, [...identity.argv]); assert.deepEqual(child.spawnargs.slice(1), [...identity.argv]);
  // A liveness check only; termination always uses the captured child handle.
  process.kill(owned.pid, 0);
}
async function authorizeNormalStop() {
  const launch = report.launches.at(-1); const owned = ownedChildren.get(launch);
  assert(owned, 'normal stop has no owned child'); assertOwnedLiveChild(launch, owned);
  const evidence = await captureLog();
  assert(!/Stopping server/u.test([evidence.log, launch.stdout, launch.stderr].join('\n')), 'premature shutdown before explicit stop');
  assertOwnedLiveChild(launch, owned);
  // This records explicit authorization, not an atomic proof of causation.
  launch.stopRequestedAt = new Date().toISOString();
}
async function cleanupOwnedProcesses() {
  const cleanup = { managerStop: 'not-needed', children: [] }; report.processCleanup = cleanup;
  if (app) {
    try {
      let overview = await bounded(() => request(base), 5000, 'manager cleanup status');
      const deadline = Date.now() + 20_000;
      while (overview.status.activeOperationId && Date.now() < deadline) {
        await wait(500); overview = await bounded(() => request(base), 5000, 'active lifecycle cleanup status');
      }
      cleanup.activeOperationAfterWait = overview.status.activeOperationId;
      if (overview.status.ownership === 'managed' && overview.status.state !== 'stopped') {
        if (overview.status.activeOperationId || !overview.readiness.stop.allowed) {
          cleanup.managerStop = 'unavailable'; cleanup.managerStopReason = overview.readiness.stop.reason ?? 'active-operation';
        } else {
          cleanup.managerStop = 'requested';
          await authorizeNormalStop();
          const accepted = (await bounded(() => request(`${base}/actions/stop`, {}), 5000, 'manager cleanup stop request')).operation;
          let outcome;
          const stopDeadline = Date.now() + 20_000;
          do {
            outcome = await bounded(() => request(`/api/v1/operations/${accepted.id}`), 5000, 'manager cleanup stop poll');
            if (['succeeded', 'failed', 'interrupted'].includes(outcome.state)) break;
            await wait(300);
          } while (Date.now() < stopDeadline);
          cleanup.managerStopOperationId = accepted.id; cleanup.managerStop = outcome.state;
          if (outcome.state === 'succeeded') report.launches.at(-1).normalManagerStopSucceeded = true;
        }
      }
    } catch (error) { cleanup.managerStop = 'failed'; cleanup.managerStopFailure = redact(error.message); }
  }
  // Emergency actions are harness cleanup after a failed/unavailable manager stop.
  // They cannot establish product PASS or resolve transaction recovery gates.
  for (const [launch, owned] of ownedChildren) {
    if (childExited(owned)) continue;
    report.result = 'BLOCKED';
    const emergency = { pid: owned.pid, cwd: owned.identity.cwd, executable: owned.identity.executable, actions: [], exited: false };
    cleanup.children.push(emergency); report.emergencyCleanup = true;
    try {
      assertOwnedLiveChild(launch, owned);
      if (owned.child.stdin.writable && !owned.child.stdin.destroyed) {
        emergency.actions.push('captured-child-stdin-stop');
        await bounded(() => new Promise((resolve, reject) => owned.child.stdin.write('stop\n', 'utf8', (error) => error ? reject(error) : resolve())), 2000, 'captured stdin stop')
          .catch((error) => { emergency.stdinFailure = redact(error.message); });
        await waitChildExit(owned, 30_000);
      }
      if (!childExited(owned)) {
        assertOwnedLiveChild(launch, owned); emergency.actions.push('captured-child-SIGTERM');
        emergency.terminateAccepted = owned.child.kill('SIGTERM'); await waitChildExit(owned, 10_000);
      }
      if (!childExited(owned)) {
        assertOwnedLiveChild(launch, owned); emergency.actions.push('captured-child-SIGKILL');
        emergency.killAccepted = owned.child.kill('SIGKILL'); await waitChildExit(owned, 10_000);
      }
      emergency.exited = childExited(owned);
    } catch (error) { emergency.failure = redact(error.message); emergency.exited = childExited(owned); }
  }
  cleanup.allCapturedChildrenExited = [...ownedChildren.values()].every(childExited);
  // 'exit' precedes pipe drainage; 'close' confirms all captured output arrived.
  for (const owned of ownedChildren.values()) if (childExited(owned)) await waitChildClose(owned, 10_000);
  cleanup.allCapturedPipesClosed = [...ownedChildren.values()].every((owned) => owned.closed);
  try { await assertFreePorts(); cleanup.portsFree = true; }
  catch (error) { cleanup.portsFree = false; cleanup.portFailure = redact(error.message); }
  let managerStatus;
  try {
    if (app) managerStatus = (await bounded(() => request(base), 5000, 'final manager status')).status;
    else if (adapters.length === 1) managerStatus = await bounded(() => adapters[0].getStatus(), 5000, 'final adapter status');
    cleanup.managerStatus = managerStatus ?? null;
  } catch (error) { cleanup.managerStatusUnavailable = redact(error.message); }
  report.finalState = { minecraftStopped: managerStatus?.state === 'stopped' && managerStatus?.ownership === 'none',
    javaProcessStopped: cleanup.allCapturedChildrenExited && cleanup.allCapturedPipesClosed, portsReleased: cleanup.portsFree,
    managerStopped: false, noActiveOperation: Boolean(app && managerStatus && !managerStatus.activeOperationId),
    recoveryGateCleared: managerStatus?.recoveryRequired === false };
  report.finalStopped = Object.entries(report.finalState).filter(([name]) => name !== 'managerStopped').every(([, value]) => value === true);
  if (!report.finalStopped || cleanup.managerStop === 'failed') report.result = 'BLOCKED';
}
try {
  await plain(workspace, true);
  for (const root of [path.join(workspace, 'runtime'), path.join(workspace, '.manager')]) await plain(root, true);
  await absent(serverRoot);
  // The host wrapper alone creates this fresh private evidence root before its read-only preflight.
  await plain(managerRoot, true); await plain(evidenceRoot, true);
  const hostFile = path.join(managerRoot, 'host-preflight.json'); await plain(hostFile);
  await plain(path.join(managerRoot, 'acceptance-report.json'));
  const host = JSON.parse(await readFile(hostFile, 'utf8'));
  assert.equal(host.runId, runId); assert.equal(normalize(host.isolation.managerRoot), normalize(managerRoot));
  assert.equal(normalize(host.isolation.serverRoot), normalize(serverRoot));
  assert.equal(host.isolation.originalUserWorldTouched, false);
  assert.deepEqual((await readdir(managerRoot)).sort(), ['acceptance-report.json', 'evidence', 'host-preflight.json', 'source-manifest.json']);
  assert.deepEqual(await readdir(evidenceRoot), []);
  report.hostPreconditions = host.hostPreconditions; report.environment = { ...host.environment, java: null, minecraft: '26.2' };
  report.startedAt = host.startedAt; evidenceCreated = true;
  assert.equal(host.hostPreconditions.perflibRegistry.result, 'pass'); assert.equal(host.hostPreconditions.getCounter.result, 'pass');
  assert.equal(host.environment.is64BitProcess, true); assert.equal(process.platform, 'win32');
  phase = 'isolation';
  const manifest = await prepareIsolation({ kind, runId, serverRoot, managerRoot, id, secret, report, plain, absent, selectPorts, assertFreePorts });
  configuredJava = manifest.java.executable; sourceHashes = manifest;
  if (kind === 'paper') paperDiagnosticBaseline = await verifyPaperDiagnosticFiles(manifest, serverRoot);
  if (kind === 'fabric') fabricDiagnosticBaseline = await verifyFabricDiagnosticFiles(manifest, serverRoot);
  await openApp(); const info = await request(base); await stopped(); assert.equal(info.status.recoveryRequired, false);
  assert.equal(info.server.type, kind); assert.equal(info.server.minecraftVersion, '26.2'); assert.match(info.server.java.runtimeVersion, /^25\./u);
  report.minecraftVersion = info.server.minecraftVersion; report.javaVersion = info.server.java.runtimeVersion;
  report.environment.java = { executable: configuredJava, version: report.javaVersion }; report.environment.minecraft = report.minecraftVersion;
  check('fresh registered isolated instance; exact accepted EULA/JAR/dependencies copied; no original world access; Java 25 verified');
  await addonFlow({ kind, runId, java: configuredJava, serverRoot, managerRoot, manifest, report, plain, request, operation,
    start, stop, command, closeApp, openApp, stopped, check, getApp: () => app, headers, base, setPhase: (value) => { phase = value; } });

} catch (error) {
  report.result = 'BLOCKED'; report.failure = redact(error.stack ?? error.message); process.exitCode = 1;
  console.error(`BLOCKED: ${redact(error.message)}`);
  const launch = report.launches.at(-1); if (launch) await classifyDiagnostics(launch, logSnapshots.get(launch) ?? '');
  report.classification = phase === 'host-preconditions' ? 'environment-unavailable/precondition-failure' : 'real-acceptance';
  if (runtimeFailure) report.runtimeDiagnostic = runtimeFailure;
  recordFailure(error.code ?? (launch?.fatalRuntimeDiagnostics.length ? 'MINECRAFT_RUNTIME_DIAGNOSTIC' : 'ACCEPTANCE_ASSERTION'),
    error.message, [captures.get(launch)?.stdout ?? '', captures.get(launch)?.stderr ?? ''].join('\n').slice(-8000));
} finally {
  phase = 'final-cleanup';
  try { await cleanupOwnedProcesses(); }
  catch (error) { report.finalStopped = false; report.cleanupFailure = redact(error.message); report.result = 'BLOCKED'; recordFailure('PROCESS_CLEANUP_FAILED', error.message); }
  if (app) {
    try { await captureLog(); } catch (error) { report.captureFailure = redact(error.message); report.result = 'BLOCKED'; recordFailure('LOG_CAPTURE_FAILED', error.message); }
    try { await closeApp(); report.finalState.managerStopped = true; report.helpersClosed = true; }
    catch (error) { report.helpersClosed = false; report.closeFailure = redact(error.message); report.result = 'BLOCKED'; recordFailure('MANAGER_CLOSE_FAILED', error.message); }
  } else {
    for (const adapter of adapters) await adapter.closeObserver().catch((error) => { report.closeFailure = redact(error.message); report.result = 'BLOCKED'; recordFailure('OBSERVER_CLOSE_FAILED', error.message); });
  }
  for (const [n, launch] of report.launches.entries()) {
    // Recheck every launch after output pipe closure, including warnings that
    // arrived after its startup/stop evidence snapshot. Preserve each saved log.
    launch.cleanDiagnostics = await classifyDiagnostics(launch, logSnapshots.get(launch) ?? '');
    if (!ownedChildren.get(launch)?.closed || !launch.cleanDiagnostics || launch.exitCode !== 0 || launch.exitSignal !== null) {
      report.result = 'BLOCKED'; recordFailure('FINAL_LAUNCH_DIAGNOSTIC_FAILED', `launch ${n + 1}: closed output pipes and clean diagnostics required`,
        [launch.errors, launch.minecraftWarnings, launch.unclassifiedWarnings, launch.fatalRuntimeDiagnostics].flat().join('\n'), 'final-launch-diagnostics', null);
    }
    if (evidenceCreated) {
      await writeFile(path.join(evidenceRoot, `launch-${n + 1}-stdout.log`), launch.stdout, { mode: 0o600 });
      await writeFile(path.join(evidenceRoot, `launch-${n + 1}-stderr.log`), launch.stderr, { mode: 0o600 });
    }
  }
  report.finalStopped = Object.values(report.finalState).every((value) => value === true) && report.helpersClosed === true;
  if (kind === 'paper') for (const [n, launch] of report.launches.entries()) {
    launch.paperFinalDiagnosticGate = paperFinalDiagnosticsAllowed(launch, launch.verifiedReadiness, {
      explicitManagerNormalStop: Boolean(launch.stopRequestedAt && launch.normalManagerStopSucceeded && !report.emergencyCleanup),
      exitCode: launch.exitCode, exitSignal: launch.exitSignal, outputPipesClosed: ownedChildren.get(launch)?.closed === true,
      finalStopped: report.finalStopped, recoveryRequired: report.processCleanup?.managerStatus?.recoveryRequired
    });
    if (!launch.paperFinalDiagnosticGate) {
      report.result = 'BLOCKED'; recordFailure('PAPER_FINAL_DIAGNOSTIC_GATE_FAILED', `launch ${n + 1}: full readiness and explicit normal lifecycle evidence required`, '', 'final-launch-diagnostics', null);
    } else for (const diagnostic of launch.classifiedPaperDiagnostics) diagnostic.status = 'allowed-but-preserved';
  }
  if (kind === 'fabric') for (const [n, launch] of report.launches.entries()) {
    launch.fabricFinalDiagnosticGate = fabricFinalDiagnosticsAllowed(launch, launch.verifiedReadiness, {
      explicitManagerNormalStop: Boolean(launch.stopRequestedAt && launch.normalManagerStopSucceeded && !report.emergencyCleanup),
      exitCode: launch.exitCode, exitSignal: launch.exitSignal, outputPipesClosed: ownedChildren.get(launch)?.closed === true,
      finalStopped: report.finalStopped, recoveryRequired: report.processCleanup?.managerStatus?.recoveryRequired
    });
    if (!launch.fabricFinalDiagnosticGate) {
      report.result = 'BLOCKED'; recordFailure('FABRIC_FINAL_DIAGNOSTIC_GATE_FAILED', `launch ${n + 1}: full readiness and explicit normal lifecycle evidence required`, '', 'final-launch-diagnostics', null);
    } else for (const diagnostic of launch.classifiedFabricDiagnostics) diagnostic.status = 'allowed-but-preserved';
  }
  if (!report.finalStopped && evidenceCreated) report.result = 'BLOCKED';
  if (sourceHashes) {
    try {
      assert.deepEqual(await sourcePreflight(kind, configuredJava), sourceHashes);
      report.sourceInputsUnchanged = true;
    } catch (error) { report.sourceInputsUnchanged = false; report.sourceVerificationFailure = redact(error.message); report.result = 'BLOCKED'; recordFailure('SOURCE_INPUT_CHANGED', error.message); }
  }
  if (report.result !== 'PASS') process.exitCode = 1;
  report.finishedAt = new Date().toISOString();
  if (report.result !== 'PASS' && report.failures.length === 0) report.failures.push({ phase, code: 'FINAL_EVIDENCE_INCOMPLETE',
    operationId: currentOperationId, relevantLogExcerpt: redact(report.cleanupFailure ?? report.captureFailure ?? report.closeFailure ?? 'See launch logs and processCleanup'), recoveryState: lastRecoveryState });
  if (evidenceCreated) {
    await writeFile(path.join(evidenceRoot, 'manager-events.jsonl'), redact(managerEvents.map((event) => JSON.stringify(event)).join('\n') + '\n'), { mode: 0o600 });
    for (const file of [path.join(evidenceRoot, 'acceptance-report.json'), path.join(managerRoot, 'acceptance-report.json')]) {
      await writeFile(file, redact(JSON.stringify(report, null, 2)), { mode: 0o600 });
    }
  }
  console.log(JSON.stringify({ runId, canonicalPath: report.canonicalPath, canonicalManagerPath: report.canonicalManagerPath,
    result: report.result, addons: report.addons, finalStopped: report.finalStopped, evidenceRoot: evidenceCreated ? evidenceRoot : null }, null, 2));
}
// Deliberately no automatic cleanup: worlds, configuration guards and journals remain.
