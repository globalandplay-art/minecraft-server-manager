// Synthetic real-browser P5.4 flow. Uses contract-shaped HTTP fixtures and never launches Java.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { chromium, expect } from '@playwright/test';
import { cleanupBrowserHelpers } from './phase35-browser-cleanup.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const installedAddonName = 'Validated Addon';
async function until(check, label, duration = 30000) {
  const end = Date.now() + duration;
  while (Date.now() < end) {
    if (await check()) return;
    await wait(100);
  }
  throw new Error(label);
}
async function freeLoopbackPort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve); });
  const address = socket.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => socket.close(resolve));
  assert(port > 0);
  return port;
}
async function assertPortFree(port) {
  const socket = net.createServer();
  try { await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen({ host: '127.0.0.1', port, exclusive: true }, resolve); }); }
  finally { if (socket.listening) await new Promise((resolve) => socket.close(resolve)); }
}
function startVite(port) {
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'apps/web', '--config', 'apps/web/vite.config.ts', '--port', String(port), '--strictPort'], {
    shell: false, windowsHide: true, env: process.env,
  });
  const helper = { child, closed: false, error: null, output: '' };
  child.once('error', (error) => { helper.error = error; });
  child.once('close', () => { helper.closed = true; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
    helper.output += chunk.toString();
    if (helper.output.length > 8 * 1024 ** 2) {
      helper.error = new Error('HELPER_CAPTURE_OVERFLOW');
      child.kill('SIGTERM');
    }
  });
  return helper;
}
async function viteReady(helper, port) {
  await until(async () => {
    if (helper.error) throw helper.error;
    if (helper.closed) throw new Error('VITE_HELPER_EARLY_EXIT');
    try { return (await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1500) })).ok; }
    catch { return false; }
  }, 'Vite did not become ready');
}

