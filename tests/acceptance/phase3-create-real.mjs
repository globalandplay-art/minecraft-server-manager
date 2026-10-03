// Explicitly authorized isolated acceptance. Reads original JAR/EULA only; never its worlds.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { buildApp } from '../../apps/api/src/app.ts';
import { createLocalAdapters } from '../../apps/api/src/config/bootstrap.ts';
import { parseProperties } from '../../apps/api/src/config/properties.ts';
import { LocalRuntimeFactory } from '../../apps/api/src/infra/runtime/index.ts';
import { JsonOperationStore } from '../../apps/api/src/services/operation-store.ts';
import { TransactionJournalStore } from '../../apps/api/src/services/transaction-journal.ts';
import { ActiveWorldStateStore } from '../../apps/api/src/services/active-world-state-store.ts';
import { inventoryRestoreTree, verifyRestoreTree } from '../../apps/api/src/services/restore-files.ts';
import { readWorldVersion } from '../../apps/api/src/services/world-inventory-service.ts';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const runId = `p33-create-${randomUUID()}`;
const serverRoot = path.join(workspace, 'runtime', runId);
const managerRoot = path.join(workspace, '.manager', runId);
const id = 'p33-create-acceptance'; const base = `/api/v1/servers/${id}`;
const secret = randomBytes(32).toString('base64url');
const headers = { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:3000', 'x-manager-intent': 'local-ui' };
const report = { runId, startedAt: new Date().toISOString(), result: 'RUNNING', checks: [], finalStopped: false };
let app; let adapters = []; let vite; let browser;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (name) => { report.checks.push(name); console.log(`PASS: ${name}`); };
const sha = (text) => createHash('sha256').update(text).digest('hex');
async function freePort() {
  const s = net.createServer(); await new Promise((resolve, reject) => { s.once('error', reject); s.listen(0, '127.0.0.1', resolve); });
  const port = s.address().port; await new Promise((resolve) => s.close(resolve)); return port;
}
async function request(url, body, key = randomUUID()) {
  const res = await app.inject({ method: body === undefined ? 'GET' : 'POST', url,
    headers: { ...headers, 'idempotency-key': key }, ...(body === undefined ? {} : { payload: body }) });
  assert(!res.body.includes(secret), 'public response disclosed secret');
  assert(res.statusCode < 300, `HTTP ${res.statusCode}: ${res.json().error?.code}`); return res.json().data;
}
async function operation(url, body, key = randomUUID()) {
  const accepted = (await request(url, body, key)).operation;
  for (let n = 0; n < 600; n++) {
    const op = await request(`/api/v1/operations/${accepted.id}`);
    if (['succeeded', 'failed', 'interrupted'].includes(op.state)) {
      assert.equal(op.state, 'succeeded', `${op.kind} ${op.error?.code ?? op.state}`); return op;
    }
    await wait(300);
  }
  throw new Error('operation timeout');
}
async function openApp() {
  adapters = await createLocalAdapters(managerRoot, new LocalRuntimeFactory());
  const journal = new TransactionJournalStore(managerRoot);
  app = buildApp({ adapters, mode: 'local', managerRoot, transactionJournal: journal, transactionRecovery: journal,
    operationStore: new JsonOperationStore(managerRoot), activeWorldState: new ActiveWorldStateStore(managerRoot, adapters) });
  await app.ready();
}
try {
  const cfg = JSON.parse(await readFile(path.join(workspace, '.manager', 'config.json'), 'utf8'));
  const source = cfg.servers.find((s) => s.id === 'vanilla-26-3'); assert(source, 'registered JAR unavailable');
  const jar = path.join(source.root, source.jarFile); const eula = path.join(source.root, 'eula.txt');
  for (const file of [jar, eula]) {
    const info = await lstat(file); assert(info.isFile() && !info.isSymbolicLink() && info.nlink === 1);
    assert.equal((await realpath(file)).toLowerCase(), path.resolve(file).toLowerCase());
  }
  const eulaText = await readFile(eula, 'utf8'); assert.equal(parseProperties(eulaText).get('eula'), 'true', 'EULA must already be accepted');
  const original = { jar: sha(await readFile(jar)), eula: sha(eulaText) };
  await mkdir(serverRoot, { recursive: true }); await mkdir(managerRoot, { recursive: true });
  await copyFile(jar, path.join(serverRoot, 'server.jar')); await copyFile(eula, path.join(serverRoot, 'eula.txt'));
  const gamePort = await freePort(); let rconPort = await freePort(); while (rconPort === gamePort) rconPort = await freePort();
  await writeFile(path.join(serverRoot, 'server.properties'), [
    'server-ip=127.0.0.1', `server-port=${gamePort}`, 'enable-rcon=true', `rcon.port=${rconPort}`, `rcon.password=${secret}`,
    'level-name=old-test', 'level-seed=12345', 'view-distance=2', 'simulation-distance=2', 'spawn-protection=0',
    'online-mode=true', 'max-players=2', 'enable-query=false', 'management-server-enabled=false', ''
  ].join('\n'), { mode: 0o600 });
  await writeFile(path.join(managerRoot, 'config.json'), JSON.stringify({ schemaVersion: 1, servers: [{
    id, name: 'Isolated world create acceptance', root: serverRoot, javaExecutable: source.javaExecutable,
    jarFile: 'server.jar', jvmArgs: ['-Xms512M', '-Xmx1G'], serverArgs: ['nogui']
  }] }), { mode: 0o600 });
  await openApp(); const info = (await request(base)).server;
  assert.equal(info.minecraftVersion, '26.3'); assert.match(info.java.runtimeVersion, /^25\./);
  check('isolated Vanilla 26.3 / Java 25; copied existing accepted EULA and JAR only');
  await operation(`${base}/actions/start`, {});
  for (const dimension of ['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end']) {
    await wait(3500); await request(`${base}/commands`, { command: `execute in ${dimension} run forceload add 0 0` });
    await wait(3500); await request(`${base}/commands`, { command: `execute in ${dimension} run setblock 0 80 0 minecraft:diamond_block` });
  }
  await operation(`${base}/actions/stop`, {});
  // First manager startup has pending-generation until start reconciles. Refresh readiness now.
  const before = await inventoryRestoreTree(path.join(serverRoot, 'old-test'));
  assert(before.some((f) => f.path.includes('the_nether/region/')) && before.some((f) => f.path.includes('the_end/region/')));
  const propertiesBefore = parseProperties(await readFile(path.join(serverRoot, 'server.properties'), 'utf8'));
  const plan = await request(`${base}/worlds/create-plan`, { name: 'new-test', seed: '987654321' });
  assert(plan.executionAvailable); assert.equal(plan.currentWorldName, 'old-test'); assert(plan.worldRevision);
  assert.equal((await request(base)).readiness.worldChanges.allowed, true);
  await app.listen({ host: '127.0.0.1', port: 8080 });
  vite = await createServer({ root: path.join(workspace, 'apps/web'), configFile: path.join(workspace, 'apps/web/vite.config.ts'),
    server: { host: '127.0.0.1', port: 3000, strictPort: true }, logLevel: 'error' });
  await vite.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } }); const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:3000/worlds?server=${id}`);
  await page.getByLabel('新世界名称').fill('new-test');
  await page.getByLabel('Seed（留空为随机）').fill('987654321');
  await page.getByRole('button', { name: '校验新世界计划' }).click();
  const createButton = page.getByRole('button', { name: '确认创建并保持停服' });
  await createButton.waitFor(); assert(await createButton.isDisabled());
  await page.getByLabel('输入当前世界名确认切换').fill('old-test'); assert(await createButton.isDisabled());
  await page.getByLabel('我确认保留旧世界，并允许必要停服').check();
  const outgoing = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`${base}/worlds`));
  await createButton.click(); const sent = await outgoing; const body = sent.postDataJSON(); const key = sent.headers()['idempotency-key'];
  await page.getByRole('status').filter({ hasText: '配置已切换' }).waitFor({ timeout: 60_000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 360); assert.deepEqual(errors, []);
  const created = await operation(`${base}/worlds`, body, key);
  await browser.close(); browser = undefined; await vite.close(); vite = undefined;
  check('360px real browser enforces name/stop confirmation and creates without overflow or script errors');
  assert.equal((await request(`${base}/worlds`, body, key)).operation.id, created.id);
  assert.equal((await request(base)).status.state, 'stopped'); await verifyRestoreTree(path.join(serverRoot, 'old-test'), before);
  await assert.rejects(lstat(path.join(serverRoot, 'new-test')), { code: 'ENOENT' });
  const after = parseProperties(await readFile(path.join(serverRoot, 'server.properties'), 'utf8'));
  assert.equal(after.get('level-name'), 'new-test'); assert.equal(after.get('level-seed'), '987654321');
  for (const [k, v] of propertiesBefore) if (!['level-name', 'level-seed'].includes(k)) assert.equal(after.get(k), v);
  const guard = JSON.parse(await readFile(path.join(managerRoot, 'backups', id, created.result.resourceId, 'manifest.json'), 'utf8'));
  assert(guard.pinned && guard.scope === 'world-set'); assert.equal(guard.fileCount, before.length);
  check('creation preserves all three old dimensions; pins exact guard, changes only world/seed, never starts implicitly');
  await app.close(); app = undefined; await openApp();
  const pending = JSON.parse(await readFile(path.join(managerRoot, 'active-worlds', `${id}.json`), 'utf8'));
  assert.equal(pending.state, 'pending-generation'); assert.equal(pending.levelName, 'new-test');
  assert.equal((await request(base)).status.recoveryRequired, false);
  assert.equal((await request(base)).readiness.worldChanges.allowed, false);
  check('manager restart preserves pending generation and safe lifecycle admission');
  await operation(`${base}/actions/start`, {}); await operation(`${base}/actions/stop`, {});
  assert.equal(await readWorldVersion(path.join(serverRoot, 'new-test')), '26.3');
  const current = (await request(`${base}/worlds`)).items.find((w) => w.name.value === 'new-test');
  assert(current && current.seed.value === '987654321'); await verifyRestoreTree(path.join(serverRoot, 'old-test'), before);
  const state = JSON.parse(await readFile(path.join(managerRoot, 'active-worlds', `${id}.json`), 'utf8'));
  assert.equal(state.state, 'active'); assert.equal(state.levelName, 'new-test');
  check('explicit start generates configured new seed/version; old world remains byte-for-byte unchanged');
  assert.equal(sha(await readFile(jar)), original.jar); assert.equal(sha(await readFile(eula, 'utf8')), original.eula);
  const log = await readFile(path.join(serverRoot, 'logs', 'latest.log'), 'utf8');
  report.environmentErrorPresent = /\bERROR\b/u.test(log);
  report.cleanStartupGate = report.environmentErrorPresent ? 'BLOCKED' : 'PASS';
  report.creationSemantics = 'PASS';
  report.result = report.environmentErrorPresent ? 'BLOCKED' : 'PASS';
} catch (error) {
  report.result = 'FAIL'; report.failure = String(error.message).replaceAll(secret, '[redacted]');
  console.error(`FAIL: ${report.failure}`); process.exitCode = 1;
} finally {
  await browser?.close(); await vite?.close();
  if (app) {
    try { const status = (await request(base)).status;
      if (status.state === 'running' && status.ownership === 'managed') await operation(`${base}/actions/stop`, {});
      const final = (await request(base)).status; report.finalStopped = final.state === 'stopped' && final.ownership === 'none';
    } catch { report.finalStopped = false; }
    await app.close();
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(managerRoot, 'acceptance-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
