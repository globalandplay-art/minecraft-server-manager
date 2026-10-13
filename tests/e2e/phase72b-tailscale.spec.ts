import { expect, test } from '@playwright/test';
import { buildApp } from '../../apps/api/src/app.js';

for (const width of [360, 768, 1440]) test(`Tailscale read-only private access ${width}`, async ({ page }) => {
  const app = buildApp({ mode: 'mock' }); await app.ready();
  let probes = 0; let forbidden = 0;
  const meta = { mode: 'mock', generatedAt: '2026-10-13T00:00:00Z', requestId: 'browser-fixture' };
  const initial = { state: 'disabled', desiredEnabled: false, observedEnabled: null, observedServeMode: 'unknown',
    managementMode: 'external', dependency: 'unknown', tailnet: 'unknown', https: 'unknown', target: 'unconfigured',
    lastCheckedAt: null, lastErrorCode: null, connectionUrl: null, remoteVerifiedAt: null, capabilities: { preflight: true, enable: false, disable: false } };
  try {
    await page.setViewportSize({ width, height: 900 });
    await page.routeWebSocket('**/ws/**', (socket) => socket.close({ code: 1008, reason: 'fixture-only' }));
    await page.route('**/api/**', async (route) => {
      const request = route.request(); const url = new URL(request.url());
      if (url.pathname === '/api/v1/auth/status') return route.fulfill({ json: { data: { configured: true, authenticationRequired: true, auditReady: true } } });
      if (url.pathname === '/api/v1/auth/session') return route.fulfill({ json: { data: { authenticated: true, csrfToken: 'a'.repeat(43), expiresAt: '2026-10-13T00:30:00Z', recentReauthentication: true }, meta } });
      if (url.pathname === '/api/v1/access/tailscale' && request.method() === 'GET') return route.fulfill({ json: { data: initial, meta } });
      if (url.pathname === '/api/v1/access/tailscale/control' && request.method() === 'GET') return route.fulfill({ json: { data: {
        state: 'unavailable', revision: null, observedEnabled: null, recoveryOperationId: null, enableAllowed: false,
        disableAllowed: false, connectionUrl: null, remoteVerifiedAt: null, lastErrorCode: 'TAILSCALE_ATOMIC_CONTROL_UNAVAILABLE' }, meta } });
      if (url.pathname === '/api/v1/access/tailscale/preflight' && request.method() === 'POST') {
        probes++; expect(request.postDataJSON()).toEqual({}); expect(request.headers()['x-csrf-token']).toBe('a'.repeat(43));
        return route.fulfill({ json: { data: { ...initial, state: 'conflict', observedServeMode: 'external', lastCheckedAt: '2026-10-13T00:00:00Z', lastErrorCode: 'TAILSCALE_EXTERNAL_CONFIG' }, meta } });
      }
      if (request.method() !== 'GET') { forbidden++; return route.fulfill({ status: 403, json: { error: { code: 'FIXTURE_MUTATION_FORBIDDEN', message: 'forbidden' } } }); }
      const response = await app.inject({ method: 'GET', url: url.pathname + url.search, headers: { host: '127.0.0.1:8080' } });
      return route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
    });
    await page.goto('/settings');
    const section = page.getByRole('region', { name: 'Tailscale Serve' });
    await expect(section.getByText('disabled', { exact: true })).toBeVisible(); expect(probes).toBe(0);
    await expect(section.getByText('未验证；没有可连接 URL')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await section.getByRole('button', { name: /只读预检/ }).click();
    await expect(section.getByText('TAILSCALE_EXTERNAL_CONFIG')).toBeVisible();
    await expect(section.getByText('关闭', { exact: true })).toBeVisible();
    await expect(section.getByRole('link')).toHaveCount(0);
    expect(probes).toBe(1); expect(forbidden).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await app.close(); }
});

for (const width of [360, 768, 1440]) test(`Tailscale Fake controlled lifecycle ${width}`, async ({ page }) => {
  const app = buildApp({ mode: 'mock' }); await app.ready();
  const meta = { mode: 'mock', generatedAt: '2026-10-13T00:00:00Z', requestId: 'controlled-browser' };
  const revision = '11111111-1111-4111-8111-111111111111';
  const enableId = '22222222-2222-4222-8222-222222222222';
  const disableId = '33333333-3333-4333-8333-333333333333';
  let enabled = false; let recovery = false; let commits = 0; let recoveries = 0; let forbidden = 0;
  const requests: { action: string; key?: string }[] = [];
  const operation = (id: string, action: string, state: string) => ({ schemaVersion: 1, id,
    resource: { kind: 'manager-access', provider: 'tailscale' }, action, state,
    errorCode: state === 'recovery_required' ? 'ACCESS_RECOVERY_REQUIRED' : null,
    createdAt: meta.generatedAt, updatedAt: meta.generatedAt });
  try {
    await page.setViewportSize({ width, height: 900 });
    await page.routeWebSocket('**/ws/**', (socket) => socket.close({ code: 1008, reason: 'fixture-only' }));
    await page.route('**/api/**', async (route) => {
      const request = route.request(); const url = new URL(request.url());
      if (url.pathname === '/api/v1/auth/status') return route.fulfill({ json: { data: { configured: true, authenticationRequired: true, auditReady: true } } });
      if (url.pathname === '/api/v1/auth/session') return route.fulfill({ json: { data: { authenticated: true, csrfToken: 'a'.repeat(43), expiresAt: '2026-10-13T00:30:00Z', recentReauthentication: true }, meta } });
      if (url.pathname === '/api/v1/access/tailscale') return route.fulfill({ json: { data: {
        state: 'disabled', desiredEnabled: false, observedEnabled: null, observedServeMode: 'unknown', managementMode: 'external',
        dependency: 'unknown', tailnet: 'unknown', https: 'unknown', target: 'unconfigured', lastCheckedAt: null, lastErrorCode: null,
        connectionUrl: null, remoteVerifiedAt: null, capabilities: { preflight: true, enable: false, disable: false } }, meta } });
      if (url.pathname === '/api/v1/access/tailscale/control' && request.method() === 'GET') return route.fulfill({ json: { data: {
        state: recovery ? 'recovery_required' : enabled ? 'enabled' : 'ready', revision, observedEnabled: recovery ? null : enabled,
        recoveryOperationId: recovery ? disableId : null, enableAllowed: !enabled && !recovery, disableAllowed: enabled && !recovery,
        connectionUrl: null, remoteVerifiedAt: null, lastErrorCode: recovery ? 'ACCESS_RECOVERY_REQUIRED' : null }, meta } });
      if (request.method() === 'POST') {
        expect(request.headers()['x-csrf-token']).toBe('a'.repeat(43)); expect(request.postDataJSON()).toEqual({ revision, confirm: true });
        if (url.pathname === '/api/v1/access/tailscale/enable') {
          requests.push({ action: 'enable', key: request.headers()['idempotency-key'] });
          expect(requests.at(-1)?.key).toMatch(/^[0-9a-f-]{36}$/);
          if (requests.filter((item) => item.action === 'enable').length === 1) {
            enabled = true; commits++; // Simulated committed action with lost response.
            return route.fulfill({ status: 503, json: { error: { code: 'FIXTURE_RESPONSE_LOST', message: 'Result unknown.' } } });
          }
          expect(requests.at(-1)?.key).toBe(requests[0]?.key);
          return route.fulfill({ status: 202, json: { data: operation(enableId, 'enable', 'succeeded'), meta } });
        }
        if (url.pathname === '/api/v1/access/tailscale/disable') {
          requests.push({ action: 'disable', key: request.headers()['idempotency-key'] });
          enabled = false; recovery = true; commits++;
          return route.fulfill({ status: 202, json: { data: operation(disableId, 'disable', 'recovery_required'), meta } });
        }
        if (url.pathname === `/api/v1/access/operations/${disableId}/recover`) {
          requests.push({ action: 'recover' }); recovery = false; recoveries++;
          return route.fulfill({ json: { data: operation(disableId, 'disable', 'succeeded'), meta } });
        }
        forbidden++; return route.fulfill({ status: 403, json: { error: { code: 'FIXTURE_MUTATION_FORBIDDEN', message: 'forbidden' } } });
      }
      const response = await app.inject({ method: 'GET', url: url.pathname + url.search, headers: { host: '127.0.0.1:8080' } });
      return route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
    });
    await page.goto('/settings'); const control = page.getByRole('region', { name: 'Tailscale controlled access' });
    await control.getByRole('button', { name: '启用私有访问' }).click();
    await expect(control.getByRole('button', { name: '确认执行' })).toBeDisabled(); expect(requests).toHaveLength(0);
    await control.getByRole('checkbox').check(); await control.getByRole('button', { name: '确认执行' }).click();
    await expect(control.getByRole('alert')).toContainText('操作结果尚需确认'); expect(commits).toBe(1); expect(requests).toHaveLength(1);
    await control.getByRole('button', { name: '按原请求确认结果' }).click();
    await expect(control.getByRole('button', { name: '停用私有访问' })).toBeVisible(); expect(commits).toBe(1);
    await control.getByRole('button', { name: '停用私有访问' }).click();
    await control.getByRole('checkbox').check(); await control.getByRole('button', { name: '确认执行' }).click();
    await expect(control.getByText(/操作 .*：recovery_required/)).toBeVisible();
    await control.getByRole('button', { name: /显式核验恢复/ }).click();
    await expect(control.getByRole('button', { name: '启用私有访问' })).toBeVisible();
    expect(requests.filter((item) => item.action === 'enable')).toHaveLength(2);
    expect(requests.filter((item) => item.action === 'disable')).toHaveLength(1);
    expect(requests.filter((item) => item.action === 'recover')).toHaveLength(1);
    expect(commits).toBe(2); expect(recoveries).toBe(1); expect(forbidden).toBe(0);
    expect(await control.getByRole('link').count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await app.close(); }
});