function envelope(data) { return { data, meta: { requestId: 'p54-synthetic', generatedAt: new Date().toISOString(), mode: 'local' } }; }
function makeFixture(type) {
  const id = `p54-${type}`;
  let revision = 'a'.repeat(64);
  let itemId = 'b'.repeat(64);
  let state = 'enabled';
  let items = [{ id: itemId, kind: type === 'paper' ? 'plugin' : 'mod', state, filename: 'private-addon.jar', sizeBytes: 512,
    sha256: 'c'.repeat(64), name: 'Acceptance Addon', version: '1.2.3', loader: type, compatibility: 'unknown',
    minecraftConstraint: ['26.2'], metadataStatus: 'parsed' }];
  let trash = [];
  let staged;
  const requests = [];
  const info = { id, name: `P5.4 ${type} test`, type, minecraftVersion: '26.2', java: { runtimeVersion: '25', requiredMajor: 25 },
    detection: { confidence: 'high', evidence: ['synthetic-fixture'], warnings: [] } };
  const caps = { mods: type === 'fabric', plugins: type === 'paper', rcon: false, console: true, backup: true, worlds: true, properties: true };
  const summary = () => ({ server: info, capabilities: caps,
    status: { state: 'stopped', ownership: 'none', source: 'process', observedAt: new Date().toISOString(), activeOperationId: null, recoveryRequired: false },
    readiness: { start: { allowed: true, reason: null }, stop: { allowed: false, reason: 'state-stopped' }, restart: { allowed: false, reason: 'state-stopped' },
      commands: { allowed: false, reason: 'state-stopped' }, backup: { allowed: true, reason: null }, restore: { allowed: true, reason: null },
      worldChanges: { allowed: true, reason: null }, addonChanges: { allowed: true, reason: null }, propertiesChanges: { allowed: false, reason: 'feature-not-implemented' }, commandTransport: 'unavailable' } });
  const addonData = () => ({ items, revision, writeSupported: true });
  const trashData = () => ({ items: trash, revision });
  let operationNumber = 0;
  let operation = { id: `p54-operation-${operationNumber}`, serverId: id, kind: 'addon-change', state: 'succeeded', step: 'completed', progress: 100,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), result: { resourceId: itemId, rollbackAvailable: false, restartRequired: true }, error: null };
  const lifecycle = () => envelope({ operation });

  async function handle(route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname.replace('/api/v1', '');
    requests.push({ method, path, headers: request.headers(), body: request.postData() });
    const reply = async (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (method === 'GET' && path === '/health') {
      const features = Object.fromEntries(['dashboard', 'servers', 'lifecycle', 'console', 'worlds', 'backups', 'players', 'properties', 'addons', 'performance', 'crashAnalysis', 'remoteAccess']
        .map((name) => [name, { implemented: true, phase: name === 'addons' ? 5 : 1 }]));
      return reply(200, envelope({ status: 'ok', apiVersion: '1', features }));
    }
    if (method === 'GET' && path === '/servers') return reply(200, envelope({ items: [summary()] }));
    if (method === 'GET' && path === `/servers/${id}`) return reply(200, envelope(summary()));
    if (method === 'GET' && path === `/servers/${id}/addons`) return reply(200, envelope(addonData()));
    if (method === 'GET' && path === `/servers/${id}/addons/trash`) return reply(200, envelope(trashData()));
    if (method === 'POST' && path === `/servers/${id}/addons/uploads`) {
      assert.equal(request.headers()['content-type'], 'application/java-archive');
      assert.equal(decodeURIComponent(request.headers()['x-upload-filename']), 'acceptance.jar');
      assert((request.postDataBuffer()?.length ?? 0) > 0);
      staged = { id: 'e5cbbfa0-836a-4f57-a8b8-1a6772947c01', kind: type === 'paper' ? 'plugin' : 'mod', filename: 'private-stage.jar',
        sizeBytes: 512, checksumSha256: 'd'.repeat(64), revision, name: installedAddonName, version: '2.0.0', loader: type,
        minecraftConstraint: ['26.2'], state: 'validated', executionAvailable: false };
      return reply(201, envelope(staged));
    }
    const mutation = method === 'POST' && path.match(new RegExp(`^/servers/${id}/addons/(install|[a-f0-9]{64}/(?:disable|enable|trash)|trash/[0-9a-f-]+/restore)$`));
    if (mutation) {
      assert.equal(request.headers()['x-manager-intent'], 'local-ui');
      assert(request.headers()['idempotency-key']);
      const action = mutation[1];
      const body = request.postDataJSON();
      if (action === 'install') {
        assert.equal(body.uploadId, staged?.id);
        assert.equal(body.uploadRevision, revision);
        assert.equal(body.inventoryRevision, revision);
        itemId = 'f'.repeat(64);
        items = [{ id: itemId, kind: staged.kind, state: 'enabled', filename: 'private-installed.jar', sizeBytes: staged.sizeBytes,
          sha256: staged.checksumSha256, name: staged.name, version: staged.version, loader: type, compatibility: 'unknown',
          minecraftConstraint: ['26.2'], metadataStatus: 'parsed' }];
        staged = undefined;
      } else {
        assert.equal(body.revision, revision);
        if (action.endsWith('/disable')) items = items.map((item) => ({ ...item, state: 'disabled' }));
        if (action.endsWith('/enable')) items = items.map((item) => ({ ...item, state: 'enabled' }));
        if (action.endsWith('/trash')) { trash = [{ id: 'c0985a8b-c7e1-4dad-bae2-2e6ca36a5b8f', addonId: itemId, kind: items[0].kind,
          filename: 'private-trash.jar', originalState: items[0].state, sizeBytes: items[0].sizeBytes, sha256: items[0].sha256,
          name: items[0].name, version: items[0].version, loader: type, compatibility: 'unknown', minecraftConstraint: ['26.2'],
          metadataStatus: 'parsed', createdAt: new Date().toISOString(), restoreAllowed: true }]; items = []; }
        if (action.includes('/restore')) {
          const receipt = trash[0];
          items = [{
            id: receipt.addonId,
            kind: receipt.kind,
            state: receipt.originalState,
            filename: receipt.filename,
            sizeBytes: receipt.sizeBytes,
            sha256: receipt.sha256,
            name: receipt.name,
            version: receipt.version,
            loader: receipt.loader,
            compatibility: receipt.compatibility,
            minecraftConstraint: receipt.minecraftConstraint,
            metadataStatus: receipt.metadataStatus,
          }];
          trash = [];
        }
      }
      operationNumber += 1;
      operation = { ...operation, id: `p54-operation-${operationNumber}`, updatedAt: new Date().toISOString() };
      revision = revision === 'a'.repeat(64) ? 'e'.repeat(64) : '9'.repeat(64);
      return reply(202, lifecycle());
    }
    if (method === 'GET' && path === `/operations/${operation.id}`) return reply(200, envelope(operation));
    if (method === 'POST' && /\/actions\/(start|stop|restart)$/.test(path)) {
      requests.push({ forbiddenLifecycleMutation: path });
      return reply(500, envelope({ error: { code: 'UNEXPECTED_LIFECYCLE_CALL', message: 'P5.4 must not change server lifecycle' } }));
    }
    return reply(404, envelope({ error: { code: 'FIXTURE_NOT_FOUND', message: `${method} ${path}` } }));
  }
  return { id, requests, handle };
}

