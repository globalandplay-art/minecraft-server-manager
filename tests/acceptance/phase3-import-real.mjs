// Explicit opt-in only. Fresh isolated worlds; source instance supplies JAR/EULA only.
// Run with the project's TS loader after review; node --check never launches Java.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../apps/api/src/app.ts';
import { AdapterRegistry } from '../../apps/api/src/adapters/registry.ts';
import { createLocalAdapters } from '../../apps/api/src/config/bootstrap.ts';
import { parseProperties } from '../../apps/api/src/config/properties.ts';
import { LocalRuntimeFactory } from '../../apps/api/src/infra/runtime/index.ts';
import { ActiveWorldStateStore, worldIdentity } from '../../apps/api/src/services/active-world-state-store.ts';
import { BackupService } from '../../apps/api/src/services/backup-service.ts';
import { OperationService } from '../../apps/api/src/services/operation-service.ts';
import { JsonOperationStore } from '../../apps/api/src/services/operation-store.ts';
import { TransactionJournalStore } from '../../apps/api/src/services/transaction-journal.ts';
import { allowedWorldImportFile, WORLD_IMPORT_ARCHIVE_LIMITS } from '../../apps/api/src/services/world-import-archive.ts';
import { WorldImportService } from '../../apps/api/src/services/world-import-service.ts';
import { WorldImportUploadService } from '../../apps/api/src/services/world-import-upload-service.ts';
import { inventoryRestoreTree, restoreFilesChecksum, verifyRestoreTree } from '../../apps/api/src/services/restore-files.ts';

