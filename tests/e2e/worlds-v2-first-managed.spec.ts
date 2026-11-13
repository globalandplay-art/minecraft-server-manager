import { expect, test } from '@playwright/test';
import { buildApp } from '../../apps/api/src/app.js';

// Rendered UI acceptance with synthetic HTTP responses; no Minecraft process.
for (const width of [360, 768, 1440]) {
  test(`first managed controls preserve state at ${width}px`, async ({ page }, testInfo) => {
    const mock = buildApp({ mode: 'mock' });
    try {
    await mock.ready();
    const serversResponse = await mock.inject({ method: 'GET', url: '/api/v1/servers', headers: { host: '127.0.0.1:8080' } });
    expect(serversResponse.statusCode, serversResponse.body).toBe(200);
    const servers = serversResponse.json().data.items;
    const serverId = servers[0].server.id;
    const execution = '11111111-1111-4111-8111-111111111111', startId = '22222222-2222-4222-8222-222222222222';
    const target = { preparationOperationId: execution, preparationTransactionId: execution, worldId: `worldv2-${execution}`,
      preparedRecordDigest: 'a'.repeat(64), registeredExecutionDigest: 'b'.repeat(64) };
    const meta = { requestId: 'browser', generatedAt: '2026-11-13T00:00:00.000Z', mode: 'local' };
    const operation = (id: string, kind: string) => ({ id, serverId, kind, state: 'succeeded', step: 'completed',
      progress: null, createdAt: meta.generatedAt, updatedAt: meta.generatedAt, error: null, result: null });
    let starts = 0, stops = 0;
      await page.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname === '/api/v1/auth/status') return route.fulfill({ json: { data: { configured: false, authenticationRequired: false, auditReady: false } } });
        if (url.pathname === `/api/v1/servers/${serverId}/worlds`) return route.fulfill({ json: { data: { items: [] }, meta } });
        if (url.pathname === `/api/v1/operations/${execution}`) return route.fulfill({ json: { data: operation(execution, 'world-create'), meta } });
        if (url.pathname.endsWith('/generation-finalize')) return route.fulfill({ json: { data: {
          serverId, operationId: execution, worldId: target.worldId, inspectionOnly: true, recoveryRequired: true
        }, meta } });
        if (url.pathname.endsWith('/first-managed-start')) {
          starts++;
          expect(request.postDataJSON()).toEqual({ executionOperationId: execution, confirm: true });
          return route.fulfill({ status: 202, json: { data: { operation: operation(startId, 'start') }, meta } });
        }
        if (url.pathname.endsWith('/first-managed-stop')) {
          stops++;
          expect(request.postDataJSON()).toEqual({ startOperationId: startId, confirm: true });
          return route.fulfill({ status: 202, json: { data: { operation: operation(execution, 'stop') }, meta } });
        }
        if (request.method() !== 'GET') return route.fulfill({ status: 409, json: { error: { code: 'RECOVERY_REQUIRED', message: 'Inspection required' } } });
        const response = await mock.inject({ method: 'GET', url: url.pathname + url.search, headers: { host: '127.0.0.1:8080' } });
        const body = response.json();
        if (url.pathname === '/api/v1/health' || url.pathname === '/api/v1/servers') body.meta.mode = 'local';
        if (url.pathname === `/api/v1/servers/${serverId}/worlds`) body.meta.mode = 'local';
        return route.fulfill({ status: response.statusCode, json: body });
      });
      await page.addInitScript(({ serverId, execution, target }) => {
        localStorage.setItem('lt.interface-language.v1', 'en');
        sessionStorage.setItem(`lt.pendingWorldGeneration.${serverId}`, JSON.stringify({
          version: 1, serverId, key: execution, target, operationId: execution
        }));
      }, { serverId, execution, target });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/worlds?server=${serverId}`);
      await page.getByRole('button', { name: 'Verify saved generation result', exact: true }).click();
      await page.getByRole('button', { name: 'Start verified new world', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Stop this world normally', exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('button', { name: 'Stop this world normally', exact: true })).toBeVisible();
      expect(starts).toBe(1);
      await page.getByRole('button', { name: 'Stop this world normally', exact: true }).click();
      await expect(page.getByText('Normal stop and saved-world evidence recorded. Recovery verification is still required.', { exact: true })).toBeVisible();
      expect(stops).toBe(1);
      for (const language of ['zh-CN', 'en', 'ja']) {
        await page.locator('.topbar .language-selector select').selectOption(language);
        await page.locator('.topbar .theme-selector select').selectOption(width === 768 ? 'dark' : 'light');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
        await page.screenshot({ path: testInfo.outputPath(`first-managed-${width}-${language}.png`), fullPage: true });
      }
    } finally { await mock.close(); }
  });
}
