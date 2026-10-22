// Real Chrome -> real Vite -> real Fastify -> real registration files/runtime.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, lstat, realpath } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { parseProperties } from '../../apps/api/src/config/properties.ts';
assert.equal(process.platform, 'win32'); assert.equal(process.env.LT_M12_REAL_BROWSER, '1');
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const results = path.join(workspace, 'test-results');
for (const directory of [workspace, results]) {
  const stat = await lstat(directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'test parent must be an ordinary directory');
  assert.equal((await realpath(directory)).toLowerCase(), path.resolve(directory).toLowerCase());
}
const root = path.join(workspace, 'test-results', `m12-real-${randomUUID()}`), manager = path.join(root, 'manager');
const auth = JSON.parse(await readFile(path.join(workspace, '.manager/test-instance-authorization.json'), 'utf8'));
const registry = JSON.parse(await readFile(path.join(workspace, '.manager/config.json'), 'utf8'));
const source = registry.servers.find(row => row.id === 'vanilla-26-3'); assert(source);
assert.equal((await realpath(source.root)).toLowerCase(), auth.canonicalRoot.toLowerCase());
const jar = await readFile(path.join(source.root, source.jarFile)), eula = await readFile(path.join(source.root, 'eula.txt'));
assert.equal(createHash('sha256').update(jar).digest('hex'), auth.observedJarSha256); assert.equal(parseProperties(eula.toString('utf8')).get('eula'), 'true');
async function free(port) {
  const server = net.createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const assigned = server.address().port; await new Promise(resolve => server.close(resolve)); return assigned;
}
await free(3000); await free(8080); await mkdir(root); await mkdir(manager);
console.log(`CONFIRMED ISOLATED BROWSER ROOT: ${await realpath(root)}`);
const records = [], ports = new Set();
for (const id of ['anchor', '360', '768', '1440']) {
  const directory = path.join(root, `server-${id}-测试`); await mkdir(directory);
  let port; do { port = await free(0); } while (ports.has(port)); ports.add(port);
  await writeFile(path.join(directory, 'server.jar'), jar, { flag: 'wx' }); await writeFile(path.join(directory, 'eula.txt'), eula, { flag: 'wx' });
  await writeFile(path.join(directory, 'server.properties'), `server-ip=127.0.0.1\nserver-port=${port}\nenable-rcon=false\nlevel-name=world\nview-distance=2\nsimulation-distance=2\nmotd=M12 ${id}\n`);
  for (const dir of ['world', 'mods', 'plugins', 'playerdata']) { await mkdir(path.join(directory, dir)); await writeFile(path.join(directory, dir, 'marker.keep'), `preserve ${id} ${dir}`); }
  records.push({ id: id === 'anchor' ? id : `browser-${id}`, name: `Browser ${id}`, root: directory, jarFile: 'server.jar', javaExecutable: source.javaExecutable, jvmArgs: ['-Xms256M', '-Xmx1G'], serverArgs: ['nogui'] });
}
const configFile = path.join(manager, 'config.json'); await writeFile(configFile, JSON.stringify({ schemaVersion: 1, servers: [records[0]] }));
const report = { root: path.basename(root), result: 'BLOCKED', widths: [], managerSessions: [], checks: [], realHTTP: true, routeInterception: false };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let worker, vite, browser, page, context; const frontendOutput = [];
async function startManager() {
  worker = spawn(process.execPath, ['--import', 'tsx', path.join(workspace, 'tests/fixtures/m12-manager.mjs')],
    { cwd: workspace, env: { ...process.env, LT_M12_ROOT: root }, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  const output = []; worker.stdout.on('data', chunk => output.push(chunk.toString())); worker.stderr.on('data', chunk => output.push(chunk.toString()));
  worker.once('exit', code => writeFile(path.join(root, `manager-${worker.pid}-${code}.log`), output.join('')).catch(() => {}));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('manager-ready-deadline')), 30000);
    worker.once('exit', () => { clearTimeout(timeout); reject(new Error('manager-exited-before-ready')); });
    worker.on('message', message => { if (message.type === 'ready') { clearTimeout(timeout); resolve(); } });
  });
}
async function stopManager() {
  const owned = worker;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('CLEANUP_BLOCKED: Manager close deadline')), 15000);
    owned.on('message', message => {
      if (message.type === 'closed') { report.managerSessions.push(message); }
      if (message.type === 'close-blocked') { clearTimeout(timeout); reject(new Error('CLEANUP_BLOCKED')); }
    });
    owned.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`manager-exit-${code}`)); }); owned.send('close');
  }); worker = undefined;
}
async function json(url, body, method = 'POST') {
  const response = await page.request.fetch(`http://127.0.0.1:3000/api/v1${url}`, { method: body === undefined ? 'GET' : method,
    headers: { Origin: 'http://127.0.0.1:3000', 'X-Manager-Intent': 'local-ui', 'Idempotency-Key': randomUUID() }, ...(body === undefined ? {} : { data: body }) });
  return { status: response.status(), body: await response.json() };
}
async function load() { await page.goto('http://127.0.0.1:3000/servers'); await expect(page.getByRole('button', { name: '检查实例' })).toBeEnabled(); }
async function fill(record) {
  for (const [name, value] of [['实例标识',record.id],['显示名称',record.name],['服务端目录',record.root],['启动 JAR 文件名','server.jar']]) await page.getByLabel(name, { exact: true }).fill(value);
}
async function add(record) {
  await fill(record); const checked = page.waitForResponse(response => response.url().endsWith('/server-registrations/preflight') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '检查实例' }).click(); assert.equal((await checked).status(), 200);
  await expect(page.getByText(`确认登记：${record.name}`)).toBeVisible(); await expect(page.getByText(/VANILLA · Minecraft 26.3/).first()).toBeVisible();
  await page.getByRole('checkbox').check(); const saved = page.waitForResponse(response => response.url().endsWith('/server-registrations') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '保存实例' }).click(); const response = await saved; assert.equal(response.status(), 201); assert.equal((await response.json()).data.loaded, true);
  await expect(page.locator('.server-card').filter({ has: page.getByRole('heading', { name: record.name, exact: true }) })).toHaveCount(1);
}
async function remove(record) {
  const card = page.locator('.server-card').filter({ has: page.getByRole('heading', { name: record.name, exact: true }) });
  await card.getByRole('button', { name: '移除服务器', exact: true }).click(); const dialog = page.getByRole('dialog', { name: `移除 ${record.name}` });
  await expect(dialog).toContainText('不删除服务端目录'); const removed = page.waitForResponse(response => response.url().endsWith(`/server-registrations/${record.id}`) && response.request().method() === 'DELETE');
  await dialog.getByRole('button', { name: '确认移除' }).click(); assert.equal((await removed).status(), 200); await expect(card).toHaveCount(0);
}
async function snapshot(directory) {
  const result = {};
  async function walk(at, relative = '') {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      assert(!entry.isSymbolicLink()); const file = path.join(at, entry.name), key = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(file, key); else { assert((await lstat(file)).isFile()); result[key] = createHash('sha256').update(await readFile(file)).digest('hex'); }
    }
  }
  await walk(directory); return result;
}
async function state(id, expected) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) { const result = await json(`/servers/${id}`); if (result.body.data?.status.state === expected && !result.body.data.status.activeOperationId) return; await sleep(400); }
  throw new Error(`state-deadline-${id}-${expected}`);
}
try {
  await startManager();
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'apps/web', '--config', 'apps/web/vite.config.ts'], { cwd: workspace, shell: false, windowsHide: true });
  for (const stream of ['stdout','stderr']) vite[stream].on('data', chunk => { if (frontendOutput.length < 1000) frontendOutput.push(chunk.toString()); });
  for (let attempt = 0;; attempt++) { try { const response = await fetch('http://127.0.0.1:3000'); if (response.ok) break; } catch { /* Wait for the captured Vite process only. */ } assert(attempt < 100, 'Vite ready deadline'); await sleep(100); }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [360,768,1440]) {
    context = await browser.newContext({ viewport: { width, height: 950 } }); await context.tracing.start({ screenshots: true, snapshots: true }); page = await context.newPage();
    await load(); assert.equal((await json('/health')).body.meta.mode, 'local'); await expect(page.locator('.mock-banner')).toHaveCount(0);
    const target = records.find(row => row.id === `browser-${width}`), removedId = target.id;
    const configBeforeOffline = await readFile(configFile);
    await fill(target); await context.setOffline(true); await page.getByRole('button', { name: '检查实例' }).click();
    await expect(page.getByRole('status').filter({ hasText: /网络|连接|失败|fetch/i })).toBeVisible();
    assert((await readFile(configFile)).equals(configBeforeOffline)); await context.setOffline(false); await load();
    await fill({ ...target, root: path.join(root, 'missing') }); await page.getByRole('button', { name: '检查实例' }).click(); await expect(page.getByText(/目录、服务端文件或 Java 检查未通过/)).toBeVisible();
    await fill({ ...target, id: 'anchor' }); await page.getByRole('button', { name: '检查实例' }).click(); await expect(page.getByText(/实例标识已存在/)).toBeVisible();
    assert.equal((await json('/server-registrations/preflight', { ...target, javaProfileId: 'bad', javaExecutable: undefined, jvmArgs: undefined, serverArgs: undefined })).status, 409);
    await add(target); await page.getByLabel('选择服务器实例').selectOption(target.id); await expect(page).toHaveURL(new RegExp(`server=${target.id}`));
    await page.reload(); await expect(page.getByRole('heading', { name: target.name, exact: true })).toBeVisible();
    await fill({ ...target, id: `duplicate-${width}` });
    const duplicate = page.waitForResponse(response => response.url().endsWith('/server-registrations/preflight'));
    await page.getByRole('button', { name: '检查实例' }).click(); assert.equal((await duplicate).status(), 409);
    assert.equal((await (await duplicate).json()).error.code, 'REGISTRATION_PREFLIGHT_FAILED');
    if (width === 360) {
      await page.goto(`http://127.0.0.1:3000/dashboard?server=${target.id}`); await page.getByRole('button', { name: '启动', exact: true }).click(); await state(target.id, 'running');
      assert.equal((await json(`/server-registrations/${target.id}`, { confirm: true }, 'DELETE')).status, 409);
      await load(); await expect(page.locator('.server-card').filter({ has: page.getByRole('heading', { name: target.name, exact: true }) }).getByRole('button', { name: '移除服务器' })).toBeDisabled();
      await page.goto(`http://127.0.0.1:3000/dashboard?server=${target.id}`); await page.getByRole('button', { name: '停止', exact: true }).click(); await page.getByRole('button', { name: '确认停止', exact: true }).click(); await state(target.id, 'stopped');
      await load(); await page.getByLabel('选择服务器实例').selectOption(target.id);
    }
    if (width === 768) await page.getByLabel('选择服务器实例').selectOption('anchor');
    const before = await snapshot(target.root); await page.screenshot({ path: path.join(root, `${width}-before-remove.png`), fullPage: true });
    await remove(target); assert.deepEqual(await snapshot(target.root), before);
    if (width === 768) await expect(page.getByLabel('选择服务器实例')).toHaveValue('anchor');
    await expect(page.getByLabel('选择服务器实例')).not.toHaveValue(removedId); assert(!(JSON.parse(await readFile(configFile, 'utf8')).servers.some(row => row.id === removedId)));
    await page.reload(); await expect(page.getByRole('heading', { name: target.name, exact: true })).toHaveCount(0);
    const kept = { ...target, id: `kept-${width}`, name: `Kept ${width}` }; await add(kept);
    const beforeRestart = (await json('/servers')).body.data.items.map(row => row.server.id).sort(); await stopManager(); await startManager(); await page.reload();
    await expect(page.getByRole('heading', { name: kept.name, exact: true })).toBeVisible(); assert.deepEqual((await json('/servers')).body.data.items.map(row => row.server.id).sort(), beforeRestart);
    assert.equal((await json('/servers')).body.data.items.some(row => row.server.id === removedId), false);
    assert.equal((await json('/server-registrations/unknown', { confirm: true }, 'DELETE')).status, 404);
    const dimensions = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth })); assert(dimensions.document <= dimensions.width + 1);
    await page.screenshot({ path: path.join(root, `${width}-after-restart.png`), fullPage: true }); report.widths.push({ width, result: 'PASS', filesPreserved: true, managerRestartConsistent: true });
    await context.tracing.stop({ path: path.join(root, `${width}-trace.zip`) }); await context.close(); context = undefined;
  }
  context = await browser.newContext({ viewport: { width: 1440, height: 950 } }); page = await context.newPage(); await load();
  for (const row of [...JSON.parse(await readFile(configFile, 'utf8')).servers]) await remove(row);
  await expect(page.getByText('尚未接入服务器实例')).toBeVisible(); await stopManager(); await startManager(); await page.reload(); await expect(page.getByRole('button', { name: '检查实例' })).toBeEnabled();
  const final = { ...records[1], id: 'after-empty', name: 'After empty restart' }; await add(final);
  report.checks.push('empty registry restart retains trusted Java and supports add', 'real Chrome/Vite/Fastify, no route interception', 'original files preserved by full tree hashes');
  report.result = 'PASS';
} catch (error) { report.errorCode = error.code ?? 'NO_EXPLICIT_ERROR_CODE'; report.error = String(error.message); if (page) await page.screenshot({ path: path.join(root, 'failure.png'), fullPage: true }).catch(() => {}); }
finally {
  // A browser assertion must not leave a correctly identified test Minecraft running.
  try {
    if (worker && worker.exitCode === null) {
      const response = await fetch('http://127.0.0.1:8080/api/v1/servers', { signal: AbortSignal.timeout(3000) });
      const items = (await response.json()).data.items;
      for (const initial of items) {
        let item = initial;
        if (item.status.state === 'stopped' && item.status.ownership === 'none' && !item.status.activeOperationId) continue;
        assert(/^browser-(?:360|768|1440)$/u.test(item.server.id)); report.diagnosticCleanupStop = true;
        const settleDeadline = Date.now() + 120000;
        while (item.status.activeOperationId || ['starting', 'stopping'].includes(item.status.state)) {
          assert(Date.now() < settleDeadline, 'CLEANUP_BLOCKED: owned lifecycle did not settle'); await sleep(250);
          const observed = await fetch(`http://127.0.0.1:8080/api/v1/servers/${item.server.id}`, { signal: AbortSignal.timeout(3000) });
          assert.equal(observed.status, 200); item = (await observed.json()).data;
        }
        if (item.status.state === 'stopped' && item.status.ownership === 'none') continue;
        assert.equal(item.status.state, 'running'); assert.equal(item.status.ownership, 'managed');
        const stopped = await fetch(`http://127.0.0.1:8080/api/v1/servers/${item.server.id}/actions/stop`, { method: 'POST', signal: AbortSignal.timeout(3000),
          headers: { Origin: 'http://127.0.0.1:3000', 'X-Manager-Intent': 'local-ui', 'Idempotency-Key': randomUUID(), 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(stopped.status, 202); const operationId = (await stopped.json()).data.operation.id;
        for (let attempt = 0; attempt < 150; attempt++) {
          const operation = await (await fetch(`http://127.0.0.1:8080/api/v1/operations/${operationId}`, { signal: AbortSignal.timeout(3000) })).json();
          if (operation.data.state === 'succeeded') break; assert(attempt < 149, 'cleanup stop did not finish'); await sleep(100);
        }
      }
    }
  } catch { report.cleanup = 'CLEANUP_BLOCKED'; report.result = 'BLOCKED'; }
  try { if (context) await context.close(); await browser?.close(); } catch { report.result = 'BLOCKED'; }
  try { if (worker) await stopManager(); } catch { report.cleanup = 'CLEANUP_BLOCKED'; report.result = 'BLOCKED'; }
  if (vite && vite.exitCode === null && vite.signalCode === null) {
    try { await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('owned-vite-close-deadline')), 10000);
      vite.once('close', () => { clearTimeout(deadline); resolve(); });
      if (!vite.kill()) { clearTimeout(deadline); reject(new Error('owned-vite-close-unconfirmed')); }
    }); } catch { report.cleanup = 'CLEANUP_BLOCKED'; report.result = 'BLOCKED'; }
  }
  await writeFile(path.join(root, 'vite.log'), frontendOutput.join(''));
  report.noImplicitMinecraftLaunch = report.managerSessions.reduce((sum, session) => sum + session.children.length, 0) === (report.widths.length ? 1 : 0);
  report.javaNormalExit = report.managerSessions.flatMap(session => session.children).every(child => child.closed === true && child.exitCode === 0 && child.exitSignal === null);
  report.sourceInputsUnchanged = createHash('sha256').update(await readFile(path.join(source.root, source.jarFile))).digest('hex') === auth.observedJarSha256 && (await readFile(path.join(source.root, 'eula.txt'))).equals(eula);
  if (report.result === 'PASS' && (!report.noImplicitMinecraftLaunch || !report.javaNormalExit || !report.sourceInputsUnchanged || report.diagnosticCleanupStop)) report.result = 'BLOCKED';
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(`${report.result}: ${root}`); process.exitCode = report.result === 'PASS' ? 0 : 1;
}