if (process.env.MCSM_IMPORT_REAL !== '1') {
  console.error('BLOCKED: requires exact MCSM_IMPORT_REAL=1 opt-in; no instance created or Java launched.');
  process.exit(1);
}
if (process.env.MCSM_IMPORT_RECOVERY_CONSENT !== '1') {
  console.error('BLOCKED: host wrapper -ConfirmIsolatedRecovery is required for the known isolated injected fault; no Java launched.'); process.exit(1);
}
const workspace = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const sourceInstance = 'p33-create-8b216c11-3aab-46e6-88aa-de2b6eb6892e';
const sourceRoot = path.join(workspace, 'runtime', sourceInstance);
const sourceManager = path.join(workspace, '.manager', sourceInstance);
const verifiedSourceRunId = 'reaccept-b7e1e9b3-372a-4be2-af1d-08a11e179e7b';
const runId = process.env.MCSM_IMPORT_RUN_ID;
if (!/^p33-import-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(runId ?? '')) {
  console.error('BLOCKED: requires the host PowerShell wrapper fresh UUID run ID; no Java launched.'); process.exit(1);
}
const serverRoot = path.join(workspace, 'runtime', runId);
const managerRoot = path.join(workspace, '.manager', runId);
const evidenceRoot = path.join(managerRoot, 'evidence');
const id = 'p33-import-acceptance';
const base = `/api/v1/servers/${id}`;
const secret = randomBytes(32).toString('base64url');
const headers = { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:3000', 'x-manager-intent': 'local-ui' };
const clock = { now: () => new Date() };
const report = { runId, startedAt: new Date().toISOString(), result: 'RUNNING', checks: [], launches: [],
  gamePort: null, rconPort: null, sourceInstance, finalStopped: false, import: 'BLOCKED', recovery: 'BLOCKED',
  environment: { os: process.platform, powershell: null, java: null, minecraft: '26.3' },
  hostPreconditions: {}, isolation: { managerRoot, serverRoot, originalUserWorldTouched: false },
  normalImport: { sourceWorldCreated: false, zipCreated: false, uploadVerified: false, protectionBackupCreated: false,
    importCompleted: false, explicitStartCompleted: false, minecraftDone: false, rconListSucceeded: false, importedWorldVerified: false },
  recoveryAcceptance: { faultInjected: false, recoveryRequiredObserved: false, automaticRetryObserved: false,
    explicitRecoveryCompleted: false, recoveredWorldVerified: false },
  finalState: { minecraftStopped: false, javaProcessStopped: false, portsReleased: false, managerStopped: false, noActiveOperation: false },
  evidence: { root: evidenceRoot, managerEvents: path.join(evidenceRoot, 'manager-events.jsonl') }, failures: [],
  limitations: ['Port selection releases reservations before Java binds; every launch rechecks both ports and refuses conflicts.',
    'Controlled config-installed interruption exercises explicit recovery; it does not simulate sudden power loss.',
    'Manager runs in-process with logger disabled; manager-events.jsonl records API/operation evidence, not a separate Manager stdout stream.'] };
let app; let adapters = []; let evidenceCreated = false; let configuredJava; let sourceHashes;
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
function runtimeDiagnostic(text) {
  return /Perflib|HkeyPerformanceDataUtil|Unable to locate English counter names|Win32Exception|ERROR_INVALID_PARAMETER/u.test(text);
}
function assertRuntimeHealthy() {
  if (runtimeFailure && phase !== 'final-cleanup') {
    const error = new Error('Minecraft runtime diagnostic observed; acceptance stopped without Windows repair');
    error.code = 'MINECRAFT_RUNTIME_DIAGNOSTIC'; throw error;
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
    pid: null, stdout: '', stderr: '', captureOverflow: false };
  report.launches.push(launch);
  const capture = { stdout: '', stderr: '' }; captures.set(launch, capture);
  const child = spawn(executable, [...argv], options);
  const owned = { child, pid: child.pid, exited: false, closed: false, diagnosticTail: { stdout: '', stderr: '' },
    identity: Object.freeze({ executable, cwd: options.cwd, argv: Object.freeze([...argv]) }) };
  ownedChildren.set(launch, owned);
  child.once('spawn', () => { launch.pid = child.pid; owned.pid = child.pid; });
  for (const channel of ['stdout', 'stderr']) child[channel].on('data', (chunk) => {
    if (capture[channel].length + chunk.length > 16 * 1024 ** 2) launch.captureOverflow = true;
    capture[channel] += chunk.toString('utf8'); // Retain complete diagnostics even when the acceptance size gate fails.
    const diagnosticText = owned.diagnosticTail[channel] + chunk.toString('utf8');
    if (runtimeDiagnostic(diagnosticText)) runtimeFailure ??= { launch: report.launches.length, channel, excerpt: redact(diagnosticText) };
    owned.diagnosticTail[channel] = diagnosticText.slice(-4096);
  });
  child.once('exit', (code, signal) => { owned.exited = true; launch.exitCode = code; launch.exitSignal = signal; });
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
// Precisely classify the Java 25 JNA/JOML diagnostic blocks; Minecraft WARNs
// and every ERROR remain blockers. No JVM flags, environment edits or suppression.
function classifyDiagnostics(launch, log) {
  const capture = captures.get(launch); launch.stdout = redact(capture.stdout); launch.stderr = redact(capture.stderr);
  const combined = [log, launch.stdout, launch.stderr].join('\n');
  launch.errors = combined.split(/\r?\n/u).filter((line) => /\bERROR\b/u.test(line));
  launch.minecraftWarnings = combined.split(/\r?\n/u).filter((line) => /\[[^\]]*\/WARN\]/u.test(line));
  let remaining = launch.stderr;
  launch.classifiedJavaWarnings = [];
  const blocks = [
    ['java25-jna-native-access', /WARNING: A restricted method in java\.lang\.System has been called\r?\nWARNING: java\.lang\.System::load has been called by com\.sun\.jna\.Native in an unnamed module \(file:[^\r\n]*\/libraries\/net\/java\/dev\/jna\/jna\/5\.17\.0\/jna-5\.17\.0\.jar\)\r?\nWARNING: Use --enable-native-access=ALL-UNNAMED to avoid a warning for callers in this module\r?\nWARNING: Restricted methods will be blocked in a future release unless native access is enabled/gu],
    ['java25-joml-unsafe-deprecation', /WARNING: A terminally deprecated method in sun\.misc\.Unsafe has been called\r?\nWARNING: sun\.misc\.Unsafe::objectFieldOffset has been called by org\.joml\.MemUtil\$MemUtilUnsafe \(file:[^\r\n]*\/libraries\/org\/joml\/joml\/1\.10\.9\/joml-1\.10\.9\.jar\)\r?\nWARNING: Please consider reporting this to the maintainers of class org\.joml\.MemUtil\$MemUtilUnsafe\r?\nWARNING: sun\.misc\.Unsafe::objectFieldOffset will be removed in a future release/gu]
  ];
  for (const [classification, pattern] of blocks) remaining = remaining.replace(pattern, (text) => {
    launch.classifiedJavaWarnings.push({ classification, text }); return '';
  });
  launch.unclassifiedWarnings = [log, launch.stdout, remaining].join('\n').split(/\r?\n/u)
    .filter((line) => /\bWARN(?:ING)?\b/u.test(line));
  launch.fatalRuntimeDiagnostics = combined.split(/\r?\n/u).filter(runtimeDiagnostic);
  return launch.errors.length === 0 && launch.minecraftWarnings.length === 0 && launch.unclassifiedWarnings.length === 0 &&
    launch.fatalRuntimeDiagnostics.length === 0 && !launch.captureOverflow;
}
async function captureLog() {
  const launch = report.launches.at(-1); if (!launch) return null;
  const file = path.join(serverRoot, 'logs', 'latest.log');
  let log = '';
  try { await plain(file); log = redact(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const clean = classifyDiagnostics(launch, log);
  logSnapshots.set(launch, log);
  await writeFile(path.join(evidenceRoot, `launch-${report.launches.length}-latest.log`), log, { mode: 0o600 });
  launch.cleanDiagnostics = clean;
  return { launch, log, clean };
}
async function runningEvidence(label, worldName) {
  await wait(2000); const status = (await request(base)).status;
  assert.equal(status.state, 'running'); assert.equal(status.ownership, 'managed');
  const evidence = await captureLog(); const { launch, log } = evidence;
  assert(launch.pid); process.kill(launch.pid, 0);
  launch.done = launch.stdout.split(/\r?\n/u).find((line) => /Done \(.+\)! For help, type "help"/u.test(line));
  assert(launch.done, 'fresh process Done missing');
  launch.rcon = launch.stdout.split(/\r?\n/u).find((line) => line.includes(`RCON running on 127.0.0.1:${report.rconPort}`));
  assert(launch.rcon, 'fresh RCON readiness missing');
  assert(launch.stdout.includes(`Preparing level "${worldName}"`), 'unexpected configured world');
  assert(!/Encountered an unexpected exception|crash report has been saved|Stopping server/u.test(log), 'fatal startup or premature shutdown');
  assert(await connected(report.gamePort)); assert(await connected(report.rconPort));
  launch.list = await command('list'); assert.match(launch.list, /There are .* players online/u);
  assert((await request(`${base}/worlds`)).items.some((world) => world.name.value === worldName));
  assert(evidence.clean, `${label}: ERROR or unclassified WARN; captured unchanged; no repair permitted`);
  check(label);
}
async function start(worldName, label) {
  await assertFreePorts(); await operation(`${base}/actions/start`, {}); await runningEvidence(label, worldName);
}
async function stop() {
  await operation(`${base}/actions/stop`, {}); await stopped();
  assert(await waitChildClose(ownedChildren.get(report.launches.at(-1)), 10_000), 'child output pipes did not close after normal stop');
  const evidence = await captureLog(); assert(evidence.clean, 'shutdown ERROR/unclassified WARN');
  assert.equal(evidence.launch.exitCode, 0); assert.equal(evidence.launch.exitSignal, null);
  await assertFreePorts();
}
async function manifest(backupId) {
  const file = path.join(managerRoot, 'backups', id, backupId, 'manifest.json'); await plain(file);
  return JSON.parse(await readFile(file, 'utf8'));
}
async function guardEvidence(operationId, oldName, files, binding) {
  const scan = await new TransactionJournalStore(managerRoot).scan(); assert.deepEqual(scan.issues, []);
  const record = scan.records.find((item) => item.intent.operationId === operationId); assert(record?.intent.worldImport);
  const guard = await manifest(record.intent.worldImport.guardBackupId);
  const w = record.intent.worldImport;
  assert.equal(w.previousName, oldName); assert.equal(w.nextName, binding.nextName);
  assert.equal(w.uploadId, binding.uploadId); assert.equal(w.uploadRevision, binding.uploadRevision);
  assert.equal(w.approvedRevision, binding.worldRevision); assert.equal(w.importedChecksum, binding.checksumSha256);
  assert.equal(w.minecraftVersion, '26.3');
  const rootInfo = await lstat(serverRoot, { bigint: true });
  assert.equal(w.rootIdentity, digest(`world-import-root-v1\0${normalize(await realpath(serverRoot))}\0${rootInfo.dev}\0${rootInfo.ino}\0${rootInfo.birthtimeNs}`));
  assert.equal(record.intent.serverId, id); assert.equal(record.intent.resourceId, worldIdentity(id, binding.nextName));
  assert.equal(record.intent.originalState, 'stopped'); assert.equal(record.intent.allowStop, false);
  const checkpoints = ['stop-confirmed', 'guard-verified', 'import-staged', 'config-ready', 'world-install-intent', 'world-installed', 'config-switch-intent', 'config-installed'];
  let previousIndex = -1;
  for (const name of checkpoints) {
    const indices = record.checkpoints.flatMap((checkpoint, index) => checkpoint.name === name ? [index] : []);
    assert.equal(indices.length, 1, `missing/duplicate checkpoint: ${name}`); assert(indices[0] > previousIndex, `checkpoint order violated: ${name}`); previousIndex = indices[0];
  }
  const verified = record.checkpoints.find((checkpoint) => checkpoint.name === 'guard-verified');
  assert.equal(verified.details.resourceId, guard.id); assert.equal(verified.details.checksumSha256, guard.checksumSha256);
  assert.equal(record.checkpoints.find((checkpoint) => checkpoint.name === 'import-staged').details.checksumSha256, binding.checksumSha256);
  assert(guard.pinned && guard.state === 'complete' && guard.scope === 'world-set');
  assert.deepEqual(guard.includedRoots, [oldName]);
  const prefixed = files.map((file) => ({ ...file, path: `${oldName}/${file.path}` }));
  assert.equal(guard.checksumSha256, restoreFilesChecksum(prefixed)); assert.equal(guard.fileCount, files.length);
  assert.equal(guard.sizeBytes, files.reduce((sum, file) => sum + file.sizeBytes, 0));
  await verifyRestoreTree(path.join(managerRoot, 'backups', id, guard.id, 'payload', oldName), files);
  await verifyRestoreTree(path.join(serverRoot, oldName), files);
  const workspaceStat = await lstat(path.join(serverRoot, record.intent.worldImport.workspaceName));
  assert.equal(workspaceStat.dev, (await lstat(serverRoot)).dev, 'transaction workspace must be on the server volume');
  await writeFile(path.join(evidenceRoot, `journal-${operationId}.json`), redact(JSON.stringify(record, null, 2)), { mode: 0o600 });
  await writeFile(path.join(evidenceRoot, `guard-${guard.id}.json`), redact(JSON.stringify(guard, null, 2)), { mode: 0o600 });
  return { record, guard };
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});
function crc32(data) { let crc = 0xffffffff; for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]; return (crc ^ 0xffffffff) >>> 0; }
async function generatedWorldZip(worldRoot, files) {
  // STORE avoids amplification/ratio concerns. Each payload is verified against
  // the stopped generated-world inventory; no files are taken from sourceRoot.
  assert.equal(normalize(worldRoot), normalize(path.join(serverRoot, 'generated-world')));
  assert(files.length > 0 && files.length <= WORLD_IMPORT_ARCHIVE_LIMITS.entries);
  const payloads = [], central = []; let offset = 0;
  for (const file of files) {
    assert(allowedWorldImportFile(file.path));
    const source = path.join(worldRoot, ...file.path.split('/')); await plain(source);
    const data = await readFile(source); assert.equal(data.length, file.sizeBytes); assert.equal(digest(data), file.sha256);
    const name = Buffer.from(file.path); const local = Buffer.alloc(30), directory = Buffer.alloc(46), crc = crc32(data);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    payloads.push(local, name, data); central.push(directory, name); offset += local.length + name.length + data.length;
    assert(offset <= WORLD_IMPORT_ARCHIVE_LIMITS.zipBytes, 'generated ZIP too large');
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  assert(offset + directory.length + end.length <= WORLD_IMPORT_ARCHIVE_LIMITS.zipBytes);
  return Buffer.concat([...payloads, directory, end]);
}
async function upload(zip, expected) {
  const uploaded = await request(`${base}/worlds/import-uploads`, zip, randomUUID(), {
    'content-type': 'application/zip', 'x-upload-filename': 'generated-world.zip' });
  assert.equal(uploaded.state, 'validated'); assert.equal(uploaded.minecraftVersion, '26.3');
  assert.equal(uploaded.checksumSha256, restoreFilesChecksum(expected)); assert.equal(uploaded.fileCount, expected.length);
  const uploadRoot = path.join(managerRoot, 'world-imports', uploaded.id);
  await verifyRestoreTree(path.join(uploadRoot, 'world'), expected);
  const listing = await request(`${base}/worlds/import-uploads`);
  assert.equal(listing.limit, 3); assert(listing.occupiedSlots > 0 && listing.occupiedSlots <= listing.limit);
  const listed = listing.items.find((item) => item.id === uploaded.id); assert.equal(listed?.state, 'validated'); assert.equal(listed.discardAllowed, true);
  const ownerFile = path.join(uploadRoot, 'owner.json'); await plain(ownerFile);
  const owner = JSON.parse(await readFile(ownerFile, 'utf8'));
  const physicalIdentity = async (directory) => {
    await plain(directory, true); const info = await lstat(directory, { bigint: true });
    return digest(`${normalize(await realpath(directory))}\0${info.dev}\0${info.ino}\0${info.birthtimeNs}`);
  };
  assert.equal(owner.id, uploaded.id); assert.equal(owner.serverId, id); assert.equal(normalize(owner.serverRoot), normalize(serverRoot));
  assert.equal(owner.rootIdentity, await physicalIdentity(serverRoot)); assert.equal(owner.directoryIdentity, await physicalIdentity(uploadRoot));
  report.normalImport.uploadVerified = true;
  (report.evidence.uploads ??= []).push({ id: uploaded.id, state: listed.state, occupiedSlots: listing.occupiedSlots, limit: listing.limit,
    rootIdentity: owner.rootIdentity, directoryIdentity: owner.directoryIdentity, checksumSha256: uploaded.checksumSha256, minecraftVersion: uploaded.minecraftVersion });
  return uploaded;
}
async function consumed(uploadId, operationId) {
  const item = (await request(`${base}/worlds/import-uploads`)).items.find((value) => value.id === uploadId);
  assert(item); assert.equal(item.state, 'consumed'); assert.equal(item.discardAllowed, false); assert.equal(item.importOperationId, operationId);
  const marker = JSON.parse(await readFile(path.join(managerRoot, 'world-imports', uploadId, 'consumed.json'), 'utf8'));
  assert.equal(marker.operationId, operationId); assert.equal(marker.serverId, id); assert.equal(marker.uploadId, uploadId);
}
async function treeHashes(root) {
  await plain(root, true); const entries = [];
  const visit = async (directory, prefix = '') => {
    await plain(directory, true);
    for (const name of (await readdir(directory)).sort()) {
      const file = path.join(directory, name), stat = await lstat(file); assert(!stat.isSymbolicLink());
      if (stat.isDirectory()) { entries.push({ path: `${prefix}${name}/`, type: 'directory' }); await visit(file, `${prefix}${name}/`); }
      else { await plain(file); entries.push({ path: prefix + name, sizeBytes: stat.size, sha256: digest(await readFile(file)) }); }
    }
  };
  await visit(root); return entries;
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
          const accepted = (await bounded(() => request(`${base}/actions/stop`, {}), 5000, 'manager cleanup stop request')).operation;
          let outcome;
          const stopDeadline = Date.now() + 20_000;
          do {
            outcome = await bounded(() => request(`/api/v1/operations/${accepted.id}`), 5000, 'manager cleanup stop poll');
            if (['succeeded', 'failed', 'interrupted'].includes(outcome.state)) break;
            await wait(300);
          } while (Date.now() < stopDeadline);
          cleanup.managerStopOperationId = accepted.id; cleanup.managerStop = outcome.state;
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
    managerStopped: managerStatus?.state === 'stopped', noActiveOperation: Boolean(app && managerStatus && !managerStatus.activeOperationId),
    recoveryGateCleared: managerStatus?.recoveryRequired === false };
  report.finalStopped = Object.values(report.finalState).every((value) => value === true);
  if (!report.finalStopped || cleanup.managerStop === 'failed') report.result = 'BLOCKED';
}
try {
  await plain(workspace, true);
  for (const root of [path.join(workspace, 'runtime'), path.join(workspace, '.manager'), sourceRoot, sourceManager]) await plain(root, true);
  await absent(serverRoot);
  // The host wrapper alone creates this fresh private evidence root before its read-only preflight.
  await plain(managerRoot, true); await plain(evidenceRoot, true);
  const hostFile = path.join(managerRoot, 'host-preflight.json'); await plain(hostFile);
  await plain(path.join(managerRoot, 'acceptance-report.json'));
  const host = JSON.parse(await readFile(hostFile, 'utf8'));
  assert.equal(host.runId, runId); assert.equal(normalize(host.isolation.managerRoot), normalize(managerRoot));
  assert.equal(normalize(host.isolation.serverRoot), normalize(serverRoot));
  assert.equal(host.isolation.originalUserWorldTouched, false);
  assert.deepEqual((await readdir(managerRoot)).sort(), ['acceptance-report.json', 'evidence', 'host-preflight.json']);
  assert.deepEqual(await readdir(evidenceRoot), []);
  report.hostPreconditions = host.hostPreconditions; report.environment = { ...host.environment, java: null, minecraft: '26.3' };
  report.startedAt = host.startedAt; evidenceCreated = true;
  assert.equal(host.hostPreconditions.perflibRegistry.result, 'pass'); assert.equal(host.hostPreconditions.getCounter.result, 'pass');
  assert.equal(host.environment.is64BitProcess, true); assert.equal(process.platform, 'win32');
  phase = 'isolation';
  assert.equal(normalize(path.dirname(serverRoot)), normalize(path.join(workspace, 'runtime')));
  assert.equal(normalize(path.dirname(managerRoot)), normalize(path.join(workspace, '.manager')));
  // Validate and print the canonical intended paths before ANY filesystem write.
  report.canonicalPath = serverRoot; report.canonicalManagerPath = managerRoot;
  console.log(`CONFIRMED FRESH TEST CANONICAL PATH: ${serverRoot}`);
  console.log(`CONFIRMED FRESH MANAGER CANONICAL PATH: ${managerRoot}`);
  console.log(`READ-ONLY JAR/EULA SOURCE CANONICAL PATH: ${sourceRoot}`);
  const verifiedSourceRoot = path.join(sourceManager, verifiedSourceRunId); await plain(verifiedSourceRoot, true);
  const configFile = path.join(sourceManager, 'config.json'), priorFile = path.join(verifiedSourceRoot, 'acceptance-report.json');
  await plain(configFile); await plain(priorFile);
  const config = JSON.parse(await readFile(configFile, 'utf8')); assert.equal(config.servers.length, 1);
  const source = config.servers[0]; assert.equal(normalize(source.root), normalize(sourceRoot)); assert.equal(source.jarFile, 'server.jar');
  const prior = JSON.parse(await readFile(priorFile, 'utf8')); assert.equal(prior.runId, verifiedSourceRunId); assert.equal(prior.finalStopped, true);
  assert.equal(normalize(prior.canonicalPath), normalize(sourceRoot));
  assert.equal(prior.result, 'PASS', 'source isolated acceptance was not verified');
  configuredJava = source.javaExecutable; assert(path.isAbsolute(configuredJava)); await plain(configuredJava);
  const jar = path.join(sourceRoot, 'server.jar'), eula = path.join(sourceRoot, 'eula.txt'); await plain(jar); await plain(eula);
  assert.equal(parseProperties(await readFile(eula, 'utf8')).get('eula'), 'true', 'source EULA not already accepted');
  sourceHashes = { jar: digest(await readFile(jar)), eula: digest(await readFile(eula)), config: digest(await readFile(configFile)) };
  report.sourceHashes = sourceHashes;
  await selectPorts(); await assertFreePorts();
  console.log(JSON.stringify({ runId, isolationDirectory: managerRoot, serverRoot, managerRoot, minecraftVersion: '26.3',
    javaExecutable: configuredJava, serverPort: report.gamePort, rconPort: report.rconPort }, null, 2));
  await mkdir(serverRoot); await plain(serverRoot, true);
  await copyFile(jar, path.join(serverRoot, 'server.jar')); await copyFile(eula, path.join(serverRoot, 'eula.txt'));
  assert.equal(digest(await readFile(path.join(serverRoot, 'server.jar'))), sourceHashes.jar);
  assert.equal(digest(await readFile(path.join(serverRoot, 'eula.txt'))), sourceHashes.eula);
  await writeFile(path.join(serverRoot, 'server.properties'), [
    'server-ip=127.0.0.1', `server-port=${report.gamePort}`, 'enable-rcon=true', `rcon.port=${report.rconPort}`, `rcon.password=${secret}`,
    'level-name=generated-world', 'level-seed=314159265', 'view-distance=2', 'simulation-distance=2', 'spawn-protection=0',
    'online-mode=true', 'max-players=2', 'enable-query=false', 'management-server-enabled=false', ''
  ].join('\n'), { mode: 0o600 });
  await writeFile(path.join(managerRoot, 'config.json'), JSON.stringify({ schemaVersion: 1, servers: [{ id,
    name: 'Fresh isolated Import acceptance', root: serverRoot, javaExecutable: configuredJava, jarFile: 'server.jar',
    jvmArgs: ['-Xms512M', '-Xmx1G'], serverArgs: ['nogui'] }] }), { mode: 0o600 });
  await openApp(); const info = await request(base); await stopped(); assert.equal(info.status.recoveryRequired, false);
  assert.equal(info.server.minecraftVersion, '26.3'); assert.match(info.server.java.runtimeVersion, /^25\./u);
  report.minecraftVersion = info.server.minecraftVersion; report.javaVersion = info.server.java.runtimeVersion;
  report.environment.java = { executable: configuredJava, version: report.javaVersion }; report.environment.minecraft = report.minecraftVersion;
  check('fresh canonical local registration; approved ports free; copied accepted EULA/JAR only; Java 25 verified');
  phase = 'source-world'; await start('generated-world', 'Fresh generated world: managed PID, new Done, RCON list, clean diagnostics');
  const dimensions = [
    ['minecraft:overworld', 'minecraft:diamond_block', ['dimensions/minecraft/overworld/region/', 'region/']],
    ['minecraft:the_nether', 'minecraft:gold_block', ['dimensions/minecraft/the_nether/region/', 'DIM-1/region/']],
    ['minecraft:the_end', 'minecraft:emerald_block', ['dimensions/minecraft/the_end/region/', 'DIM1/region/']]
  ];
  for (const [dimension, block] of dimensions) {
    await command(`execute in ${dimension} run forceload add 0 0`); await wait(3500);
    await command(`execute in ${dimension} run setblock 0 80 0 ${block}`);
    assert.match(await command(`execute in ${dimension} if block 0 80 0 ${block}`), /Test passed/u);
  }
  await stop();
  const generatedRoot = path.join(serverRoot, 'generated-world'); const generated = await inventoryRestoreTree(generatedRoot);
  report.normalImport.sourceWorldCreated = true;
  const files = generated.filter((file) => allowedWorldImportFile(file.path));
  report.archiveExcludedFiles = generated.filter((file) => !allowedWorldImportFile(file.path)).map((file) => file.path);
  report.dimensionMarkers = dimensions.map(([dimension, block, prefixes]) => {
    const candidates = files.filter((entry) => prefixes.some((prefix) => entry.path.startsWith(prefix)) && /\/r\.0\.0\.mca$/u.test('/' + entry.path));
    assert.equal(candidates.length, 1, `generated dimension marker region missing or ambiguous: ${dimension}`);
    return { dimension, block, ...candidates[0] };
  });
  assert.equal(new Set(report.dimensionMarkers.map((file) => file.sha256)).size, 3, 'dimension regions must be distinct');
  const zip = await generatedWorldZip(generatedRoot, files); report.archive = { sha256: digest(zip), bytes: zip.length, files, checksumSha256: restoreFilesChecksum(files) };
  await writeFile(path.join(evidenceRoot, 'generated-world.zip'), zip, { mode: 0o600 });
  await writeFile(path.join(evidenceRoot, 'generated-world-inventory.json'), JSON.stringify(generated, null, 2), { mode: 0o600 });
  report.normalImport.zipCreated = true;
  phase = 'distinct-target-world';
  const createPlan = await request(`${base}/worlds/create-plan`, { name: 'target-world', seed: '271828182' });
  assert(createPlan.executionAvailable && !createPlan.requiresStop); assert.equal(createPlan.currentWorldName, 'generated-world');
  await operation(`${base}/worlds`, { name: 'target-world', seed: '271828182', confirmWorldName: createPlan.currentWorldName,
    worldRevision: createPlan.worldRevision, allowStop: false });
  await stopped(); await verifyRestoreTree(generatedRoot, generated);
  await start('target-world', 'Distinct target world: fresh Done/RCON and clean diagnostics');
  const targetBlocks = ['minecraft:iron_block', 'minecraft:copper_block', 'minecraft:lapis_block'];
  for (const [n, [dimension]] of dimensions.entries()) {
    await command(`execute in ${dimension} run forceload add 0 0`); await wait(3500);
    await command(`execute in ${dimension} run setblock 0 80 0 ${targetBlocks[n]}`);
    assert.match(await command(`execute in ${dimension} if block 0 80 0 ${targetBlocks[n]}`), /Test passed/u);
    assert.doesNotMatch(await command(`execute in ${dimension} if block 0 80 0 ${dimensions[n][1]}`), /Test passed/u);
  }
  await stop(); const targetRoot = path.join(serverRoot, 'target-world'); const target = await inventoryRestoreTree(targetRoot);
  assert.notEqual(restoreFilesChecksum(generated), restoreFilesChecksum(target), 'source and target physical states must differ');
  const targetRevision = (await request(`${base}/worlds/create-plan`, { name: 'target-revision-unused', seed: '' })).worldRevision;
  report.normalImport.sourceWorld = { name: 'generated-world', id: worldIdentity(id, 'generated-world'), revision: createPlan.worldRevision,
    seed: '314159265', checksumSha256: restoreFilesChecksum(generated), files: generated, markers: report.dimensionMarkers };
  report.normalImport.targetWorld = { name: 'target-world', id: worldIdentity(id, 'target-world'), revision: targetRevision,
    seed: '271828182', checksumSha256: restoreFilesChecksum(target), files: target,
    markers: dimensions.map(([dimension], n) => ({ dimension, block: targetBlocks[n] })) };
  assert.notEqual(report.normalImport.sourceWorld.id, report.normalImport.targetWorld.id);
  await writeFile(path.join(evidenceRoot, 'target-world-inventory.json'), JSON.stringify(target, null, 2), { mode: 0o600 });
  phase = 'normal-import';
  const propertiesBefore = await readFile(path.join(serverRoot, 'server.properties'), 'utf8');
  const uploaded = await upload(zip, files); await stopped(); await verifyRestoreTree(generatedRoot, generated);
  const importPlan = await request(`${base}/worlds/import-plan`, { uploadId: uploaded.id, name: 'imported-world' });
  assert(importPlan.executionAvailable && !importPlan.requiresStop); assert.equal(importPlan.currentWorldName, 'target-world');
  assert.equal(importPlan.worldRevision, targetRevision);
  const launchesBeforeImport = report.launches.length; const importKey = randomUUID();
  const importBody = { uploadId: uploaded.id, name: 'imported-world', uploadRevision: importPlan.uploadRevision,
    worldRevision: importPlan.worldRevision, confirmWorldName: importPlan.currentWorldName, allowStop: false };
  const imported = await operation(`${base}/worlds/import`, importBody, importKey);
  assert.equal((await request(`${base}/worlds/import`, importBody, importKey)).operation.id, imported.id);
  await stopped(); assert.equal(report.launches.length, launchesBeforeImport);
  await verifyRestoreTree(generatedRoot, generated); await verifyRestoreTree(path.join(serverRoot, 'imported-world'), files);
  const propertiesAfter = parseProperties(await readFile(path.join(serverRoot, 'server.properties'), 'utf8'));
  assert.equal(propertiesAfter.get('level-name'), 'imported-world');
  for (const [key, value] of parseProperties(propertiesBefore)) if (key !== 'level-name') assert.equal(propertiesAfter.get(key), value);
  const importBinding = { nextName: 'imported-world', uploadId: uploaded.id, uploadRevision: importPlan.uploadRevision,
    worldRevision: importPlan.worldRevision, checksumSha256: restoreFilesChecksum(files) };
  const guard = await guardEvidence(imported.id, 'target-world', target, importBinding); assert.equal(guard.record.state, 'committed');
  assert.equal(guard.record.intent.worldImport.importedChecksum, restoreFilesChecksum(files)); await consumed(uploaded.id, imported.id);
  report.import = 'PASS'; report.importOperation = { id: imported.id, guardId: guard.guard.id, uploadId: uploaded.id, transactionId: guard.record.transactionId };
  Object.assign(report.normalImport, { protectionBackupCreated: true, protectionBackupId: guard.guard.id, importCompleted: true });
  check('actual ZIP upload/import commits stopped, verifies three dimension hashes, pins exact guard, preserves old world and consumes upload');
  await closeApp(); await openApp(); assert.equal((await stopped()).recoveryRequired, false); await consumed(uploaded.id, imported.id);
  phase = 'explicit-imported-start'; await start('imported-world', 'Explicit imported-world start after manager restart: fresh Done/RCON and clean diagnostics');
  for (const [dimension, block] of dimensions) assert.match(await command(`execute in ${dimension} if block 0 80 0 ${block}`), /Test passed/u);
  await stop(); await verifyRestoreTree(generatedRoot, generated); await verifyRestoreTree(targetRoot, target);
  Object.assign(report.normalImport, { explicitStartCompleted: true, minecraftDone: true, rconListSucceeded: true, importedWorldVerified: true });
  phase = 'failure-injection';
  const beforeFailure = await inventoryRestoreTree(path.join(serverRoot, 'imported-world'));
  const oldConfig = await readFile(path.join(serverRoot, 'server.properties'), 'utf8');
  const failureUpload = await upload(zip, files);
  const failurePlan = await request(`${base}/worlds/import-plan`, { uploadId: failureUpload.id, name: 'interrupted-world' });
  await closeApp();
  adapters = await createLocalAdapters(managerRoot, runtimeFactory);
  const registry = new AdapterRegistry(adapters), journal = new TransactionJournalStore(managerRoot);
  const ops = new OperationService(new JsonOperationStore(managerRoot), clock, journal);
  const states = new ActiveWorldStateStore(managerRoot, adapters);
  const backups = new BackupService(registry, ops, journal, managerRoot, clock);
  const uploads = new WorldImportUploadService(registry, ops, managerRoot, undefined, journal);
  const injected = new WorldImportService(registry, ops, journal, backups, managerRoot, states, clock, uploads,
    async (point) => { if (point === 'config-installed') throw new Error('authorized isolated after-config-installed interruption'); });
  await injected.reconcileStartup(); await ops.initialize(); assert.equal((await states.initialize()).size, 0);
  const failed = await injected.importWorld(id, { uploadId: failureUpload.id, name: 'interrupted-world', uploadRevision: failurePlan.uploadRevision,
    worldRevision: failurePlan.worldRevision, confirmWorldName: failurePlan.currentWorldName, allowStop: false }, randomUUID());
  currentOperationId = failed.id;
  const failedOutcome = await terminal((operationId) => { lastRecoveryState = ops.getServerState(id).recoveryRequired; return ops.get(operationId); }, failed.id);
  lastRecoveryState = ops.getServerState(id).recoveryRequired;
  assert.equal(failedOutcome.state, 'interrupted'); assert.equal(ops.getServerState(id).recoveryRequired, true);
  assert.equal(report.launches.length, launchesBeforeImport + 1);
  const failureBinding = { nextName: 'interrupted-world', uploadId: failureUpload.id, uploadRevision: failurePlan.uploadRevision,
    worldRevision: failurePlan.worldRevision, checksumSha256: restoreFilesChecksum(files) };
  const failedGuard = await guardEvidence(failed.id, 'imported-world', beforeFailure, failureBinding);
  assert.equal(failedGuard.record.state, 'recovery-required');
  assert(failedGuard.record.checkpoints.some((item) => item.name === 'config-installed'));
  assert.equal(parseProperties(await readFile(path.join(serverRoot, 'server.properties'), 'utf8')).get('level-name'), 'interrupted-world');
  report.faultInjection = { point: 'config-installed', operationId: failed.id, state: failedOutcome.state, transactionId: failedGuard.record.transactionId, guardId: failedGuard.guard.id };
  Object.assign(report.recoveryAcceptance, { faultInjected: true, recoveryRequiredObserved: true });
  for (const adapter of adapters) await adapter.closeObserver(); adapters = [];
  await openApp(); assert.equal((await stopped()).recoveryRequired, true);
  const blockedStart = await app.inject({ method: 'POST', url: `${base}/actions/start`, headers: { ...headers, 'idempotency-key': randomUUID() }, payload: {} });
  assert(!blockedStart.body.includes(secret)); assert.equal(blockedStart.statusCode, 409); assert.equal(blockedStart.json().error.code, 'RECOVERY_REQUIRED');
  managerEvents.push({ at: new Date().toISOString(), phase, method: 'POST', url: `${base}/actions/start`, statusCode: blockedStart.statusCode, error: blockedStart.json().error });
  const blockedImport = await app.inject({ method: 'POST', url: `${base}/worlds/import`, headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: { uploadId: failureUpload.id, name: 'blocked-retry-world', uploadRevision: failurePlan.uploadRevision,
      worldRevision: failurePlan.worldRevision, confirmWorldName: failurePlan.currentWorldName, allowStop: false } });
  assert(!blockedImport.body.includes(secret)); assert.equal(blockedImport.statusCode, 409); assert.equal(blockedImport.json().error.code, 'RECOVERY_REQUIRED');
  managerEvents.push({ at: new Date().toISOString(), phase, method: 'POST', url: `${base}/worlds/import`, statusCode: blockedImport.statusCode, error: blockedImport.json().error });
  await consumed(failureUpload.id, failed.id);
  const preservedRoots = [generatedRoot, targetRoot, path.join(serverRoot, 'imported-world'), path.join(serverRoot, 'interrupted-world'),
    path.join(managerRoot, 'world-imports', uploaded.id), path.join(managerRoot, 'world-imports', failureUpload.id),
    path.join(managerRoot, 'backups', id, guard.guard.id), path.join(managerRoot, 'backups', id, failedGuard.guard.id)];
  const preserved = await Promise.all(preservedRoots.map(treeHashes));
  const failureSnapshot = await treeHashes(serverRoot);
  await closeApp(); await openApp(); assert.equal((await stopped()).recoveryRequired, true);
  assert.deepEqual(await treeHashes(serverRoot), failureSnapshot, 'manager restart replayed destructive physical changes');
  assert.equal((await request(`/api/v1/operations/${failed.id}`)).state, 'interrupted');
  const restartedGuard = await guardEvidence(failed.id, 'imported-world', beforeFailure, failureBinding);
  assert.equal(restartedGuard.record.state, 'recovery-required'); assert.equal(restartedGuard.guard.id, failedGuard.guard.id);
  assert.equal(report.launches.length, launchesBeforeImport + 1);
  report.recoveryAcceptance.managerRestartVerified = true;
  const transactionWorkspace = path.join(serverRoot, failedGuard.record.intent.worldImport.workspaceName);
  const workspaceBeforeRecovery = await treeHashes(transactionWorkspace);
  const recoveryPlan = await request(`${base}/worlds/import-recovery-plan`, { operationId: failed.id });
  assert(recoveryPlan.executionAvailable && recoveryPlan.preservesAllTrees); assert.equal(recoveryPlan.previousWorldName, 'imported-world');
  const recoveryLaunches = report.launches.length;
  phase = 'explicit-recovery';
  const recovered = await operation(`${base}/worlds/import-recovery`, { operationId: failed.id,
    confirmWorldName: recoveryPlan.previousWorldName, recoveryRevision: recoveryPlan.recoveryRevision });
  assert.equal(await readFile(path.join(serverRoot, 'server.properties'), 'utf8'), oldConfig);
  assert.equal((await stopped()).recoveryRequired, false); assert.equal(report.launches.length, recoveryLaunches);
  assert.deepEqual(await Promise.all(preservedRoots.map(treeHashes)), preserved);
  const workspaceAfterRecovery = await treeHashes(transactionWorkspace);
  for (const entry of workspaceBeforeRecovery) assert.deepEqual(workspaceAfterRecovery.find((item) => item.path === entry.path), entry);
  const recoveredRecord = (await journal.scan()).records.find((item) => item.intent.operationId === failed.id);
  assert.equal(recoveredRecord.state, 'rolled-back'); assert(recoveredRecord.checkpoints.some((item) => item.name === 'import-recovery-operation' && item.details?.resourceId === recovered.id));
  await writeFile(path.join(evidenceRoot, `recovered-journal-${failed.id}.json`), redact(JSON.stringify(recoveredRecord, null, 2)), { mode: 0o600 });
  await consumed(failureUpload.id, failed.id); await verifyRestoreTree(path.join(serverRoot, 'imported-world'), beforeFailure);
  report.recoveryAcceptance.explicitRecoveryCompleted = true;
  await closeApp(); await openApp(); assert.equal((await stopped()).recoveryRequired, false);
  phase = 'recovered-world-start'; await start('imported-world', 'Explicit recovered old-world start: fresh Done/RCON and clean diagnostics');
  for (const [dimension, block] of dimensions) assert.match(await command(`execute in ${dimension} if block 0 80 0 ${block}`), /Test passed/u);
  await stop(); await verifyRestoreTree(generatedRoot, generated);
  await verifyRestoreTree(targetRoot, target); report.recoveryAcceptance.recoveredWorldVerified = true;
  report.recovery = 'PASS'; report.recoveryOperation = { id: recovered.id, restoresConfigHash: digest(oldConfig), preservedTreeCount: preservedRoots.length };
  check('injected config switch interruption gates restart; explicit recovery preserves all trees, restores exact old config and clears owned recovery');
  assert.equal(digest(await readFile(jar)), sourceHashes.jar); assert.equal(digest(await readFile(eula)), sourceHashes.eula);
  assert.equal(digest(await readFile(configFile)), sourceHashes.config);
  const crashes = await readdir(path.join(serverRoot, 'crash-reports')).catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
  assert.deepEqual(crashes, []); report.result = 'PASS';
} catch (error) {
  report.result = 'BLOCKED'; report.failure = redact(error.stack ?? error.message); process.exitCode = 1;
  console.error(`BLOCKED: ${redact(error.message)}`);
  const launch = report.launches.at(-1); if (launch) classifyDiagnostics(launch, logSnapshots.get(launch) ?? '');
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
    try { await closeApp(); } catch (error) { report.closeFailure = redact(error.message); report.result = 'BLOCKED'; recordFailure('MANAGER_CLOSE_FAILED', error.message); }
  } else {
    for (const adapter of adapters) await adapter.closeObserver().catch((error) => { report.closeFailure = redact(error.message); report.result = 'BLOCKED'; recordFailure('OBSERVER_CLOSE_FAILED', error.message); });
  }
  for (const [n, launch] of report.launches.entries()) {
    // Recheck every launch after output pipe closure, including warnings that
    // arrived after its startup/stop evidence snapshot. Preserve each saved log.
    launch.cleanDiagnostics = classifyDiagnostics(launch, logSnapshots.get(launch) ?? '');
    if (!ownedChildren.get(launch)?.closed || !launch.cleanDiagnostics) {
      report.result = 'BLOCKED'; recordFailure('FINAL_LAUNCH_DIAGNOSTIC_FAILED', `launch ${n + 1}: closed output pipes and clean diagnostics required`,
        [launch.errors, launch.minecraftWarnings, launch.unclassifiedWarnings, launch.fatalRuntimeDiagnostics].flat().join('\n'), 'final-launch-diagnostics', null);
    }
    if (evidenceCreated) {
      await writeFile(path.join(evidenceRoot, `launch-${n + 1}-stdout.log`), launch.stdout, { mode: 0o600 });
      await writeFile(path.join(evidenceRoot, `launch-${n + 1}-stderr.log`), launch.stderr, { mode: 0o600 });
    }
  }
  if (!report.finalStopped && evidenceCreated) report.result = 'BLOCKED';
  if (sourceHashes) {
    try {
      assert.equal(digest(await readFile(path.join(sourceRoot, 'server.jar'))), sourceHashes.jar);
      assert.equal(digest(await readFile(path.join(sourceRoot, 'eula.txt'))), sourceHashes.eula);
      assert.equal(digest(await readFile(path.join(sourceManager, 'config.json'))), sourceHashes.config);
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
    result: report.result, import: report.import, recovery: report.recovery, finalStopped: report.finalStopped, evidenceRoot: evidenceCreated ? evidenceRoot : null }, null, 2));
}
// Deliberately no automatic cleanup: worlds, private uploads, guards and journals remain.
