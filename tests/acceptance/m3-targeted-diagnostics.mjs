// Bounded normal/fatal diagnostics; warm is a separately admitted single-start extension.
// Never alters the original seven-start run or repeats completed cases automatically.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, lstat, realpath } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { neoForgeSourcePreflight } from './neoforge-source-preflight.mjs';
import { readPrivatePropertiesFile } from '../../apps/api/src/services/properties-private-file.ts';
import { captureNeoForgeLaunchBinding } from '../../apps/api/src/services/neoforge-launch-binding.ts';
import { createLocalAdapters } from '../../apps/api/src/config/bootstrap.ts';
import { LocalRuntimeFactory } from '../../apps/api/src/infra/runtime/local-runtime.ts';
import { verifyWindowsTcpPeer } from '../../apps/api/src/infra/runtime/tcp-peer-owner.ts';
import { readWindowsProcessCounters } from '../../apps/api/src/infra/runtime/process-resources.ts';
import { parseProperties } from '../../apps/api/src/config/properties.ts';

assert.equal(process.platform, 'win32');
const selectedCase = process.env.LT_M3_TARGETED_CASE ?? 'both';
assert(['both', 'fatal', 'warm'].includes(selectedCase), 'unsupported targeted case');
assert.equal(process.env.LT_M3_TARGETED_DIAGNOSTICS, selectedCase === 'warm' ? 'AUTHORIZED_ONE_WARM_WINDOW' : 'AUTHORIZED_TWO_TARGETED_STARTS');
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const runId = `m3-diagnostics-${randomUUID()}`;
const evidence = path.join(workspace, '.manager', runId);
const runtime = path.join(workspace, 'runtime', runId);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const execute = promisify(execFile);
const start = performance.now();
const report = { runId, selectedCase, result: 'BLOCKED', strictGate: 'BLOCKED', cases: [], errors: [], sourceWorldAccessed: false };
const stamp = () => ({ ms: Math.round(performance.now() - start), utc: new Date().toISOString() });
const authorization = JSON.parse(await readFile(path.join(workspace, '.manager/test-instance-authorization.json'), 'utf8'));
const config = JSON.parse(await readFile(path.join(workspace, '.manager/config.json'), 'utf8'));
const source = config.servers.find(row => row.id === authorization.serverId);
assert(source && authorization.serverId === 'vanilla-26-3');
assert.equal((await realpath(source.root)).toLowerCase(), authorization.canonicalRoot.toLowerCase());
const eula = await readPrivatePropertiesFile(path.join(source.root, 'eula.txt'), 65536);
assert.equal(parseProperties(eula.bytes.toString('utf8')).get('eula'), 'true');
const manifest = await neoForgeSourcePreflight();
async function plain(target) {
  for (let cursor = target;; cursor = path.dirname(cursor)) {
    assert(!(await lstat(cursor)).isSymbolicLink());
    assert.equal((await realpath(cursor)).toLowerCase(), cursor.toLowerCase());
    if (cursor === path.dirname(cursor)) break;
  }
}
await plain(manifest.sourceRoot); await plain(path.dirname(evidence)); await plain(path.dirname(runtime));
const bin = path.dirname(source.javaExecutable), tools = {};
for (const name of ['java', 'javac', 'jar', 'jcmd', 'jfr']) {
  const file = path.join(bin, `${name}.exe`); const stat = await lstat(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  assert.equal((await realpath(file)).toLowerCase(), file.toLowerCase());
  tools[name] = { file, sha256: hash(await readFile(file)) };
}
const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const existing = await execute(ps, ['-NoProfile', '-NonInteractive', '-Command',
  "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {$_.Name -match '^javaw?\\.exe$'}).Count"],
{ windowsHide: true, shell: false, timeout: 10000, maxBuffer: 4096 });
assert.equal(existing.stdout.trim(), '0', 'existing Java: no adoption or termination');
await mkdir(evidence); await mkdir(runtime);
report.manifestSha256 = manifest.manifestSha256;
report.tools = Object.fromEntries(Object.entries(tools).map(([name, value]) => [name, value.sha256]));
async function ports() {
  const servers = [], values = [];
  try {
    for (let i = 0; i < 2; i++) {
      const server = net.createServer(); servers.push(server);
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      values.push(server.address().port);
    }
  } finally { for (const server of servers) if (server.listening) await new Promise(resolve => server.close(resolve)); }
  return values;
}
async function portReleased(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port }); let finished = false;
    const finish = value => { if (!finished) { finished = true; socket.destroy(); resolve(value); } };
    socket.once('connect', () => finish(false));
    socket.once('error', error => finish(error.code === 'ECONNREFUSED'));
    socket.setTimeout(1000, () => finish(false));
  });
}
async function buildProbe(root, fatal) {
  const build = path.join(root, 'probe-build'); await mkdir(build);
  const classes = path.join(build, 'classes'); await mkdir(classes);
  const modId = 'lt_m3_diagnostic';
  const statements = fatal
    ? 'throw new RuntimeException("LT_M3_FATAL_SENTINEL", new IllegalStateException("LT_M3_FATAL_CAUSE"));'
    : 'var log=org.apache.logging.log4j.LogManager.getLogger("LT_M3_DIAGNOSTIC"); log.info("LT_M3_INFO_SENTINEL"); log.warn("LT_M3_WARN_SENTINEL"); log.error("LT_M3_ERROR_SENTINEL", new RuntimeException("LT_M3_ERROR_CHAIN", new IllegalStateException("LT_M3_ERROR_CAUSE"))); log.debug("LT_M3_DEBUG_SENTINEL");';
  const java = `package ltdiagnostic; @net.neoforged.fml.common.Mod("${modId}") public final class DiagnosticMod { public DiagnosticMod() { ${statements} } }`;
  const javaFile = path.join(build, 'DiagnosticMod.java'); await writeFile(javaFile, java, { flag: 'wx' });
  const quote = value => { assert(!/[\r\n"\0]/u.test(value)); return `"${value.replaceAll('\\', '/')}"`; };
  const cp = manifest.files.filter(item => item.relative.endsWith('.jar')).map(item => path.join(manifest.sourceRoot, item.relative));
  const argFile = path.join(build, 'javac.args');
  await writeFile(argFile, ['-proc:none', '--release', '25', '-encoding', 'UTF-8', '-classpath', quote(cp.join(path.delimiter)), '-d', quote(classes), quote(javaFile)].join('\n'), { flag: 'wx' });
  await execute(tools.javac.file, [`@${argFile}`], { cwd: build, windowsHide: true, shell: false, timeout: 30000, maxBuffer: 65536 });
  const resources = path.join(build, 'resources'); await mkdir(path.join(resources, 'META-INF'), { recursive: true });
  await writeFile(path.join(resources, 'META-INF/neoforge.mods.toml'), `modLoader="javafml"\nloaderVersion="[1,)"\nlicense="MIT"\n[[mods]]\nmodId="${modId}"\nversion="1.0.0"\ndisplayName="LT bounded diagnostic fixture"\n`, { flag: 'wx' });
  const jar = path.join(root, 'mods/lt-m3-diagnostic.jar');
  await execute(tools.jar.file, ['--create', '--file', jar, '-C', classes, '.', '-C', resources, '.'], { cwd: build, windowsHide: true, shell: false, timeout: 30000, maxBuffer: 65536 });
  return { sourceSha256: hash(java), jarSha256: hash(await readFile(jar)) };
}
// Only the exact normal fixture created in this investigation is eligible.
// Hash-verified backup is taken while no Java exists and outside any JFR window.
async function backupOwnedWorld(sourceWorld, destination) {
  await plain(sourceWorld); let files = 0, total = 0; const ledger = [];
  async function copy(directory, target, relative) {
    assert(ledger.length < 2048); await plain(directory); await mkdir(target);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      assert(!entry.isSymbolicLink()); const from = path.join(directory, entry.name), to = path.join(target, entry.name);
      const key = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { ledger.push({ directory: key }); await copy(from, to, key); }
      else {
        assert(entry.isFile() && ++files <= 2000);
        const file = await readPrivatePropertiesFile(from, 64 * 1024 ** 2); total += file.bytes.length; assert(total <= 128 * 1024 ** 2);
        await writeFile(to, file.bytes, { flag: 'wx' }); assert.equal(hash(await readFile(to)), file.checksum);
        const after = await readPrivatePropertiesFile(from, 64 * 1024 ** 2);
        assert.equal(after.identity, file.identity); assert.equal(after.checksum, file.checksum);
        ledger.push({ file: key, identity: file.identity, sha256: file.checksum });
      }
    }
  }
  await copy(sourceWorld, destination, ''); return { files, totalBytes: total, ledger };
}
async function runCase(fatal) {
  const warm = selectedCase === 'warm';
  const id = fatal ? 'fatal' : warm ? 'warm' : 'steady', caseId = `${id}-${randomUUID()}`;
  const priorRoot = path.join(workspace, 'runtime/m3-diagnostics-f7db7f09-4386-4143-b07b-01ebe6aeae5d/steady-c6ac0879-28da-43e8-983b-d1edde66fde1');
  const root = warm ? priorRoot : path.join(runtime, caseId), manager = path.join(evidence, caseId);
  if (!warm) await mkdir(root); await mkdir(manager); await plain(root);
  let previous, worldBackup;
  if (warm) {
    previous = JSON.parse(await readFile(path.join(workspace, '.manager/m3-diagnostics-f7db7f09-4386-4143-b07b-01ebe6aeae5d/report.json'), 'utf8'));
    assert.equal(previous.cases.length, 1); assert.equal(previous.cases[0].root, root);
    assert(previous.finalStopped && previous.helpersClosed && previous.portsReleased && previous.sourceInputsUnchanged);
    assert.equal(previous.cases[0].errorCode, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
    for (const entry of manifest.files) {
      const file = await readPrivatePropertiesFile(path.join(root, entry.target), 64 * 1024 ** 2);
      assert.equal(file.checksum, entry.sha256, 'warm closure drift');
    }
    await plain(path.join(root, 'mods'));
    assert.deepEqual(await readdir(path.join(root, 'mods')), ['lt-m3-diagnostic.jar']);
    assert.equal((await readPrivatePropertiesFile(path.join(root, 'mods/lt-m3-diagnostic.jar'), 64 * 1024 ** 2)).checksum, previous.cases[0].probe.jarSha256);
    assert.equal((await readPrivatePropertiesFile(path.join(root, 'eula.txt'), 65536)).checksum, eula.checksum);
    for (const name of ['latest.log', 'debug.log']) {
      const bytes = await readFile(path.join(root, 'logs', name)); await writeFile(path.join(manager, `prior-${name}`), bytes, { flag: 'wx' });
    }
    worldBackup = await backupOwnedWorld(path.join(root, 'world'), path.join(manager, 'protective-world-backup'));
    await writeFile(path.join(manager, 'world-backup-ledger.json'), JSON.stringify(worldBackup, null, 2), { flag: 'wx' });
  }
  for (const entry of warm ? [] : manifest.files) {
    assert(entry.target.split('/').every(part => part && part !== '.' && part !== '..'));
    const file = await readPrivatePropertiesFile(path.join(manifest.sourceRoot, entry.relative), 64 * 1024 ** 2);
    assert.equal(file.identity, entry.identity); assert.equal(file.checksum, entry.sha256);
    const destination = path.join(root, entry.target); await mkdir(path.dirname(destination), { recursive: true });
    await plain(path.dirname(destination)); await writeFile(destination, file.bytes, { flag: 'wx' });
    assert.equal(hash(await readFile(destination)), entry.sha256);
  }
  if (!warm) { await writeFile(path.join(root, 'eula.txt'), eula.bytes, { flag: 'wx' }); await mkdir(path.join(root, 'mods')); }
  const saved = warm ? parseProperties((await readPrivatePropertiesFile(path.join(root, 'server.properties'), 65536)).bytes.toString('utf8')) : null;
  const probe = warm ? previous.cases[0].probe : await buildProbe(root, fatal);
  const endpoints = warm ? [Number(saved.get('server-port')), Number(saved.get('rcon.port'))] : await ports();
  const secret = warm ? saved.get('rcon.password') : randomBytes(24).toString('hex');
  assert(secret && endpoints.every(port => Number.isSafeInteger(port) && port > 0 && port < 65536));
  if (warm) { assert.deepEqual(endpoints, previous.cases[0].endpoints); assert((await Promise.all(endpoints.map(portReleased))).every(Boolean)); }
  const safe = text => String(text).replaceAll(secret, '[REDACTED]');
  const fields = { 'server-ip': '127.0.0.1', 'server-port': endpoints[0], 'enable-rcon': 'true', 'rcon.port': endpoints[1], 'rcon.password': secret,
    'level-name': 'world', 'level-seed': '111111', 'view-distance': 2, 'simulation-distance': 2, 'online-mode': 'true', 'enable-query': 'false', 'management-server-enabled': 'false' };
  if (warm) {
    assert(/^[a-f0-9]{48}$/u.test(secret), 'unexpected test-local RCON secret format');
    for (const [key, value] of Object.entries(fields)) assert.equal(saved.get(key), String(value), `warm properties drift:${key}`);
  }
  if (!warm) await writeFile(path.join(root, 'server.properties'), Object.entries(fields).map(([key, value]) => `${key}=${value}`).join('\n'), { flag: 'wx' });
  const registration = { ...source, id, name: `M3 ${id} diagnostics`, root, jarFile: 'run.bat', jvmArgs: ['-Xms256M', '-Xmx1G'] };
  await writeFile(path.join(manager, 'config.json'), JSON.stringify({ schemaVersion: 1, servers: [registration] }), { flag: 'wx' });
  const binding = await captureNeoForgeLaunchBinding(root, path.join(root, 'run.bat'));
  const row = { id, caseId, root, manager, endpoints, probe, worldBackup: worldBackup ? { files: worldBackup.files, totalBytes: worldBackup.totalBytes } : null, started: stamp(), events: [], samples: [], phases: [], result: 'BLOCKED' };
  const recordingFile = path.join(manager, 'targeted.jfr');
  report.cases.push(row);
  let child, adapter, closed = false, stdout = '', stderr = '', recording, recordingError, owner, stopRequested = false;
  const owned = async () => {
    const target = child, pid = target?.pid;
    assert(pid && !closed && target.exitCode === null && target.signalCode === null);
    const counters = await readWindowsProcessCounters(pid);
    assert(child === target && child.pid === pid && !closed && target.exitCode === null && target.signalCode === null);
    assert.equal(counters.pid, pid);
    assert.equal(counters.executable.toLowerCase(), source.javaExecutable.toLowerCase());
    if (owner) assert.equal(counters.startTicks, owner.startTicks); else {
      const epoch = Number((BigInt(counters.startTicks) - 621355968000000000n) / 10000n);
      assert(epoch >= row.spawnWall - 1000 && epoch <= Date.now()); owner = counters;
    }
    return counters;
  };
  const startRecording = async () => {
    await owned(); row.phases.push({ name: 'jfr-attach-begin', ...stamp() });
    const result = await execute(tools.jcmd.file, [String(child.pid), 'JFR.start', `name=${runId}`, 'settings=default', 'duration=60s', 'maxsize=64m', `filename=${recordingFile}`],
      { cwd: root, windowsHide: true, shell: false, timeout: 15000, maxBuffer: 65536 });
    row.jfrStartOutput = safe(result.stdout); await owned(); row.phases.push({ name: 'jfr-attach-end', ...stamp() });
  };
  const factory = new LocalRuntimeFactory({ tcpPeerVerifier: verifyWindowsTcpPeer,
    spawnProcess(executable, argv, options) {
      assert.equal(executable, source.javaExecutable); assert.equal(options.cwd, root); assert.equal(options.shell, false);
      assert.deepEqual([...argv], [...registration.jvmArgs, ...binding.argv, ...registration.serverArgs]);
      row.spawnWall = Date.now(); row.spawn = stamp();
      child = spawn(executable, [...argv], options); row.pid = child.pid;
      for (const stream of ['stdout', 'stderr']) child[stream].on('data', bytes => {
        const text = safe(bytes.toString('utf8'));
        if (stdout.length + stderr.length + text.length > 8 * 1024 ** 2) { row.captureOverflow = true; return; }
        if (stream === 'stdout') stdout += text; else stderr += text;
      });
      child.once('exit', (code, signal) => { row.exit = { ...stamp(), code, signal, stopRequested }; });
      child.once('close', () => { closed = true; row.close = stamp(); });
      if (warm) recording = (async () => { await sleep(300); await startRecording(); })().catch(error => { recordingError = error; });
      return child;
    }
  });
  const context = () => ({ operationId: randomUUID(), signal: new AbortController().signal,
    onStep: async step => { row.phases.push({ name: step, ...stamp() }); return {}; } });
  try {
    [adapter] = await createLocalAdapters(manager, factory);
    const info = await adapter.getServerInfo(); assert.equal(info.type, 'neoforge'); assert.match(info.java.runtimeVersion, /^25\./u);
    adapter.subscribe(event => { if (row.events.length < 6000) row.events.push({ ...stamp(), event: JSON.parse(safe(JSON.stringify(event))) }); else row.captureOverflow = true; });
    await adapter.revalidateBeforeStart();
    let startError;
    try { await adapter.start(context()); } catch (error) { startError = error; row.startErrorCode = error.code ?? 'NO_EXPLICIT_ERROR_CODE'; }
    if (fatal) {
      assert(startError, 'fatal probe must fail start');
      const deadline = performance.now() + 15000; while (!closed && performance.now() < deadline) await sleep(100);
      assert(closed && row.exit.code !== 0 && row.exit.signal === null, 'fatal must exit autonomously with nonzero code');
      assert(!/Done \([^)]+\)!/u.test(stdout), 'fatal must not reach Done');
      const status = await adapter.getStatus(); row.status = status; assert.notEqual(status.state, 'running');
      assert(stdout.includes('LT_M3_FATAL_SENTINEL') && stdout.includes('LT_M3_FATAL_CAUSE'));
      const crashFiles = (await readdir(path.join(root, 'crash-reports'))).filter(name => /^crash-.*-fml\.txt$/u.test(name));
      assert(crashFiles.length > 0, 'FML constructor failure must retain mod-loading crash report');
      row.crashFiles = crashFiles;
      const crashText = (await Promise.all(crashFiles.map(name => readFile(path.join(root, 'crash-reports', name), 'utf8')))).join('\n');
      assert(crashText.includes('LT_M3_FATAL_SENTINEL') && crashText.includes('LT_M3_FATAL_CAUSE'));
    } else {
      if (startError) throw startError;
      if (!recording) recording = startRecording().catch(error => { recordingError = error; });
      await recording; if (recordingError) throw recordingError;
      assert.equal((await adapter.getStatus()).ownership, 'managed'); await owned();
      const command = async value => {
        const began = stamp(); const result = await adapter.command(value); assert.equal(result.transport, 'rcon');
        row.phases.push({ name: `rcon:${value}`, begin: began, end: stamp(), output: safe(result.output) }); return result.output;
      };
      assert.match(await command('list'), /players online/u); assert.match(await command('seed'), /111111/u);
      row.phases.push({ name: 'initial-idle', ...stamp() });
      const sampleEpoch = performance.now(), sampleDeadline = sampleEpoch + 60000;
      row.samplingBudgetMs = 60000;
      for (let i = 0; i < 12; i++) {
        await sleep(Math.max(0, sampleEpoch + i * 5000 - performance.now()));
        if (performance.now() >= sampleDeadline) { row.samplingDeadlineReached = true; break; }
        if (i === 6) { row.phases.push({ name: 'explicit-save-begin', ...stamp() }); await command('save-all flush'); row.phases.push({ name: 'explicit-save-end', ...stamp() }); }
        const sampleBegin = stamp(); const counters = await owned();
        const tick = await command('tick query'); row.samples.push({ index: i, begin: sampleBegin, end: stamp(), counters, tick });
      }
      await sleep(Math.max(0, sampleDeadline - performance.now()));
      row.phases.push({ name: 'stop-begin', ...stamp() }); stopRequested = true; await adapter.stop(context());
      const deadline = performance.now() + 5000; while (!closed && performance.now() < deadline) await sleep(50);
      assert(closed && row.exit.code === 0 && row.exit.signal === null);
      const stat = await lstat(recordingFile);
      assert(stat.isFile() && stat.size > 0 && stat.size <= 64 * 1024 ** 2); row.jfrBytes = stat.size;
      const summary = await execute(tools.jfr.file, ['summary', recordingFile], { windowsHide: true, shell: false, timeout: 15000, maxBuffer: 65536 });
      await writeFile(path.join(manager, 'jfr-summary.txt'), safe(summary.stdout), { flag: 'wx' });
      const printed = await execute(tools.jfr.file, ['print', '--json', '--events', 'minecraft.ServerTickTime,jdk.CPULoad,jdk.GarbageCollection,jdk.GCPhasePause', recordingFile],
        { windowsHide: true, shell: false, timeout: 15000, maxBuffer: 16 * 1024 ** 2 });
      await writeFile(path.join(manager, 'jfr-events.json'), safe(printed.stdout), { flag: 'wx' });
      assert(!(await readdir(root)).includes('crash-reports') || (await readdir(path.join(root, 'crash-reports'))).length === 0);
    }
    await sleep(500);
    const latest = await readFile(path.join(root, 'logs/latest.log'), 'utf8'), debug = await readFile(path.join(root, 'logs/debug.log'), 'utf8');
    const markers = fatal ? ['LT_M3_FATAL_SENTINEL', 'LT_M3_FATAL_CAUSE'] : ['LT_M3_INFO_SENTINEL', 'LT_M3_WARN_SENTINEL', 'LT_M3_ERROR_SENTINEL', 'LT_M3_ERROR_CHAIN', 'LT_M3_ERROR_CAUSE'];
    for (const marker of markers) { assert(latest.includes(marker), `latest lacks ${marker}`); assert(debug.includes(marker), `debug lacks ${marker}`);
      assert(row.events.some(item => item.event.type === 'log' && item.event.entry.text.includes(marker)), `LT stream lacks ${marker}`); }
    if (!fatal) assert(debug.includes('LT_M3_DEBUG_SENTINEL'));
    assert(!row.captureOverflow); row.result = 'PASS';
  } catch (error) { row.error = safe(error.message); row.errorCode = error.code ?? 'NO_EXPLICIT_ERROR_CODE'; }
  finally {
    await recording;
    if (child && !closed && child.exitCode === null) {
      row.diagnosticCleanupStop = true; stopRequested = true;
      // Only this concrete child is eligible. No PID lookup/kill or unknown directory deletion.
      child.stdin.on('error', () => {}); child.stdin.write('stop\n', () => {});
      const deadline = performance.now() + 15000; while (!closed && performance.now() < deadline) await sleep(100);
    }
    try { if (adapter) await adapter.closeObserver(); row.observerClosed = true; }
    catch { row.observerClosed = false; row.cleanup = 'CLEANUP_BLOCKED'; row.result = 'BLOCKED'; }
    row.closed = !child || closed;
    row.portsReleased = (await Promise.all(endpoints.map(portReleased))).every(Boolean);
    if (!row.closed || !row.portsReleased) { row.cleanup = 'CLEANUP_BLOCKED'; row.result = 'BLOCKED'; }
    await writeFile(path.join(manager, 'stdout.log'), stdout, { flag: 'wx' }); await writeFile(path.join(manager, 'stderr.log'), stderr, { flag: 'wx' });
    await writeFile(path.join(manager, 'case-report.json'), JSON.stringify(row, null, 2), { flag: 'wx' });
  }
  return row;
}
try {
  if (selectedCase === 'both') { const healthy = await runCase(false); assert.equal(healthy.result, 'PASS', healthy.error); }
  if (selectedCase === 'warm') { const warm = await runCase(false); assert.equal(warm.result, 'PASS', warm.error); }
  else { const fatal = await runCase(true); assert.equal(fatal.result, 'PASS', fatal.error); }
  report.result = 'PASS';
} catch (error) { report.errors.push({ code: error.code ?? 'NO_EXPLICIT_ERROR_CODE', message: String(error.message) }); }
finally {
  try {
    assert.deepEqual(await neoForgeSourcePreflight(), manifest);
    const afterEula = await readPrivatePropertiesFile(path.join(source.root, 'eula.txt'), 65536);
    assert.equal(afterEula.identity, eula.identity); assert.equal(afterEula.checksum, eula.checksum);
    report.sourceInputsUnchanged = true;
  } catch { report.sourceInputsUnchanged = false; report.result = 'BLOCKED'; report.errors.push({ code: 'SOURCE_RECHECK_FAILED' }); }
  report.finalStopped = report.cases.every(row => row.closed); report.durationMs = Math.round(performance.now() - start);
  report.portsReleased = report.cases.every(row => row.portsReleased);
  report.helpersClosed = report.cases.every(row => row.observerClosed);
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(`${report.result}: ${runId}; cases=${report.cases.map(row => `${row.id}:${row.result}`).join(',')}; strictGate=BLOCKED; stopped=${report.finalStopped}`);
  process.exitCode = report.result === 'PASS' ? 0 : 1;
}