const report = { result: 'NOT_RUN', browser: 'BLOCKED', viewports: [], helpersClosed: false, portsFree: false, cleanupErrors: [], failure: null };
let vite, browserServer, browser, deadline, port;
await mkdir('test-results/p54-evidence', { recursive: true });
try {
  port = await freeLoopbackPort();
  report.port = port;
  vite = startVite(port);
  await viteReady(vite, port);
  browserServer = await chromium.launchServer({ channel: 'chrome', headless: true, timeout: 30000 });
  browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 30000 });

  const flow = async () => {
    for (const [width, type] of [[360, 'paper'], [768, 'fabric'], [1440, 'paper']]) {
      const fixture = makeFixture(type);
      const context = await browser.newContext({ viewport: { width, height: 900 }, baseURL: `http://127.0.0.1:${port}` });
      await context.route('**/api/v1/**', (route) => fixture.handle(route));
      try {
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.goto(`/addons?server=${fixture.id}`);
        await expect(page.getByRole('heading', { name: type === 'paper' ? 'Plugins' : 'Mods' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Acceptance Addon' })).toBeVisible();
        assert.equal(await page.getByText('private-addon.jar').count(), 0);
        assert.equal(await page.locator('body').innerText().then((text) => /(?:[A-Z]:\\|\/home\/|managerRoot|stagingPath|\.manager)/iu.test(text)), false);

        await page.getByLabel('选择扩展 JAR 文件').setInputFiles({ name: 'acceptance.jar', mimeType: 'application/java-archive', buffer: Buffer.from('synthetic-addon-jar') });
        await expect.poll(() => fixture.requests.some((request) => request.method === 'POST' && request.path.endsWith('/addons/uploads'))).toBe(true);
        await page.screenshot({ path: 'test-results/p54-upload-debug.png', fullPage: true });
        await expect(page.getByText('Ready to install')).toBeVisible();
        await expect(page.getByText('Validated Addon')).toBeVisible();
        await page.getByRole('button', { name: '安装扩展' }).click();
        const dialog = page.getByRole('alertdialog');
        await expect(dialog).toContainText(type === 'paper' ? 'Paper' : 'Fabric');
        await expect(dialog).toContainText('需要重启');
        await dialog.getByRole('button', { name: '确认操作' }).click();
        await expect(page.getByRole('status').filter({ hasText: '操作完成' })).toBeVisible();
        await expect(page.getByText('管理器不会自动重启服务器')).toBeVisible();

        await page.getByRole('button', { name: '禁用' }).click();
        await page.getByRole('alertdialog').getByRole('button', { name: '确认操作' }).click();
        await expect(page.getByRole('button', { name: '启用' })).toBeVisible();
        await page.getByRole('button', { name: '启用' }).click();
        await page.getByRole('alertdialog').getByRole('button', { name: '确认操作' }).click();
        await expect(page.getByRole('button', { name: '禁用' })).toBeVisible();
        await page.getByRole('button', { name: '移到回收区' }).click();
        await expect(page.getByRole('alertdialog')).toContainText('可恢复');
        await page.getByRole('alertdialog').getByRole('button', { name: '确认操作' }).click();
        await expect(page.getByText('回收区为空。')).toHaveCount(0);
        await page.getByRole('button', { name: '恢复' }).click();
        await page.getByRole('alertdialog').getByRole('button', { name: '确认操作' }).click();
        await expect(page.getByRole('heading', { name: installedAddonName })).toBeVisible();
        await expect(page.getByText('扩展变更已完成，需要重启才能生效。管理器不会自动重启服务器。')).toBeVisible();
        assert.equal(fixture.requests.filter((request) => request.forbiddenLifecycleMutation).length, 0);
        const addonPostPaths = fixture.requests
          .filter((request) => request.method === 'POST' && request.path.startsWith(`/servers/${fixture.id}/addons/`))
          .map((request) => request.path);
        const expectedAddonPostPaths = [
          `/servers/${fixture.id}/addons/uploads`,
          `/servers/${fixture.id}/addons/install`,
          `/servers/${fixture.id}/addons/${'f'.repeat(64)}/disable`,
          `/servers/${fixture.id}/addons/${'f'.repeat(64)}/enable`,
          `/servers/${fixture.id}/addons/${'f'.repeat(64)}/trash`,
          `/servers/${fixture.id}/addons/trash/c0985a8b-c7e1-4dad-bae2-2e6ca36a5b8f/restore`,
        ];
        for (const path of expectedAddonPostPaths) {
          assert.equal(addonPostPaths.filter((actualPath) => actualPath === path).length, 1, `expected one POST to ${path}`);
        }
        assert.equal(addonPostPaths.length, 6);
        assert.deepEqual([...addonPostPaths].sort(), [...expectedAddonPostPaths].sort());
        assert.deepEqual(pageErrors, []);
        assert((await page.evaluate(() => document.documentElement.scrollWidth)) <= width + 1, `horizontal overflow at ${width}px`);
        await page.screenshot({ path: `test-results/p54-addons-${width}.png`, fullPage: true });
        report.viewports.push({ width, type, result: 'PASS' });
        console.log(`PASS: P5.4 ${type} addon browser flow at ${width}px`);
      } finally { await context.close(); }
    }
    report.browser = 'PASS';
    report.result = 'PASS';
  };
  await Promise.race([flow(), new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('BROWSER_FLOW_DEADLINE_EXCEEDED')), 180000); })]);
} catch (error) {
  report.failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  throw error;
} finally {
  clearTimeout(deadline);
  try {
    await cleanupBrowserHelpers({ browser, browserServer, vite: vite?.child, helperPort: port,
      helperClosed: () => !vite || vite.closed, helperError: vite?.error, helperLog: vite?.output ?? '',
      report, evidenceRoot: 'test-results/p54-evidence', wait });
  } catch (error) { report.cleanupErrors.push(String(error)); }
  if (vite && !vite.closed) {
    try { vite.child.kill('SIGTERM'); await until(() => vite.closed, 'Vite helper did not close', 10000); }
    catch (error) { report.cleanupErrors.push(String(error)); }
  }
  report.helpersClosed = (!vite || vite.closed) && report.browserHelper?.closed !== false;
  try { await assertPortFree(port); report.portsFree = true; }
  catch (error) { report.cleanupErrors.push(String(error)); }
  if (report.cleanupErrors.length || !report.helpersClosed || !report.portsFree) report.result = 'BLOCKED';
  await writeFile('test-results/p54-addons-browser-report.json', JSON.stringify(report, null, 2));
  assert.deepEqual(report.cleanupErrors, []);
  assert.equal(report.helpersClosed, true);
  assert.equal(report.portsFree, true);
}
console.log(JSON.stringify(report, null, 2));
