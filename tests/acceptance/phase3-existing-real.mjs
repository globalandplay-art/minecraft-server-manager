// Opt-in, existing isolated instance only. No original-world access or system repair.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../apps/api/src/app.ts';
import { createLocalAdapters } from '../../apps/api/src/config/bootstrap.ts';
import { parseProperties } from '../../apps/api/src/config/properties.ts';
import { LocalRuntimeFactory } from '../../apps/api/src/infra/runtime/index.ts';
import { JsonOperationStore } from '../../apps/api/src/services/operation-store.ts';
import { TransactionJournalStore } from '../../apps/api/src/services/transaction-journal.ts';
import { ActiveWorldStateStore } from '../../apps/api/src/services/active-world-state-store.ts';
import { AdapterRegistry } from '../../apps/api/src/adapters/registry.ts';
import { OperationService } from '../../apps/api/src/services/operation-service.ts';
import { BackupService } from '../../apps/api/src/services/backup-service.ts';
import { RestoreService } from '../../apps/api/src/services/restore-service.ts';
import { inventoryRestoreTree, verifyRestoreTree } from '../../apps/api/src/services/restore-files.ts';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const instance = 'p33-create-8b216c11-3aab-46e6-88aa-de2b6eb6892e';
const serverRoot = path.join(workspace, 'runtime', instance);
const managerRoot = path.join(workspace, '.manager', instance);
const runId = `reaccept-${randomUUID()}`;
const evidenceRoot = path.join(managerRoot, runId);
const report = { runId, startedAt: new Date().toISOString(), canonicalPath: null, checks: [], launches: [],
  p32: 'BLOCKED', p33b: 'BLOCKED', result: 'RUNNING', finalStopped: false, coreSemanticsChanged: false };
const headers = { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:3000', 'x-manager-intent': 'local-ui' };
const clock = { now: () => new Date() };
let app; let adapters = []; let id; let base; let secret; let props;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digest = (text) => createHash('sha256').update(text).digest('hex');
const redact = (text) => String(text).replaceAll(secret || '\0', '[redacted]');
const check = (name) => { report.checks.push(name); console.log(`PASS: ${name}`); };
function connected(port) { return new Promise((resolve) => { const s = net.connect({ host: '127.0.0.1', port });
  s.setTimeout(1500); s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => { s.destroy(); resolve(false); }); s.once('timeout', () => { s.destroy(); resolve(false); }); }); }
const runtimeFactory = new LocalRuntimeFactory({ spawnProcess(executable, argv, options) {
  assert.equal(path.resolve(options.cwd), serverRoot, 'spawn cwd outside confirmed test root');
  const launch = { executable, argv: [...argv], cwd: options.cwd, shell: options.shell, windowsHide: options.windowsHide,
    environment: { inherited: options.env === undefined, variableHashes: Object.fromEntries(Object.entries(options.env ?? process.env)
      .map(([k, v]) => [k, digest(String(v))])), selected: Object.fromEntries(['JAVA_HOME', 'JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS', 'CLASSPATH']
      .map((k) => [k, (options.env ?? process.env)[k] === undefined ? null : redact((options.env ?? process.env)[k])])) }, pid: null, stdout: '', stderr: '' };
  report.launches.push(launch);
  const child = spawn(executable, [...argv], options);
  child.once('spawn', () => { launch.pid = child.pid; });
  child.stdout.on('data', (chunk) => { launch.stdout += redact(chunk.toString('utf8')); });
  child.stderr.on('data', (chunk) => { launch.stderr += redact(chunk.toString('utf8')); });
  child.once('exit', (code, signal) => { launch.exitCode = code; launch.exitSignal = signal; });
  return child;
} });
async function request(url, payload, key = randomUUID()) {
  const res = await app.inject({ method: payload === undefined ? 'GET' : 'POST', url,
    headers: { ...headers, 'idempotency-key': key }, ...(payload === undefined ? {} : { payload }) });
  assert(!res.body.includes(secret), 'secret leaked through API');
  assert(res.statusCode < 300, `HTTP ${res.statusCode} ${res.json().error?.code}`); return res.json().data;
}
async function operation(url, payload, key = randomUUID()) {
  const accepted = (await request(url, payload, key)).operation;
  for (let n = 0; n < 600; n++) {
    const op = await request(`/api/v1/operations/${accepted.id}`);
    if (['succeeded', 'failed', 'interrupted'].includes(op.state)) { assert.equal(op.state, 'succeeded', `${op.kind}: ${op.error?.code ?? op.state}`); return op; }
    await wait(300);
  }
  throw new Error('operation timeout');
}
async function openApp() {
  adapters = await createLocalAdapters(managerRoot, runtimeFactory);
  assert(adapters.every((a) => a.plan.rootPath === serverRoot && a.serverId === id));
  const journal = new TransactionJournalStore(managerRoot);
  app = buildApp({ adapters, mode: 'local', managerRoot, transactionJournal: journal, transactionRecovery: journal,
    operationStore: new JsonOperationStore(managerRoot), activeWorldState: new ActiveWorldStateStore(managerRoot, adapters) });
  await app.ready();
}
async function command(text) { await wait(3500); const result = await request(`${base}/commands`, { command: text });
  assert.equal(result.transport, 'rcon'); return result.output; }
