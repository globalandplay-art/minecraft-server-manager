// Real HTTP/Chrome, synthetic list transport. Never launches Java or reads worlds.
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
  while (Date.now() < end) { if (await check()) return; await pause(100); }
  throw new Error(label);
}
function owned(args, executable = process.execPath) {
  const child = spawn(executable, args, { shell: false, windowsHide: true,
    env: { ...process.env, MCSM_PLAYERS_EXTERNAL: '1' } });
  const helper = { child, closed: false, output: '', error: null }; helpers.push(helper);
  child.once('error', (error) => { helper.error = error; });
  child.once('close', () => { helper.closed = true; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
    helper.output += chunk.toString();
    if (helper.output.length > 8 * 1024 ** 2) {
      helper.error = new Error('HELPER_CAPTURE_OVERFLOW'); child.kill('SIGTERM');
    }
  });
  return helper;
}
async function ready(url) {
  await until(async () => {
    for (const helper of helpers) { if (helper.error) throw helper.error; if (helper.closed) throw new Error('HELPER_EARLY_EXIT'); }
    try { return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
  }, `Readiness failed: ${url}`);
}
const report = { realAcceptance: 'NOT_RUN', browser: 'BLOCKED', helpersClosed: false, httpPortsFree: false, cleanupErrors: [], browserHelper: { cleanupErrors: [], closed: false } };
let browserServer, browser, vite, flowTimer;
await mkdir('test-results', { recursive: true });
try {
  await assertHTTPPortsFree();
  owned(['--import', 'tsx', 'tests/e2e/fixtures/phase41-api.ts']); await ready('http://127.0.0.1:8080/api/v1/health');
  if (process.env.MCSM_P41_SPAWN_FAILURE === '1') {
    owned([], `${process.execPath}.p41-missing-executable`);
    await ready('http://127.0.0.1:3000');
    throw new Error('Expected spawn failure was not observed');
  }
  vite = owned(['node_modules/vite/bin/vite.js', 'apps/web', '--config', 'apps/web/vite.config.ts']); await ready('http://127.0.0.1:3000');
  browserServer = await chromium.launchServer({ channel: 'chrome', headless: true, timeout: 30000 });
  browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 30000 });
  const flow = async () => { for (const width of [360, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, baseURL: 'http://127.0.0.1:3000' });
    const page = await context.newPage();
    await page.goto(`/players?server=players-names-${width}`);
    await expect(page.getByText('Steve', { exact: true })).toBeVisible();
    await expect(page.getByText('Alex', { exact: true })).toBeVisible();
    await expect(page.getByText('2 位 · 完整名单')).toBeVisible();
    await page.getByRole('button', { name: '刷新在线名单' }).click();
    await expect(page.getByRole('button', { name: '刷新在线名单' })).toBeEnabled();
    assert((await page.evaluate(() => document.documentElement.scrollWidth)) <= width + 1);
    await page.goto(`/players?server=players-empty-${width}`); await expect(page.getByText('当前没有在线玩家。')).toBeVisible();
    await page.goto(`/players?server=players-stopped-${width}`); await expect(page.getByText('在线名单暂不可用')).toBeVisible();
    await expect(page.getByText('当前没有在线玩家。')).toHaveCount(0);
    await expect(page.getByText('Steve', { exact: true })).toHaveCount(0);
    const response = await context.request.get(`/api/v1/servers/players-stopped-${width}/players`);
    assert.equal(response.status(), 200); assert.equal((await response.json()).data.availability, 'unavailable');
    await page.screenshot({ path: `test-results/p41-players-${width}.png`, fullPage: true });
    await context.close(); console.log(`PASS: Players ${width}px HTTP/Chrome synthetic RCON`);
  } };
  await Promise.race([flow(), new Promise((_, reject) => {
    flowTimer = setTimeout(() => reject(new Error('BROWSER_FLOW_DEADLINE_EXCEEDED')), 180000);
  })]);
  report.browser = 'SYNTHETIC_PASS';
} finally {
  clearTimeout(flowTimer);
  try {
    await cleanupBrowserHelpers({ browser, browserServer, vite: vite?.child, helperClosed: () => !vite || vite.closed,
      helperError: vite?.error, helperLog: vite?.output ?? '', report, evidenceRoot: 'test-results', wait: pause });
  } catch (error) { report.cleanupErrors.push(String(error)); }
  for (const helper of helpers.slice().reverse()) {
    try { if (!helper.closed) helper.child.kill('SIGTERM'); await until(() => helper.closed, 'Owned helper did not close', 10000); }
    catch (error) { report.cleanupErrors.push(String(error)); }
  }
  for (const [index, helper] of helpers.entries()) await writeFile(`test-results/p41-helper-${index}.log`, helper.output);
  report.helpersClosed = helpers.every((helper) => helper.closed) && report.browserHelper.closed;
  if (!report.helpersClosed) report.cleanupErrors.push('HELPERS_NOT_CLOSED');
  try { await assertHTTPPortsFree(); report.httpPortsFree = true; }
  catch (error) { report.cleanupErrors.push(String(error)); }
  if (report.cleanupErrors.length) report.browser = 'BLOCKED';
  await writeFile('test-results/p41-browser-report.json', JSON.stringify(report, null, 2));
  assert.deepEqual(report.cleanupErrors, []);
}
console.log(JSON.stringify(report));
