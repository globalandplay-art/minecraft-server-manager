// Opt-in isolated real acceptance: copies only the registered JAR and accepted EULA.
// node --import tsx tests/acceptance/phase3-restore-real.mjs
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { buildApp } from '../../apps/api/src/app.ts';
import { AdapterRegistry } from '../../apps/api/src/adapters/registry.ts';
import { createLocalAdapters } from '../../apps/api/src/config/bootstrap.ts';
import { parseProperties } from '../../apps/api/src/config/properties.ts';
import { LocalRuntimeFactory } from '../../apps/api/src/infra/runtime/index.ts';
import { JsonOperationStore } from '../../apps/api/src/services/operation-store.ts';
import { OperationService } from '../../apps/api/src/services/operation-service.ts';
import { BackupService } from '../../apps/api/src/services/backup-service.ts';
import { RestoreService } from '../../apps/api/src/services/restore-service.ts';
import { TransactionJournalStore } from '../../apps/api/src/services/transaction-journal.ts';
import { ActiveWorldStateStore } from '../../apps/api/src/services/active-world-state-store.ts';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const runId = `p32-real-${randomUUID()}`;
const serverRoot = path.join(workspace, 'runtime', runId);
const managerRoot = path.join(workspace, '.manager', runId);
const report = { schemaVersion: 1, runId, startedAt: new Date().toISOString(), checks: [], result: 'RUNNING' };
const id = 'p32-acceptance'; const base = `/api/v1/servers/${id}`;
const headers = { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:3000', 'x-manager-intent': 'local-ui' };
const clock = { now: () => new Date() };
let app; let adapters = []; let vite; let browser; let secret;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (name) => { report.checks.push(name); console.log(`PASS: ${name}`); };
async function sha(file) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
async function propertiesFingerprint(file) {
  return createHash('sha256').update(JSON.stringify([...parseProperties(await readFile(file, 'utf8'))].sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
}
async function port() {
  const s = net.createServer(); await new Promise((resolve, reject) => { s.once('error', reject); s.listen(0, '127.0.0.1', resolve); });
  const value = s.address().port; await new Promise((resolve) => s.close(resolve)); return value;
}
async function request(url, payload, key = randomUUID()) {
  const response = await app.inject({ method: payload === undefined ? 'GET' : 'POST', url,
    headers: { ...headers, 'idempotency-key': key }, ...(payload === undefined ? {} : { payload }) });
  if (response.statusCode >= 300) assert.fail(`API ${url.split('/').at(-1)} rejected (${response.statusCode}, ${response.json().error?.code})`);
  assert(!response.body.includes(secret), 'secret in public response'); return response;
}
async function operation(url, payload, key = randomUUID()) {
  const accepted = (await request(url, payload, key)).json().data.operation;
  for (let n = 0; n < 600; n++) {
    const op = (await request(`/api/v1/operations/${accepted.id}`)).json().data;
    if (['succeeded', 'failed', 'interrupted'].includes(op.state)) {
      assert.equal(op.state, 'succeeded', `${op.kind} ${op.state} ${op.error?.code ?? ''}`); return op;
    }
    await wait(300);
  }
  throw new Error('operation timeout');
}
async function command(text) {
  await wait(3500);
  const response = await request(base + '/commands', { command: text });
  assert.equal(response.json().data.transport, 'rcon'); return response.json().data.output;
}
async function status() { return (await request(base)).json().data.status; }
async function manifest(backupId) {
  return JSON.parse(await readFile(path.join(managerRoot, 'backups', id, backupId, 'manifest.json'), 'utf8'));
}
async function verifyLive(m) {
  for (const f of m.files) assert.equal(await sha(path.join(serverRoot, ...f.path.split('/'))), f.sha256, 'live restored hash');
}
async function startApp() {
  adapters = await createLocalAdapters(managerRoot, new LocalRuntimeFactory());
  const journal = new TransactionJournalStore(managerRoot);
  app = buildApp({ adapters, mode: 'local', managerRoot, transactionJournal: journal, transactionRecovery: journal,
    operationStore: new JsonOperationStore(managerRoot), activeWorldState: new ActiveWorldStateStore(managerRoot, adapters) });
  await app.ready();
}

try {
  const cfg = JSON.parse(await readFile(path.join(workspace, '.manager', 'config.json'), 'utf8'));
  const source = cfg.servers.find((s) => s.id === 'vanilla-26-3'); assert(source, 'registered test JAR unavailable');
  const jar = path.join(source.root, source.jarFile); const eula = path.join(source.root, 'eula.txt');
  for (const f of [jar, eula]) {
    const info = await lstat(f); assert(info.isFile() && !info.isSymbolicLink());
    assert.equal((await realpath(f)).toLowerCase(), path.resolve(f).toLowerCase());
  }
  assert.equal(parseProperties(await readFile(eula, 'utf8')).get('eula'), 'true', 'test never accepts EULA');
  const original = { jar: await sha(jar), eula: await sha(eula) };
  await mkdir(serverRoot, { recursive: true }); await mkdir(managerRoot, { recursive: true });
  await copyFile(jar, path.join(serverRoot, 'server.jar')); await copyFile(eula, path.join(serverRoot, 'eula.txt'));
  secret = randomBytes(32).toString('base64url'); const ports = [await port(), await port()]; assert.notEqual(...ports);
  await writeFile(path.join(serverRoot, 'server.properties'), [
    'server-ip=127.0.0.1', `server-port=${ports[0]}`, 'enable-rcon=true', `rcon.port=${ports[1]}`, `rcon.password=${secret}`,
    'level-name=p32-test', 'level-seed=12345', 'view-distance=2', 'simulation-distance=2', 'spawn-protection=0',
    'online-mode=true', 'max-players=2', 'enable-query=false', 'management-server-enabled=false', 'sync-chunk-writes=true', ''
  ].join('\n'), { mode: 0o600 });
  await writeFile(path.join(managerRoot, 'config.json'), JSON.stringify({ schemaVersion: 1, servers: [{
    id, name: 'Isolated P3.2 real acceptance', root: serverRoot, javaExecutable: source.javaExecutable, jarFile: 'server.jar',
    jvmArgs: ['-Xms512M', '-Xmx1G'], serverArgs: ['nogui']
  }] }), { mode: 0o600 });
  await startApp(); const info = (await request(base)).json().data.server;
  assert.equal(info.minecraftVersion, '26.3'); assert.match(info.java.runtimeVersion, /^25\./);
  report.minecraftVersion = info.minecraftVersion; report.javaVersion = info.java.runtimeVersion;
  check('isolated Vanilla 26.3 / Java 25, accepted EULA copied without opening original world');
  await operation(base + '/actions/start', {});
  for (const d of ['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end']) {
    await command(`execute in ${d} run forceload add 0 0`); await wait(2000);
    await command(`execute in ${d} run setblock 0 80 0 minecraft:diamond_block`);
  }
  await operation(base + '/actions/stop', {});
  await operation(base + '/backups', { scope: 'world-set', allowStop: false, label: 'P3.2 restore source' });
  const backup = (await request(base + '/backups')).json().data.items.find((b) => b.label === 'P3.2 restore source');
  const sourceManifest = await manifest(backup.id);
  assert(sourceManifest.files.some((f) => f.path.includes('/the_nether/region/')));
  assert(sourceManifest.files.some((f) => f.path.includes('/the_end/region/')));
  await operation(base + '/actions/start', {}); await command('setblock 0 80 0 minecraft:gold_block'); await operation(base + '/actions/stop', {});
  const configHash = await sha(path.join(serverRoot, 'server.properties'));
  const configValuesHash = await propertiesFingerprint(path.join(serverRoot, 'server.properties'));
  check('created three saved dimensions and changed only the isolated world');

  await app.listen({ host: '127.0.0.1', port: 8080 });
  vite = await createServer({ root: path.join(workspace, 'apps/web'), configFile: path.join(workspace, 'apps/web/vite.config.ts'),
    server: { host: '127.0.0.1', port: 3000, strictPort: true }, logLevel: 'error' });
  await vite.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } }); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:3000/backups?server=${id}`);
  const row = page.locator('.backup-row').filter({ hasText: 'P3.2 restore source' });
  await row.getByRole('button', { name: '恢复世界' }).click();
  await row.getByLabel('输入世界名确认覆盖').fill('p32-test');
  await row.getByLabel('我确认覆盖此世界，并允许必要的停服').check();
  await row.getByRole('button', { name: '确认恢复' }).click();
  await row.getByRole('status').filter({ hasText: '恢复状态：succeeded' }).waitFor({ timeout: 60_000 });
  assert.equal((await status()).state, 'stopped'); await verifyLive(sourceManifest);
  const [restore] = (await request(base + '/restores')).json().data.items;
  const guardId = (await request(`/api/v1/operations/${restore.operationId}`)).json().data.result.resourceId;
  const guard = await manifest(guardId); assert(guard.pinned);
  await page.getByRole('button', { name: '显式回滚', exact: true }).click();
  await page.getByLabel('输入世界名确认覆盖').fill('p32-test');
  await page.getByLabel('我确认覆盖此世界，并允许必要的停服').check();
  await page.getByRole('button', { name: '确认回滚' }).click();
  // Terminal rollback refreshes durable history and removes its action panel.
  await page.getByText('已回滚', { exact: true }).waitFor({ timeout: 60_000 });
  await verifyLive(guard); assert.equal((await status()).state, 'stopped');
  assert.equal(await sha(path.join(serverRoot, 'server.properties')), configHash);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 360); assert.deepEqual(errors, []);
  await browser.close(); browser = undefined; await vite.close(); vite = undefined;
  check('360px browser confirmation restores all files, pins guard, explicitly rolls back, defaults to stopped, no overflow/errors');

  const plan = (await request(`${base}/backups/${backup.id}/restore`)).json().data;
  const body = { restoreScope: 'world-set', confirmWorldName: plan.worldName, worldRevision: plan.worldRevision, allowStop: true, startAfterRestore: true };
  const key = randomUUID(); const startedRestore = await operation(`${base}/backups/${backup.id}/restore`, body, key);
  assert.equal((await request(`${base}/backups/${backup.id}/restore`, body, key)).json().data.operation.id, startedRestore.id);
  for (const d of ['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end']) {
    assert.match(await command(`execute in ${d} if block 0 80 0 minecraft:diamond_block`), /Test passed/u);
  }
  const rb = (await request(`${base}/operations/${startedRestore.id}/rollback`)).json().data;
  await operation(`${base}/operations/${startedRestore.id}/rollback`, { confirmWorldName: rb.worldName, worldRevision: rb.worldRevision, startAfterRollback: true });
  assert.match(await command('execute if block 0 80 0 minecraft:gold_block'), /Test passed/u);
  await operation(base + '/actions/stop', {});
  check('explicit real restart verifies restored blocks in all dimensions; same key reused, running rollback returns gold marker');

  await app.close(); app = undefined; adapters = await createLocalAdapters(managerRoot, new LocalRuntimeFactory());
  const journal = new TransactionJournalStore(managerRoot); const ops = new OperationService(new JsonOperationStore(managerRoot), clock, journal); await ops.initialize();
  const registry = new AdapterRegistry(adapters); const backups = new BackupService(registry, ops, journal, managerRoot, clock);
  const failing = new RestoreService(registry, ops, backups, journal, managerRoot, clock, async (p) => { if (p === 'after:rename-old') throw new Error('controlled crash window'); });
  const failurePlan = await failing.plan(id, backup.id);
  const failed = await failing.restore(id, backup.id, { restoreScope: 'world-set', confirmWorldName: failurePlan.worldName,
    worldRevision: failurePlan.worldRevision, allowStop: true, startAfterRestore: false }, randomUUID());
  for (let n = 0; n < 400 && !['interrupted', 'failed', 'succeeded'].includes(ops.get(failed.id)?.state); n++) await wait(200);
  assert.equal(ops.get(failed.id)?.state, 'interrupted'); assert.equal(ops.getServerState(id).recoveryRequired, true);
  for (const adapter of adapters) await adapter.closeObserver(); adapters = [];
  await startApp(); assert.equal((await status()).recoveryRequired, true);
  const blocked = await app.inject({ method: 'POST', url: base + '/actions/start', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: {} });
  assert.equal(blocked.statusCode, 409); assert.equal(blocked.json().error.code, 'RECOVERY_REQUIRED');
  const recoveryPlan = (await request(`${base}/operations/${failed.id}/rollback`)).json().data;
  const failureGuard = await manifest(recoveryPlan.backupId);
  await operation(`${base}/operations/${failed.id}/rollback`, { confirmWorldName: recoveryPlan.worldName, worldRevision: recoveryPlan.worldRevision, startAfterRollback: false });
  await verifyLive(failureGuard); assert.equal((await status()).recoveryRequired, false); assert.equal((await status()).state, 'stopped');
  check('real on-disk crash window after old rename survives manager restart; normal start blocked and explicit rollback restores guard');
  assert.equal(await sha(jar), original.jar); assert.equal(await sha(eula), original.eula);
  assert.equal(await propertiesFingerprint(path.join(serverRoot, 'server.properties')), configValuesHash);
  report.finalStatus = 'stopped'; report.fileCount = sourceManifest.fileCount; report.inputJarSha256 = original.jar; report.result = 'PASS';
  check('original JAR/EULA and isolated properties values unchanged; original world never accessed; final isolated Minecraft stopped');
} catch (error) {
  report.result = 'FAIL'; report.error = String(error?.message ?? 'acceptance failure').replaceAll(secret ?? '\0', '<redacted>');
  console.error(`FAIL: ${report.error}`); process.exitCode = 1;
} finally {
  if (browser) await browser.close(); if (vite) await vite.close();
  for (const adapter of adapters) {
    if (adapter.plan.rootPath !== serverRoot) throw new Error('cleanup refuses non-test adapter');
    const state = await adapter.getStatus();
    if (state.ownership === 'managed') {
      try { await adapter.stop({ operationId: randomUUID(), signal: new AbortController().signal, onStep: async () => ({}) }); }
      catch { report.cleanupError = 'isolated stop not confirmed'; report.result = 'FAIL'; process.exitCode = 1; }
    }
  }
  if (adapters.length) report.finalStatus = (await adapters[0].getStatus()).state;
  if (app) await app.close(); else for (const adapter of adapters) await adapter.closeObserver();
  report.finishedAt = new Date().toISOString(); await mkdir(managerRoot, { recursive: true });
  await writeFile(path.join(managerRoot, 'acceptance-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Evidence: .manager/${runId}/acceptance-report.json`);
}
