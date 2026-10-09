import { expect, test } from '@playwright/test';
import { buildApp } from '../../apps/api/src/app.js';

let mockApi: ReturnType<typeof buildApp>;
test.beforeEach(async () => { mockApi = buildApp({ mode: 'mock' }); await mockApi.ready(); });
test.afterEach(async () => { await mockApi.close(); });

for (const width of [360, 768, 1440]) {
  test(`authentication isolation and logout ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let loggedIn = false; let loginCount = 0; let mutations = 0;
    const meta = { mode: 'mock', generatedAt: '2026-10-09T01:00:00.000Z', requestId: 'browser-test' };
    const session = { data: { authenticated: true, csrfToken: 'a'.repeat(43), expiresAt: '2026-10-09T01:30:00.000Z', recentReauthentication: true }, meta };
    await page.routeWebSocket('**/ws/**', (socket) => {
      mutations++;
      socket.close({ code: 1008, reason: 'business-websocket-not-authorized' });
    });
    await page.route('**/api/**', async (route) => {
      const request = route.request(); const path = new URL(request.url()).pathname;
      if (path === '/api/v1/auth/status') return route.fulfill({ json: { data: { configured: true, authenticationRequired: true, auditReady: true } } });
      if (path === '/api/v1/auth/session') return route.fulfill(loggedIn ? { json: session } : { status: 401, json: { error: { code: 'AUTH_REQUIRED', message: 'login required' } } });
      if (path === '/api/v1/auth/login') {
        expect(request.postDataJSON()).toEqual({ username: 'admin', password: 'synthetic-test-password' });
        loginCount++; loggedIn = true; return route.fulfill({ json: session });
      }
      if (path === '/api/v1/auth/logout') {
        expect(request.headers()['x-csrf-token']).toBe('a'.repeat(43));
        loggedIn = false; return route.fulfill({ json: { data: { authenticated: false }, meta } });
      }
      if (request.method() !== 'GET') {
        mutations++;
        return route.fulfill({ status: 403, json: { error: { code: 'TEST_MUTATION_FORBIDDEN', message: 'No business mutation is authorized' } } });
      }
      // In-process mock only: never reuse the host's real Manager on8080.
      const response = await mockApi.inject({ method: 'GET', url: path + new URL(request.url()).search,
        headers: { host: '127.0.0.1:8080' } });
      return route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '登录管理器' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toHaveCount(0);
    await page.getByLabel('账号', { exact: true }).fill('admin');
    await page.getByLabel('密码', { exact: true }).fill('synthetic-test-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    expect(loginCount).toBe(1); expect(mutations).toBe(0);
    await page.getByRole('button', { name: '再次确认身份' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByRole('heading', { name: '登录管理器' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    expect(mutations).toBe(0);
  });
}
