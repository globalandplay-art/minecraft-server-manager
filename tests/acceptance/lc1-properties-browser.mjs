import path from 'node:path';
import { randomUUID } from 'node:crypto';
const evidenceRoot = path.resolve('test-results', 'lc1-browser-' + randomUUID());
// Real HTTP and Chrome against three isolated synthetic Vanilla fixtures. Never launches Java.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { assertHTTPPortsFree } from './phase35-browser-flow.mjs';
import { cleanupBrowserHelpers } from './phase35-browser-cleanup.mjs';

const helpers = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, duration = 30000) {
  const end = Date.now() + duration;
  while (Date.now() < end) {
    if (await check()) return;
    await pause(100);
  }
  throw new Error(label);
}
function owned(args, executable = process.execPath, fixture = false) {
  const child = spawn(executable, args, { shell: false, windowsHide: true,
    stdio: fixture ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MCSM_P43_SYNTHETIC: '1' } });
  const helper = { child, closed: false, output: '', error: null, exitCode: null, exitSignal: null, cleanupComplete: false };
  helpers.push(helper);
  child.once('error', (error) => { helper.error = error; });
  child.once('close', (code, signal) => { helper.closed = true; helper.exitCode = code; helper.exitSignal = signal; });
  child.on('message', message => { if (message === 'LC1_CLEANUP_COMPLETE') helper.cleanupComplete = true; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
    helper.output += chunk.toString();
    if (helper.output.length > 8 * 1024 ** 2) {
      helper.error = new Error('HELPER_CAPTURE_OVERFLOW');
      child.kill('SIGTERM');
    }
  });
  return helper;
}
async function ready(url) {
  await until(async () => {
    for (const helper of helpers) {
      if (helper.error) throw helper.error;
      if (helper.closed) throw new Error('HELPER_EARLY_EXIT');
    }
    try { return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok; }
    catch { return false; }
  }, `Readiness failed: ${url}`);
}

const report = {
  realAcceptance: 'NOT_RUN', browser: 'BLOCKED', helpersClosed: false, httpPortsFree: false,
  cleanupErrors: [], failure: null, browserHelper: { cleanupErrors: [], closed: false },
};
let browserServer, browser, vite, api, flowTimer;
await mkdir(path.join(evidenceRoot, 'evidence'), { recursive: true });
try {
  await assertHTTPPortsFree();
  api = owned(['--import', 'tsx', 'tests/e2e/fixtures/lc1-api.ts'], process.execPath, true);
  await ready('http://127.0.0.1:8080/api/v1/auth/status');
  vite = owned(['node_modules/vite/bin/vite.js', 'apps/web', '--config', 'apps/web/vite.config.ts']);
  await ready('http://127.0.0.1:3000');
  browserServer = await chromium.launchServer({ channel: 'chrome', headless: true, timeout: 30000 });
  browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 30000 });

  const flow = async () => {
    for (const width of [360, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, baseURL: 'http://127.0.0.1:3000' });
      try {
        const page = await context.newPage();
        await page.goto(`/settings?server=props-${width}`);
        await page.getByLabel('账号', { exact: true }).fill('fixture-admin');
        await page.getByLabel('密码', { exact: true }).fill('LC1_SYNTHETIC_LOGIN_ONLY');
        await page.getByRole('button', { name: '登录', exact: true }).click();
        await expect(page.getByRole('combobox', { name: '玩家对战' })).toHaveValue('true');
        for (const name of ['游戏玩法', '玩家管理', '性能', '其他设置']) await expect(page.getByRole('region', { name })).toBeVisible();
        await expect(page.locator('#property-white-list')).toContainText('未提供');
        await expect(page.locator('#property-enforce-whitelist')).toContainText('只读');
        await page.getByRole('combobox', { name: '玩家对战' }).selectOption('false');
        await expect(page.getByText('当前值：启用 · 待修改值：关闭')).toBeVisible();
        await expect(page.getByRole('checkbox', { name: /确认以上变更/ })).toBeVisible();
        await page.getByRole('checkbox', { name: /确认以上变更/ }).check();
        await page.getByRole('button', { name: '备份并保存配置' }).click();
        await expect(page.getByRole('status').filter({ hasText: '配置已保存。需要重启' })).toBeVisible();

        const response = await context.request.get(`/api/v1/servers/props-${width}/properties`);
        assert.equal(response.status(), 200);
        const responseText = await response.text();
        assert.equal(JSON.parse(responseText).data.fields.pvp, false);
        assert.equal(responseText.includes('P43_FIXTURE_SENTINEL'), false);
        assert.equal((await page.content()).includes('P43_FIXTURE_SENTINEL'), false);
        assert.equal(await page.locator('#property-view-distance').evaluate((node) => /^(INPUT|SELECT)$/.test(node.tagName)), false);
        assert.equal(await page.locator('#property-simulation-distance').evaluate((node) => /^(INPUT|SELECT)$/.test(node.tagName)), false);
        assert((await page.evaluate(() => document.documentElement.scrollWidth)) <= width + 1);
        await page.screenshot({ path: `${evidenceRoot}/properties-${width}.png`, fullPage: true });
        console.log(`PASS: Properties ${width}px synthetic HTTP/Chrome`);
      } finally {
        await context.close();
      }
    }
  };
  await Promise.race([flow(), new Promise((_, reject) => {
    flowTimer = setTimeout(() => reject(new Error('BROWSER_FLOW_DEADLINE_EXCEEDED')), 180000);
  })]);
  report.browser = 'SYNTHETIC_PASS';
} catch (error) {
  report.failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  throw error;
} finally {
  clearTimeout(flowTimer);
  try {
    await cleanupBrowserHelpers({ browser, browserServer, vite: vite?.child,
      helperClosed: () => !vite || vite.closed, helperError: vite?.error, helperLog: vite?.output ?? '',
      report, evidenceRoot: path.join(evidenceRoot, 'evidence'), wait: pause });
  } catch (error) { report.cleanupErrors.push(String(error)); }
  if (api) {
    try {
      if (!api.closed && api.child.connected) api.child.send('LC1_SHUTDOWN');
      await until(() => api.closed, 'CLEANUP_BLOCKED: fixture did not close', 10000);
      if (!api.cleanupComplete || api.exitCode !== 0 || api.exitSignal !== null) throw new Error('CLEANUP_BLOCKED: no successful fixture acknowledgement');
    } catch (error) { report.cleanupErrors.push(String(error)); }
    report.fixtureCleanup = { acknowledged: api.cleanupComplete, exitCode: api.exitCode, exitSignal: api.exitSignal };
  }
  for (const helper of helpers.slice().reverse()) {
    try {
      if (!helper.closed) helper.child.kill('SIGTERM');
      await until(() => helper.closed, 'Owned helper did not close', 10000);
    } catch (error) { report.cleanupErrors.push(String(error)); }
  }
  for (const [index, helper] of helpers.entries()) {
    await writeFile(`${evidenceRoot}/helper-${index}.log`, helper.output);
  }
  report.helpersClosed = helpers.every((helper) => helper.closed) && report.browserHelper.closed;
  if (!report.helpersClosed) report.cleanupErrors.push('HELPERS_NOT_CLOSED');
  try { await assertHTTPPortsFree(); report.httpPortsFree = true; }
  catch (error) { report.cleanupErrors.push(String(error)); }
  if (report.cleanupErrors.length) report.browser = 'BLOCKED';
  await writeFile(path.join(evidenceRoot, 'report.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(report.cleanupErrors, []);
}
console.log(JSON.stringify(report));
