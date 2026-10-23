// Real Chrome -> Vite -> production Fastify registration; never start Minecraft.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { neoForgeSourcePreflight } from './neoforge-source-preflight.mjs';
import { addonZip } from '../../apps/api/test/helpers/addon-zip.ts';

assert.equal(process.platform, 'win32');
assert.equal(process.env.LT_M21_REGISTRATION_BROWSER, '1');
const installMods = process.env.LT_M3_PROTECTED_INSTALL === '1';
const timingEnabled = process.env.LT_M3_COMPLETION_TIMING === '1';
assert(!timingEnabled || installMods, 'completion timing requires the protected install fixture');
const stagingMods = process.env.LT_M3_VALIDATION_STAGING === '1' || installMods;
const readonlyMods = process.env.LT_M3_READONLY_INVENTORY === '1' || stagingMods;
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const manifest = await neoForgeSourcePreflight();
const auth = JSON.parse(await readFile(path.join(workspace, '.manager/test-instance-authorization.json'), 'utf8'));
const registry = JSON.parse(await readFile(path.join(workspace, '.manager/config.json'), 'utf8'));
const source = registry.servers.find(row => row.id === auth.serverId); assert(source);
assert.equal((await realpath(source.root)).toLowerCase(), auth.canonicalRoot.toLowerCase());
const jar = await readFile(path.join(source.root, source.jarFile));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(jar), auth.observedJarSha256);
async function plain(target) {
  for (let cursor = target;; cursor = path.dirname(cursor)) {
    assert(!(await lstat(cursor)).isSymbolicLink());
    if (cursor === path.dirname(cursor)) break;
  }
}
async function free(port) {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => listener.close(resolve));
}
await plain(path.join(workspace, 'test-results')); await free(3000); await free(8080);
// Reuse the existing real-manager fixture's confined root contract.
const root = path.join(workspace, 'test-results', `m12-real-${randomUUID()}`);
const manager = path.join(root, 'manager'), anchor = path.join(root, 'anchor'), target = path.join(root, 'neoforge-测试');
await mkdir(root); await mkdir(manager); await mkdir(anchor); await mkdir(target);
console.log(`CONFIRMED M21 REGISTRATION BROWSER ROOT: ${root}`);
await writeFile(path.join(anchor, 'server.jar'), jar, { flag: 'wx' });
await writeFile(path.join(anchor, 'eula.txt'), 'eula=false\n', { flag: 'wx' });
await writeFile(path.join(anchor, 'server.properties'), 'server-ip=127.0.0.1\nserver-port=25565\nenable-rcon=false\n', { flag: 'wx' });
for (const file of manifest.files) {
  const destination = path.join(target, file.target), relative = path.relative(target, destination);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  await mkdir(path.dirname(destination), { recursive: true });
  const bytes = await readFile(path.join(manifest.sourceRoot, file.relative)); assert.equal(sha(bytes), file.sha256);
  await writeFile(destination, bytes, { flag: 'wx' });
}
await writeFile(path.join(target, 'server.properties'), 'server-ip=127.0.0.1\nserver-port=25566\nenable-rcon=false\n', { flag: 'wx' });
await writeFile(path.join(target, 'eula.txt'), 'eula=false\n', { flag: 'wx' });
await mkdir(path.join(target, 'world')); await writeFile(path.join(target, 'world/marker.keep'), 'registration must preserve this');
const modBytes = addonZip('META-INF/neoforge.mods.toml', 'modLoader="javafml"\nloaderVersion="[1,)"\n[[mods]]\nmodId="sample"\ndisplayName="示例模组"\nversion="${file.jarVersion}"\n[[mods]]\nmodId="second_mod"\ndisplayName="Second Mod"\nversion="2.0"\n[[dependencies.sample]]\nmodId="minecraft"\nversionRange="[26.3,27)"\ntype="required"\nside="SERVER"\n');
const modFilename = `sample-${'a'.repeat(140)}.jar`;
const incomingBytes = installMods ? addonZip('META-INF/neoforge.mods.toml', 'modLoader="javafml"\nloaderVersion="[1,)"\n[[mods]]\nmodId="incoming_mod"\nversion="${file.jarVersion}"\n[[mods]]\nmodId="another_incoming"\nversion="2.0"\n') : modBytes;
if (readonlyMods) {
  await mkdir(path.join(target, 'mods')); await mkdir(path.join(target, 'disabled-mods'));
  await writeFile(path.join(target, 'mods', modFilename), modBytes, { flag: 'wx' });
  await writeFile(path.join(target, 'disabled-mods', 'disabled.jar'), modBytes, { flag: 'wx' });
}
const configFile = path.join(manager, 'config.json');
await writeFile(configFile, JSON.stringify({ schemaVersion: 1, servers: [{ ...source, id: 'anchor', name: 'Browser anchor', root: anchor, jarFile: 'server.jar' }] }));
const report = { kind: installMods ? 'M3_REAL_PROTECTED_INSTALL_BROWSER' : stagingMods ? 'M3_REAL_VALIDATION_STAGING_BROWSER' : readonlyMods ? 'M3_REAL_READONLY_MODS_BROWSER' : 'M21_NEOFORGE_REAL_REGISTRATION_BROWSER', root: path.basename(root), result: 'BLOCKED', realHTTP: true, routeInterception: false, widths: [], managerSessions: [], staged: [], installs: [], acceptedInstalls: [] };
let worker, vite, browser, context, page, startedManagers = 0; const frontend = [];
const timingEvents = [], timingPending = new Set(); let timingDrops = 0;
function timing(phase, details = {}) {
  if (!timingEnabled) return;
  try {
    if (timingEvents.length >= 2000) { timingDrops++; return; }
    timingEvents.push({ phase, atMs: performance.now(), ...details });
  } catch { timingDrops++; }
}
function timingRequest(request) {
  const url = new URL(request.url());
  if (url.hostname !== '127.0.0.1' || !['3000', '8080'].includes(url.port)) return;
  const server = /^\/api\/v1\/servers\/(neo-(?:360|768|1440))(\/addons(?:\/install)?)?$/u.exec(url.pathname);
  if (server && request.method() === (server[2] === '/addons/install' ? 'POST' : 'GET')) {
    return { family: server[2] === '/addons/install' ? 'install' : server[2] === '/addons' ? 'addons' : 'server', serverId: server[1] };
  }
  const operation = /^\/api\/v1\/operations\/([0-9a-f-]{36})$/u.exec(url.pathname);
  if (operation && request.method() === 'GET') return { family: 'operation', operationId: operation[1] };
}
function observeTimingPage(observedPage) {
  if (!timingEnabled) return;
  observedPage.on('request', request => { try { const info = timingRequest(request); if (info) timing('http-request', info); } catch { timingDrops++; } });
  observedPage.on('requestfinished', request => { try { const info = timingRequest(request); if (info) timing('http-finished', info); } catch { timingDrops++; } });
  observedPage.on('response', response => {
    let info;
    try { info = timingRequest(response.request()); if (!info) return; timing('http-response-observed', { ...info, status: response.status() }); }
    catch { timingDrops++; return; }
    if (!((info.family === 'operation' && response.status() === 200) || (info.family === 'install' && response.status() === 202))) return;
    if (timingPending.size >= 32) { timingDrops++; return; }
    // These two fixed production endpoints have contract/store-bounded operation bodies.
    // No extra request, no raw body/header logging, and no awaited observation on the UI path.
    const task = (async () => {
      const declared = response.headers()['content-length'];
      if (declared !== undefined && (!/^[0-9]+$/u.test(declared) || Number(declared) > 65536)) { timingDrops++; return; }
      const body = await response.body(); if (body.length > 65536) { timingDrops++; return; }
      const decoded = JSON.parse(body.toString('utf8')).data;
      const op = info.family === 'install' ? decoded.operation : decoded;
      if (!/^[0-9a-f-]{36}$/u.test(op.id) || !/^neo-(360|768|1440)$/u.test(op.serverId) || op.kind !== 'addon-change' ||
        !['queued', 'running', 'succeeded', 'failed', 'interrupted'].includes(op.state) ||
        (info.operationId && op.id !== info.operationId) || (info.serverId && op.serverId !== info.serverId)) { timingDrops++; return; }
      timing('operation-body-observed', { family: info.family, operationId: op.id, serverId: op.serverId, state: op.state });
    })().catch(() => { timingDrops++; }).finally(() => timingPending.delete(task));
    timingPending.add(task);
  });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function startManager() {
  worker = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/m12-manager.mjs'], { cwd: workspace, env: { ...process.env, LT_M12_ROOT: root, LT_M12_FORBID_MINECRAFT: '1' }, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  const owned = worker, output = []; owned.stdout.on('data', chunk => { if (output.length < 1000) output.push(chunk.toString()); }); owned.stderr.on('data', chunk => { if (output.length < 1000) output.push(chunk.toString()); });
  owned.once('exit', code => writeFile(path.join(root, `manager-${owned.pid}-${code}.log`), output.join('')).catch(() => {}));
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('manager-ready-deadline')), 30000);
    owned.once('exit', () => { clearTimeout(deadline); reject(new Error('manager-exited-before-ready')); });
    owned.on('message', message => { if (message.type === 'ready') { clearTimeout(deadline); startedManagers++; resolve(); } });
  });
}
async function stopManager() {
  const owned = worker;
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('CLEANUP_BLOCKED: Manager close')), 15000);
    owned.on('message', message => {
      if (message.type === 'closed') report.managerSessions.push(message);
      if (message.type === 'close-blocked') { clearTimeout(deadline); reject(new Error('CLEANUP_BLOCKED')); }
    });
    owned.once('exit', code => { clearTimeout(deadline); code === 0 ? resolve() : reject(new Error(`manager-exit-${code}`)); }); owned.send('close');
  }); worker = undefined;
}
async function observeAcceptedInstallsForCleanup() {
  // Separate cleanup grace period; it cannot change the failed30s business assertion.
  const owner = worker, start = performance.now(), deadline = start + 60000;
  const pending = new Map(report.acceptedInstalls.map(row => [row.operationId, row.serverId]));
  report.cleanupObservation = { result: 'WAITING', elapsedMs: 0, terminalOperations: [] };
  try {
    while (pending.size && performance.now() < deadline) {
      assert(owner === worker && owner.exitCode === null && owner.signalCode === null, 'CLEANUP_BLOCKED: owned Manager unavailable');
      for (const [id, serverId] of pending) {
        const remaining = deadline - performance.now();
        assert(remaining > 0, 'CLEANUP_BLOCKED: operation observation deadline');
        const response = await fetch(`http://127.0.0.1:8080/api/v1/operations/${id}`, { signal: AbortSignal.timeout(Math.max(1, Math.floor(Math.min(2000, remaining)))) });
        assert.equal(response.status, 200, 'CLEANUP_BLOCKED: operation unavailable');
        const operation = (await response.json()).data;
        assert(operation.id === id && operation.serverId === serverId, 'CLEANUP_BLOCKED: operation identity');
        if (['succeeded', 'failed', 'interrupted'].includes(operation.state)) {
          pending.delete(id); report.cleanupObservation.terminalOperations.push({ operationId: id, serverId, state: operation.state });
        }
      }
      if (pending.size) await sleep(Math.min(1000, Math.max(0, deadline - performance.now())));
    }
    assert.equal(pending.size, 0, 'CLEANUP_BLOCKED: operation observation deadline');
    report.cleanupObservation.result = 'TERMINAL_OBSERVED';
  } finally { report.cleanupObservation.elapsedMs = Math.round(performance.now() - start); }
}
async function filesPreserved() {
  for (const file of manifest.files) assert.equal(sha(await readFile(path.join(target, file.target))), file.sha256);
  assert.equal(await readFile(path.join(target, 'world/marker.keep'), 'utf8'), 'registration must preserve this');
  assert.equal(await readFile(path.join(target, 'eula.txt'), 'utf8'), 'eula=false\n');
  assert.equal(await readFile(path.join(target, 'server.properties'), 'utf8'), 'server-ip=127.0.0.1\nserver-port=25566\nenable-rcon=false\n');
  if (readonlyMods) {
    assert((await readFile(path.join(target, 'mods', modFilename))).equals(modBytes));
    assert((await readFile(path.join(target, 'disabled-mods', 'disabled.jar'))).equals(modBytes));
  }
}
try {
  await startManager();
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'apps/web', '--config', 'apps/web/vite.config.ts'], { cwd: workspace, shell: false, windowsHide: true });
  for (const stream of ['stdout', 'stderr']) vite[stream].on('data', chunk => { if (frontend.length < 1000) frontend.push(chunk.toString()); });
  for (let attempt = 0;; attempt++) { try { if ((await fetch('http://127.0.0.1:3000')).ok) break; } catch { /* owned startup */ } assert(attempt < 100); await sleep(100); }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [360, 768, 1440]) {
    context = await browser.newContext({ viewport: { width, height: 950 } }); page = await context.newPage();
    observeTimingPage(page);
    await context.tracing.start({ screenshots: true, snapshots: true });
    await page.goto('http://127.0.0.1:3000/servers');
    await expect(page.getByRole('button', { name: '检查实例' })).toBeEnabled();
    assert.equal((await (await page.request.get('http://127.0.0.1:3000/api/v1/health')).json()).meta.mode, 'local');
    const id = `neo-${width}`, name = `NeoForge ${width}`;
    for (const [label, value] of [['实例标识', id], ['显示名称', name], ['服务端目录', target], ['启动文件名（JAR 或受支持的 run.bat）', 'run.bat']]) await page.getByLabel(label, { exact: true }).fill(value);
    const preview = page.waitForResponse(response => response.url().endsWith('/server-registrations/preflight') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '检查实例' }).click(); const previewResponse = await preview; assert.equal(previewResponse.status(), 200);
    const detected = (await previewResponse.json()).data; assert.equal(detected.server.type, 'neoforge'); assert.equal(detected.server.minecraftVersion, '26.3'); assert.equal(detected.lifecycleSupported, true); assert.equal(detected.eulaAccepted, false);
    await expect(page.getByText(/NEOFORGE · Minecraft 26.3/)).toBeVisible();
    await page.getByRole('checkbox').check();
    const saved = page.waitForResponse(response => response.url().endsWith('/server-registrations') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '保存实例' }).click(); const saveResponse = await saved; assert.equal(saveResponse.status(), 201); assert.equal((await saveResponse.json()).data.loaded, true);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible(); await page.getByLabel('选择服务器实例').selectOption(id);
    await expect(page).toHaveURL(new RegExp(`server=${id}`)); assert(JSON.parse(await readFile(configFile, 'utf8')).servers.some(row => row.id === id && row.jarFile === 'run.bat'));
    if (readonlyMods) {
      const listed = page.waitForResponse(response => response.url().endsWith(`/servers/${id}/addons`) && response.request().method() === 'GET');
      await page.goto(`http://127.0.0.1:3000/addons?server=${id}`);
      const listingResponse = await listed; assert.equal(listingResponse.status(), 200);
      const listing = (await listingResponse.json()).data; assert.equal(listing.writeSupported, false); assert.equal(listing.items.length, 2);
      assert(listing.items.every(item => item.loader === null && item.name === null && item.compatibility === 'unknown' && item.declaredMetadata?.mods.length === 2));
      for (const item of listing.items) assert.deepEqual(item.declaredMetadata.mods[0].dependencies, [{ id: 'minecraft', versionRange: '[26.3,27)', requirement: 'required', side: 'SERVER' }]);
      await expect(page.getByRole('heading', { name: modFilename, exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'disabled.jar', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: '模组文件清单（只读）' })).toBeVisible();
      await expect(page.getByRole('heading', { name: '示例模组', exact: true })).toHaveCount(2);
      await expect(page.getByText('声明版本：未展开：${file.jarVersion}', { exact: true })).toHaveCount(2);
      await expect(page.getByText(/minecraft · 声明范围：\[26.3,27\)/)).toHaveCount(2);
      await expect(page.getByLabel('选择模组 JAR')).toBeVisible();
      await expect(page.getByRole('button', { name: /安装|禁用|启用|回收/ })).toHaveCount(0);
      if (stagingMods) {
        const uploaded = page.waitForResponse(response => response.url().endsWith(`/servers/${id}/addons/uploads`) && response.request().method() === 'POST');
        await page.getByLabel('选择模组 JAR').setInputFiles({ name: 'validated-multiple.jar', mimeType: 'application/java-archive', buffer: incomingBytes });
        const response = await uploaded; assert.equal(response.status(), 201);
        const stage = (await response.json()).data;
        assert.equal(stage.loader, 'neoforge'); assert.equal(stage.compatibility, 'unknown'); assert.equal(stage.executionAvailable, false);
        assert.equal(stage.name, null); assert.equal(stage.version, null); assert.equal(stage.declaredMetadata.mods.length, 2);
        await expect(page.getByRole('heading', { name: '暂存校验通过，尚未安装' })).toBeVisible();
        await expect(page.getByLabel('已校验暂存模组')).toContainText('未展开：${file.jarVersion}');
        const stageRoot = path.join(manager, 'addon-uploads', stage.id);
        assert.equal(sha(await readFile(path.join(stageRoot, 'payload.jar'))), sha(incomingBytes));
        const saved = JSON.parse(await readFile(path.join(stageRoot, 'validated.json'), 'utf8'));
        assert.deepEqual(saved.metadata.declaredMetadata, stage.declaredMetadata);
        assert.equal(saved.adapterIdentity.serverId, id); assert.equal(saved.adapterIdentity.serverType, 'neoforge');
        assert.equal(JSON.parse(await readFile(path.join(stageRoot, 'lifecycle.json'), 'utf8')).state, 'validated');
        report.staged.push({ id: stage.id, serverId: id, checksum: sha(incomingBytes), revision: stage.revision });
        await filesPreserved();
        await page.screenshot({ path: path.join(root, `staged-mods-${width}.png`), fullPage: true });
        if (installMods) {
          await expect(page.getByRole('button', { name: '安装已校验模组' })).toBeEnabled(); await page.getByRole('button', { name: '安装已校验模组' }).click();
          const confirm = page.getByRole('dialog', { name: '确认模组安装' });
          await expect(confirm.getByRole('button', { name: '确认安装' })).toBeDisabled();
          await confirm.getByRole('checkbox', { name: /接受未知兼容性/ }).check();
          const accepted = page.waitForResponse(response => response.url().endsWith(`/servers/${id}/addons/install`) && response.request().method() === 'POST');
          await confirm.getByRole('button', { name: '确认安装' }).click();
          const installedResponse = await accepted; assert.equal(installedResponse.status(), 202);
          const operationId = (await installedResponse.json()).data.operation.id;
          assert(/^[0-9a-f-]{36}$/u.test(operationId));
          report.acceptedInstalls.push({ serverId: id, operationId });
          timing('accepted-observed', { serverId: id, operationId });
          timing('ui-assert-start', { serverId: id, operationId });
          try {
            await expect(page.getByText('安装文件已核验，需要之后手动启动或重启才会加载。管理器未自动启动服务器。')).toBeVisible({ timeout: 30000 });
            timing('ui-assert-passed', { serverId: id, operationId });
          } catch (error) { timing('ui-assert-failed', { serverId: id, operationId }); throw error; }
          assert.equal(sha(await readFile(path.join(target, 'mods/validated-multiple.jar'))), sha(incomingBytes));
          const stageState = JSON.parse(await readFile(path.join(stageRoot, 'lifecycle.json'), 'utf8')); assert.equal(stageState.state, 'consumed');
          assert.equal(JSON.parse(await readFile(path.join(stageRoot, 'consumed.json'), 'utf8')).operationId, operationId);
          report.installs.push({ serverId: id, operationId, result: 'PASS', checksum: sha(incomingBytes) });
          await filesPreserved(); await page.screenshot({ path: path.join(root, `installed-mods-${width}.png`), fullPage: true });
        }
      }
      await page.getByLabel('搜索文件名、模组名称或标识').fill('second_mod'); await expect(page.getByRole('heading', { name: modFilename, exact: true })).toBeVisible();
      await page.getByLabel('搜索文件名、模组名称或标识').fill('no-match'); await expect(page.getByText('没有匹配的文件。')).toBeVisible();
      await page.getByLabel('搜索文件名、模组名称或标识').fill('');
      const refreshed = page.waitForResponse(response => response.url().endsWith(`/servers/${id}/addons`));
      await page.getByRole('button', { name: '刷新清单' }).click(); assert.equal((await refreshed).status(), 200);
      const bounds = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth })); assert(bounds.document <= bounds.viewport + 1);
      await page.screenshot({ path: path.join(root, `readonly-mods-${width}.png`), fullPage: true });
      await page.goto(`http://127.0.0.1:3000/servers?server=${id}`); await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    }
    await stopManager(); await startManager(); await page.reload(); await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    if (stagingMods) {
      const staged = report.staged.at(-1), directory = path.join(manager, 'addon-uploads', staged.id);
      assert.equal(sha(await readFile(path.join(directory, 'payload.jar'))), staged.checksum);
      assert.equal(JSON.parse(await readFile(path.join(directory, 'validated.json'), 'utf8')).revision, staged.revision);
      assert.equal(JSON.parse(await readFile(path.join(directory, 'lifecycle.json'), 'utf8')).state, installMods ? 'consumed' : 'validated');
      if (installMods) {
        assert.equal(sha(await readFile(path.join(target, 'mods/validated-multiple.jar'))), staged.checksum);
        const state = await page.request.get(`http://127.0.0.1:8080/api/v1/servers/${id}`); assert.equal(state.status(), 200);
        const status = (await state.json()).data.status; assert.equal(status.state, 'stopped'); assert.equal(status.recoveryRequired, false);
        const op = await page.request.get(`http://127.0.0.1:8080/api/v1/operations/${report.installs.at(-1).operationId}`);
        assert.equal(op.status(), 200); assert.equal((await op.json()).data.state, 'succeeded');
      }
    }
    await expect(page.getByLabel('选择服务器实例')).toHaveValue(id);
    const card = page.locator('.server-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await card.getByRole('button', { name: '移除服务器', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `移除 ${name}` }); await expect(dialog).toContainText('不删除服务端目录');
    const removed = page.waitForResponse(response => response.url().endsWith(`/server-registrations/${id}`) && response.request().method() === 'DELETE');
    await dialog.getByRole('button', { name: '确认移除' }).click(); assert.equal((await removed).status(), 200);
    await expect(card).toHaveCount(0); await expect(page.getByLabel('选择服务器实例')).toHaveValue('anchor');
    assert.deepEqual(JSON.parse(await readFile(configFile, 'utf8')).servers.map(row => row.id), ['anchor']); await filesPreserved();
    await stopManager(); await startManager(); await page.reload(); await expect(page.getByRole('button', { name: '检查实例' })).toBeEnabled(); await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth })); assert(dimensions.document <= dimensions.viewport + 1);
    await page.screenshot({ path: path.join(root, `neoforge-${width}.png`), fullPage: true });
    report.widths.push({ width, result: 'PASS', immediatelyLoaded: true, restartConsistent: true, filesPreserved: true });
    if (installMods) {
      // Only remove our verified inert JAR from this isolated fixture after registration removal.
      const testArtifact = path.join(target, 'mods/validated-multiple.jar'); assert.equal(sha(await readFile(testArtifact)), sha(incomingBytes)); await unlink(testArtifact);
    }
    await context.tracing.stop({ path: path.join(root, `neoforge-${width}-trace.zip`) }); await context.close(); context = undefined;
  }
  report.result = 'PASS';
} catch (error) { report.errorCode = error.code ?? 'NO_EXPLICIT_ERROR_CODE'; report.error = String(error.message); await page?.screenshot({ path: path.join(root, 'failure.png'), fullPage: true }).catch(() => {}); }
finally {
  if (timingEnabled && context) {
    try { await context.tracing.stop({ path: path.join(root, 'completion-failure-trace.zip') }); report.failureTrace = 'SAVED'; }
    catch { report.failureTrace = 'SAVE_FAILED'; }
  }
  try { await context?.close(); await browser?.close(); } catch { report.result = 'BLOCKED'; }
  if (installMods && worker && report.result !== 'PASS' && report.acceptedInstalls.length) {
    try { await observeAcceptedInstallsForCleanup(); }
    catch { report.cleanup = 'CLEANUP_BLOCKED'; report.result = 'BLOCKED'; report.cleanupObservation.result = 'CLEANUP_BLOCKED'; }
  }
  try { if (worker) await stopManager(); } catch { report.cleanup = 'CLEANUP_BLOCKED'; report.result = 'BLOCKED'; }
  if (vite && vite.exitCode === null && vite.signalCode === null) {
    try { await new Promise((resolve, reject) => { const deadline = setTimeout(() => reject(new Error('owned-vite-close-deadline')), 10000); vite.once('close', () => { clearTimeout(deadline); resolve(); }); if (!vite.kill()) { clearTimeout(deadline); reject(new Error('owned-vite-close-unconfirmed')); } }); }
    catch { report.cleanup = 'CLEANUP_BLOCKED'; report.result = 'BLOCKED'; }
  }
  report.startedManagers = startedManagers;
  report.noMinecraftLaunch = startedManagers > 0 && report.managerSessions.length === startedManagers && report.managerSessions.every(session => session.children.length === 0 && session.launchAttempts === 0);
  report.addonMutationRequests = report.managerSessions.flatMap(session => session.requests).filter(request => request.path.includes('/addons') && request.method !== 'GET').length;
  const addonWrites = report.managerSessions.flatMap(session => session.requests).filter(request => request.path.includes('/addons') && request.method !== 'GET');
  report.forbiddenAddonMutations = addonWrites.filter(request => !(stagingMods && request.method === 'POST' && request.path.endsWith('/addons/uploads') && request.status === 201) &&
    !(installMods && request.method === 'POST' && request.path.endsWith('/addons/install') && request.status === 202)).length;
  if (stagingMods ? report.staged.length !== 3 || addonWrites.length !== (installMods ? 6 : 3) || report.forbiddenAddonMutations !== 0 || (installMods && report.installs.length !== 3) : readonlyMods && report.addonMutationRequests !== 0) report.result = 'BLOCKED';
  try { report.sourceInputsUnchanged = JSON.stringify(await neoForgeSourcePreflight()) === JSON.stringify(manifest) && sha(await readFile(path.join(source.root, source.jarFile))) === auth.observedJarSha256; }
  catch { report.sourceInputsUnchanged = false; report.sourceRecheckError = 'SOURCE_RECHECK_FAILED'; }
  try { await free(3000); await free(8080); report.portsReleased = true; } catch { report.portsReleased = false; }
  if (!report.noMinecraftLaunch || !report.sourceInputsUnchanged || !report.portsReleased) report.result = 'BLOCKED';
  if (timingEnabled) {
    let timer;
    await Promise.race([Promise.allSettled([...timingPending]), new Promise(resolve => { timer = setTimeout(resolve, 3000); })]); clearTimeout(timer);
    report.diagnosticOnly = true; report.deliveryAcceptance = 'NOT_ELIGIBLE_TIMING_RUN';
    report.timing = { clock: 'harness-node-performance', observation: 'callbacks and assertion-visible confirmation, not wire arrival or first paint',
      dropped: timingDrops, pendingAtSave: timingPending.size, events: timingEvents };
  }
  await writeFile(path.join(root, 'vite.log'), frontend.join('')); await writeFile(path.join(root, 'm21-report.json'), JSON.stringify(report, null, 2));
  console.log(`${report.result}: ${root}`); process.exitCode = report.result === 'PASS' ? 0 : 1;
}
