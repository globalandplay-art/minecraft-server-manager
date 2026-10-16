import path from 'node:path';
import { randomUUID } from 'node:crypto';
const evidenceRoot = path.resolve('test-results', 'lc2-browser-' + randomUUID());
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
  child.on('message', message => { if (message === 'LC2_CLEANUP_COMPLETE') helper.cleanupComplete = true; });
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
  api = owned(['--import', 'tsx', 'tests/e2e/fixtures/lc2-api.ts'], process.execPath, true);
  await ready('http://127.0.0.1:8080/api/v1/auth/status');
  vite = owned(['node_modules/vite/bin/vite.js', 'apps/web', '--config', 'apps/web/vite.config.ts']);
  await ready('http://127.0.0.1:3000');
  browserServer = await chromium.launchServer({ channel: 'chrome', headless: true, timeout: 30000 });
  browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 30000 });

  const flow = async () => {
    for (const width of [360, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, baseURL: 'http://127.0.0.1:3000' });
      try {
        const page = await context.newPage(); const mutations = [];
        page.on('request', request => { if (request.url().includes('/api/v1/servers/') && !['GET', 'HEAD'].includes(request.method())) mutations.push(request.method()); });
        await page.goto(`/settings?server=props-${width}`);
        await page.getByLabel('账号', { exact: true }).fill('fixture-admin');
        await page.getByLabel('密码', { exact: true }).fill('LC2_SYNTHETIC_LOGIN_ONLY');
        await page.getByRole('button', { name: '登录', exact: true }).click();
        await page.getByRole('link', { name: '查看白名单成员' }).click();
        await expect(page.getByText('Player_One', { exact: true })).toBeVisible();
        await expect(page.getByText('运行时是否生效：未核验')).toBeVisible();
        const refreshed = page.waitForResponse(response => response.url().endsWith(`/api/v1/servers/props-${width}/whitelist`) && response.request().method() === 'GET');
        await page.getByRole('button', { name: '刷新白名单' }).click();
        assert.equal((await (await refreshed).json()).data.availability, 'available');
        await expect(page.getByRole('button', { name: '刷新白名单' })).toBeEnabled();
        await expect(page.getByText('Player_One', { exact: true })).toBeVisible();
        const response = await context.request.get(`/api/v1/servers/props-${width}/whitelist`);
        assert.equal(response.status(), 200); const data = (await response.json()).data;
        assert.equal(data.availability, 'available'); assert.equal(data.effectiveEnabled, null);
        assert.equal(data.membershipWritable, false); assert.equal(data.items.length, 1);
        assert.equal(data.items[0].name, 'Player_One'); assert.deepEqual(mutations, []);
        assert.equal((await page.content()).includes('P43_FIXTURE_SENTINEL'), false);
        assert((await page.evaluate(() => document.documentElement.scrollWidth)) <= width + 1);
        await page.screenshot({ path: `${evidenceRoot}/whitelist-${width}.png`, fullPage: true });
        console.log(`PASS: Whitelist ${width}px synthetic authenticated readonly HTTP/Chrome`);
      } finally { await context.close(); }
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
      if (!api.closed && api.child.connected) api.child.send('LC2_SHUTDOWN');
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