async function runningEvidence(label) {
  await wait(2000); const status = (await request(base)).status;
  assert(status.state === 'running' && status.ownership === 'managed');
  const launch = report.launches.at(-1); assert(launch?.pid); process.kill(launch.pid, 0);
  const log = redact(await readFile(path.join(serverRoot, 'logs', 'latest.log'), 'utf8'));
  launch.done = log.split('\n').find((line) => /Done \(.+\)! For help, type "help"/u.test(line)); assert(launch.done, 'new Done missing');
  launch.rcon = log.split('\n').find((line) => /RCON running on 127\.0\.0\.1:/u.test(line)); assert(launch.rcon, 'RCON readiness missing');
  launch.errors = log.split('\n').filter((line) => /\bERROR\b/u.test(line));
  launch.warnings = log.split('\n').filter((line) => /\bWARN(?:ING)?\b/u.test(line));
  await writeFile(path.join(evidenceRoot, `launch-${report.launches.length}-latest.log`), log);
  assert(!/Encountered an unexpected exception|crash report has been saved|Stopping server/u.test(log), 'fatal shutdown');
  assert(await connected(report.gamePort)); assert(await connected(report.rconPort));
  launch.list = await command('list'); assert.match(launch.list, /There are .* players online/u);
  assert((await request(`${base}/worlds`)).items.length > 0, 'world not loaded');
  assert.equal(launch.errors.length, 0, `${label}: actual ERROR remains; see captured log`);
  assert.equal(launch.warnings.length, 0, `${label}: warning needs explicit investigation; see captured log`);
  check(label);
}
async function backupManifest(backupId) { return JSON.parse(await readFile(path.join(managerRoot, 'backups', id, backupId, 'manifest.json'), 'utf8')); }
async function verifyManifest(manifest) {
  const rootName = manifest.includedRoots[0];
  await verifyRestoreTree(path.join(serverRoot, rootName), manifest.files.map((f) => ({ ...f, path: f.path.slice(rootName.length + 1) })));
}
try {
  const canonical = await realpath(serverRoot); const rootStat = await lstat(serverRoot);
  assert(rootStat.isDirectory() && !rootStat.isSymbolicLink());
  assert.equal(canonical.toLowerCase(), path.resolve(serverRoot).toLowerCase());
  assert.equal(path.dirname(canonical).toLowerCase(), path.join(workspace, 'runtime').toLowerCase());
  assert.equal((await realpath(managerRoot)).toLowerCase(), path.resolve(managerRoot).toLowerCase());
  const config = JSON.parse(await readFile(path.join(managerRoot, 'config.json'), 'utf8'));
  assert.equal(config.servers.length, 1); assert.equal(config.servers[0].root, serverRoot);
  const prior = JSON.parse(await readFile(path.join(managerRoot, 'acceptance-report.json'), 'utf8'));
  assert.equal(prior.runId, instance); assert.equal(prior.finalStopped, true);
  report.canonicalPath = canonical; id = config.servers[0].id; base = `/api/v1/servers/${id}`;
  console.log(`CONFIRMED TEST CANONICAL PATH: ${canonical}`);
  props = parseProperties(await readFile(path.join(serverRoot, 'server.properties'), 'utf8')); secret = props.get('rcon.password'); assert(secret);
  report.gamePort = Number(props.get('server-port')); report.rconPort = Number(props.get('rcon.port'));
  assert.equal(props.get('server-ip'), '127.0.0.1'); assert(!await connected(report.gamePort)); assert(!await connected(report.rconPort));
  // No filesystem writes precede canonical checks, config ownership and stopped-port confirmation.
  await mkdir(evidenceRoot); await openApp();
  const initial = await request(base); assert(initial.status.state === 'stopped' && initial.status.ownership === 'none' && !initial.status.recoveryRequired);
  report.minecraftVersion = initial.server.minecraftVersion; report.javaVersion = initial.server.java.runtimeVersion;
  assert.equal(report.minecraftVersion, '26.3'); assert.match(report.javaVersion, /^25\./);
  report.crashReportsBefore = await readdir(path.join(serverRoot, 'crash-reports')).catch((e) => { if(e.code === 'ENOENT')return []; throw e; });
  await operation(`${base}/actions/start`, {}); await runningEvidence('Manager startup: PID survives, Done, RCON list, world loaded, no ERROR/WARN');
  report.managerStartup = 'PASS';
  for (const dim of ['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end']) {
    await command(`execute in ${dim} run forceload add 0 0`); await command(`execute in ${dim} run setblock 0 80 0 minecraft:diamond_block`);
  }
  await operation(`${base}/actions/stop`, {});
  const saved = await operation(`${base}/backups`, { scope: 'world-set', allowStop: false, label: runId });
  const backup = (await request(`${base}/backups`)).items.find((b) => b.label === runId); assert(backup);
  const source = await backupManifest(backup.id); report.sourceBackup = { id: backup.id, checksumSha256: source.checksumSha256, fileCount: source.fileCount, operationId: saved.id };
  await writeFile(path.join(evidenceRoot, 'source-manifest.json'), JSON.stringify(source, null, 2));
  await operation(`${base}/actions/start`, {}); await command('setblock 0 80 0 minecraft:gold_block'); await operation(`${base}/actions/stop`, {});
  let plan = await request(`${base}/backups/${backup.id}/restore`);
  const restored = await operation(`${base}/backups/${backup.id}/restore`, { restoreScope: 'world-set', confirmWorldName: plan.worldName,
    worldRevision: plan.worldRevision, allowStop: true, startAfterRestore: true });
  await runningEvidence('Restore explicitly starts with clean Done/RCON/world readiness');
  for (const dim of ['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end']) assert.match(await command(`execute in ${dim} if block 0 80 0 minecraft:diamond_block`), /Test passed/u);
  const guard = await backupManifest(restored.result.resourceId); assert(guard.pinned); report.preRestoreGuard = { id: guard.id, checksumSha256: guard.checksumSha256, pinned: guard.pinned };
  const scan = await new TransactionJournalStore(managerRoot).scan(); assert(scan.records.some((r) => r.intent.operationId === restored.id && r.state === 'committed'));
  await operation(`${base}/actions/stop`, {}); check('Restore restores three dimension markers and commits with pinned pre-restore guard');
  // Return to modified gold state via explicit rollback before controlled failure injection.
  let rb = await request(`${base}/operations/${restored.id}/rollback`);
  await operation(`${base}/operations/${restored.id}/rollback`, { confirmWorldName: rb.worldName, worldRevision: rb.worldRevision, startAfterRollback: true });
  await runningEvidence('First explicit rollback clean startup'); assert.match(await command('execute if block 0 80 0 minecraft:gold_block'), /Test passed/u);
  await operation(`${base}/actions/stop`, {}); await app.close(); app = undefined;
  adapters = await createLocalAdapters(managerRoot, runtimeFactory);
  const journal = new TransactionJournalStore(managerRoot); const ops = new OperationService(new JsonOperationStore(managerRoot), clock, journal); await ops.initialize();
  const registry = new AdapterRegistry(adapters); const backups = new BackupService(registry, ops, journal, managerRoot, clock);
  const injected = new RestoreService(registry, ops, backups, journal, managerRoot, clock,
    async (point) => { if (point === 'after:rename-old') throw new Error('authorized isolated interruption'); });
  plan = await injected.plan(id, backup.id);
  const failed = await injected.restore(id, backup.id, { restoreScope: 'world-set', confirmWorldName: plan.worldName,
    worldRevision: plan.worldRevision, allowStop: true, startAfterRestore: false }, randomUUID());
  for (let n=0;n<600 && !['succeeded','failed','interrupted'].includes(ops.get(failed.id)?.state);n++)await wait(100);
  assert.equal(ops.get(failed.id).state, 'interrupted'); assert(ops.getServerState(id).recoveryRequired);
  report.faultInjection = { point: 'after:rename-old', operationId: failed.id, state: ops.get(failed.id).state };
  for(const a of adapters)await a.closeObserver(); adapters=[]; await openApp();
  assert((await request(base)).status.recoveryRequired);
  const blocked = await app.inject({ method:'POST', url:`${base}/actions/start`, headers:{...headers,'idempotency-key':randomUUID()},payload:{} });
  assert.equal(blocked.statusCode,409); assert.equal(blocked.json().error.code,'RECOVERY_REQUIRED');
  rb = await request(`${base}/operations/${failed.id}/rollback`); const failureGuard = await backupManifest(rb.backupId); assert(failureGuard.pinned && rb.rollbackAvailable);
  const rolledBack = await operation(`${base}/operations/${failed.id}/rollback`, {confirmWorldName:rb.worldName,worldRevision:rb.worldRevision,startAfterRollback:false});
  await verifyManifest(failureGuard); assert.equal((await request(base)).status.recoveryRequired,false);
  report.explicitRollback={operationId:rolledBack.id,guardId:failureGuard.id,verified:'byte-for-byte before restart'};
  await operation(`${base}/actions/start`,{}); await runningEvidence('Fault recovery explicit rollback starts cleanly');
  assert.match(await command('execute if block 0 80 0 minecraft:gold_block'),/Test passed/u); await operation(`${base}/actions/stop`,{});
  report.p32='PASS'; check('Injected failure never succeeds; restart gates lifecycle; explicit rollback restores guard and clears owned recovery');
  const oldName=props.get('level-name')??'world';const oldFiles=await inventoryRestoreTree(path.join(serverRoot,oldName));
  const newName=`accept-${runId.slice(-8)}`;const createPlan=await request(`${base}/worlds/create-plan`,{name:newName,seed:'987654321'});
  await operation(`${base}/worlds`,{name:newName,seed:'987654321',confirmWorldName:createPlan.currentWorldName,worldRevision:createPlan.worldRevision,allowStop:false});
  await verifyRestoreTree(path.join(serverRoot,oldName),oldFiles);assert.equal((await request(base)).status.state,'stopped');
  await app.close();app=undefined;await openApp();assert.equal((await request(base)).status.recoveryRequired,false);
  await operation(`${base}/actions/start`,{});await runningEvidence('P3.3b explicit generation starts cleanly after manager restart');
  await operation(`${base}/actions/stop`,{});const world=(await request(`${base}/worlds`)).items.find((w)=>w.name.value===newName);
  assert.equal(world.seed.value,'987654321');await verifyRestoreTree(path.join(serverRoot,oldName),oldFiles);
  report.p33b='PASS';check('New world configured seed verified; old world untouched; explicit start only');
  report.crashReportsAfter=await readdir(path.join(serverRoot,'crash-reports')).catch((e)=>{if(e.code==='ENOENT')return [];throw e;});
  assert.deepEqual(report.crashReportsAfter,report.crashReportsBefore);report.result='PASS';
}catch(error){report.result='BLOCKED';report.failure=redact(error.stack??error.message);console.error(redact(error.message));process.exitCode=1;}
finally{
  if(app){try{const s=(await request(base)).status;if(s.state==='running'&&s.ownership==='managed')await operation(`${base}/actions/stop`,{});
    const final=(await request(base)).status;report.finalStopped=final.state==='stopped'&&final.ownership==='none';}catch{report.finalStopped=false;}await app.close();}
  else for(const a of adapters)await a.closeObserver();
  report.finishedAt=new Date().toISOString();
  if(report.canonicalPath && secret){await mkdir(evidenceRoot,{recursive:true});await writeFile(path.join(evidenceRoot,'acceptance-report.json'),JSON.stringify(report,null,2));}
  console.log(JSON.stringify({runId,canonicalPath:report.canonicalPath,result:report.result,p32:report.p32,p33b:report.p33b,managerStartup:report.managerStartup??'BLOCKED',finalStopped:report.finalStopped,evidenceRoot},null,2));
}
