import { expect, test } from '@playwright/test';
import { buildApp } from '../../apps/api/src/app.js';
import type { ServersResponse } from '@mcsm/contracts';
for (const width of [360,768,1440]) test(`M1 registration confirmation and pending reload ${width}`, async ({ page }) => {
  const mock = buildApp({ mode: 'mock' }); await mock.ready();
  try {
    const servers = (await mock.inject({ method: 'GET', url: '/api/v1/servers', headers: { host: '127.0.0.1:8080' } })).json<ServersResponse>();
    servers.meta.mode = 'local'; servers.data.items = servers.data.items.slice(0, 1);
    const profile = servers.data.items[0]!.server;
    const meta = { requestId: 'm1-browser', generatedAt: '2026-10-21T00:00:00Z', mode: 'local' };
    let saves = 0, checks = 0;
    const forbidden: string[] = [];
    await page.routeWebSocket('**/ws/**', socket => socket.close());
    await page.route('**/api/**', async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      if (pathname === '/api/v1/auth/status') return route.fulfill({ json: { data: { configured: false, authenticationRequired: false, auditReady: false } } });
      if (pathname === '/api/v1/servers') return route.fulfill({ json: servers });
      if (pathname === '/api/v1/server-registrations' && request.method() === 'GET') return route.fulfill({ json: {
        data: { profiles: [{ id: profile.id, name: profile.name }], pending: saves ? [{ id: 'second', name: '第二实例' }] : [] }, meta } });
      if (pathname === '/api/v1/server-registrations/preflight') {
        expect(request.method()).toBe('POST'); checks++;
        expect(request.postDataJSON()).toEqual({ id: 'second', name: '第二实例', root: 'C:\\MC\\第二实例', jarFile: 'server.jar', javaProfileId: profile.id });
        expect(request.headers()['x-manager-intent']).toBe('local-ui');
        return route.fulfill({ json: { data: { token: '123e4567-e89b-42d3-a456-426614174000', server: { ...profile, id: 'second', name: '第二实例' },
          eulaAccepted: true, lifecycleSupported: true, restartRequired: true }, meta } });
      }
      if (pathname === '/api/v1/server-registrations' && request.method() === 'POST') {
        expect(request.postDataJSON()).toEqual({ token: '123e4567-e89b-42d3-a456-426614174000', confirm: true }); saves++;
        return route.fulfill({ status: 201, json: { data: { id: 'second', name: '第二实例', restartRequired: true }, meta } });
      }
      if (request.method() !== 'GET') { forbidden.push(pathname); return route.fulfill({ status: 403, json: {} }); }
      const response = await mock.inject({ method: 'GET', url: pathname, headers: { host: '127.0.0.1:8080' } });
      return route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
    });
    await page.setViewportSize({ width, height: 900 }); await page.goto('/servers');
    await page.getByLabel('实例标识').fill('second'); await page.getByLabel('显示名称').fill('第二实例');
    await page.getByLabel('服务端目录').fill('C:\\MC\\第二实例'); await page.getByRole('button', { name: '检查实例' }).click();
    await expect(page.getByText('确认登记：第二实例')).toBeVisible(); await expect(page.getByRole('button', { name: '保存实例' })).toBeDisabled();
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: '保存实例' }).click();
    await expect(page.getByText(/已登记 第二实例/)).toBeVisible();
    await expect(page.getByText('第二实例（second）')).toBeVisible();
    expect(checks).toBe(1); expect(saves).toBe(1); expect(forbidden).toEqual([]);
    await page.reload(); await expect(page.getByText('第二实例（second）')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await mock.close(); }
});
