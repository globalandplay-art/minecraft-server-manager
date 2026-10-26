import { expect, test } from '@playwright/test';
import type { HealthResponse, OverviewResponse, ServersResponse } from '@mcsm/contracts';
import { buildApp } from '../../apps/api/src/app.js';

// Chrome/Vite renders production React. REST and WebSocket data are explicitly
// fake; no Java, credentials, or real instance operation is used.
for (const width of [360, 768, 1440]) test(`Console and confirmation locale integrity ${width}`, async ({ page }, testInfo) => {
  const mock = buildApp({ mode: 'mock' }); await mock.ready();
  const mutations: string[] = []; let connections = 0;
  let status: ServersResponse['data']['items'][number]['status'] | undefined;
  try {
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== 'GET') mutations.push(request.method() + url.pathname);
      if (url.pathname === '/api/v1/auth/status') return route.fulfill({ json: { data: { configured: false, authenticationRequired: false, auditReady: false } } });
      if (url.pathname.startsWith('/api/v1/access/')) return route.fulfill({ status: 503, json: { error: { code: 'ACCESS_UNAVAILABLE', message: 'Paused fixture.' } } });
      const response = await mock.inject({ method: 'GET', url: url.pathname + url.search, headers: { host: '127.0.0.1:8080' } });
      let body = response.body;
      if (url.pathname === '/api/v1/health') {
        const payload = response.json<HealthResponse>(); payload.meta.mode = 'local';
        payload.data.features.console.implemented = true; payload.data.features.lifecycle.implemented = true; body = JSON.stringify(payload);
      } else if (url.pathname === '/api/v1/servers') {
        const payload = response.json<ServersResponse>(); payload.meta.mode = 'local';
        for (const row of payload.data.items) { row.capabilities.console = true; row.readiness.commands = { allowed: true, reason: null }; row.readiness.commandTransport = 'stdin'; }
        status = payload.data.items[0]!.status; body = JSON.stringify(payload);
      } else if (url.pathname.endsWith('/overview') && response.statusCode === 200) {
        const payload = response.json<OverviewResponse>(); payload.meta.mode = 'local';
        payload.data.summary.readiness.restart = { allowed: true, reason: null }; payload.data.summary.readiness.stop = { allowed: true, reason: null };
        body = JSON.stringify(payload);
      }
      await route.fulfill({ status: response.statusCode, contentType: 'application/json', body });
    });
    await page.routeWebSocket('**/ws/v1/servers/*/events*', socket => {
      connections++;
      socket.send(JSON.stringify({ type: 'hello', streamId: 'l1-fixture', latestSequence: 1 }));
      socket.send(JSON.stringify({ type: 'snapshot', sequence: 1, status, logs: [{ id: 'raw', cursor: 'raw', timestamp: null, level: 'error', text: '原始 Minecraft 日志 / RAW <entry>', source: 'latest.log' }] }));
    });
    await page.setViewportSize({ width, height: 900 }); await page.goto('/console');
    await expect(page.locator('.command-panel input')).toBeEnabled();
    await expect(page.locator('.log-text')).toHaveText('原始 Minecraft 日志 / RAW <entry>');
    await page.locator('.command-panel input').fill('say 未保存 draft');
    const openedConnections = connections;
    for (const language of ['zh-CN', 'en', 'ja']) {
      await page.locator('.topbar .language-selector select').selectOption(language);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('.page-heading h1')).toHaveText(language === 'ja' ? 'コンソール' : 'Console');
      await expect(page.locator('.command-panel input')).toHaveValue('say 未保存 draft');
      await expect(page.locator('.log-text')).toHaveText('原始 Minecraft 日志 / RAW <entry>');
      expect(connections).toBe(openedConnections); expect(mutations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath(`console-${language}-${width}.png`), fullPage: true, animations: 'disabled' });
    }
    await page.goto('/dashboard'); await expect(page.locator('.server-hero')).toBeVisible();
    await page.locator('.topbar .language-selector select').selectOption('en');
    await page.getByRole('button', { name: 'Restart', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm server Restart' }); await expect(dialog).toBeVisible();
    // Dialog backdrop correctly prevents toolbar access. Change the locale via
    // the normal selector event programmatically only for this open-dialog test.
    await page.locator('.topbar .language-selector select').selectOption('ja', { force: true });
    await expect(page.getByRole('dialog', { name: 'サーバーの再起動を確認' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`restart-ja-${width}.png`), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0); expect(mutations).toEqual([]);
  } finally { await mock.close(); }
});
