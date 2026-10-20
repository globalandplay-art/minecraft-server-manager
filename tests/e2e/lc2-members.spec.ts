import { expect, test } from '@playwright/test';
import type { Operation, ServersResponse } from '@mcsm/contracts';
import { buildApp } from '../../apps/api/src/app.js';

// Browser/HTTP contract simulation only. No real RCON, Java, worlds or credentials.
for (const width of [360, 768, 1440]) {
  test(`LC2 single-member confirmation and operation status ${width}`, async ({ page }) => {
    const mock = buildApp({ mode: 'mock' }); await mock.ready();
    try {
      const servers = (await mock.inject({ method: 'GET', url: '/api/v1/servers', headers: { host: '127.0.0.1:8080' } })).json<ServersResponse>();
      const serverId = servers.data.items[0]!.server.id;
      const meta = { mode: 'local', generatedAt: '2026-10-20T00:00:00Z', requestId: 'lc2-browser' };
      const csrf = 'a'.repeat(43), session = { data: { authenticated: true, csrfToken: csrf,
        expiresAt: '2026-10-20T00:30:00Z', recentReauthentication: true }, meta };
      let loggedIn = false, revision = 1, enabled = true;
      let members = [{ name: 'Player_One', uuid: '123e4567-e89b-42d3-a456-426614174000' }];
      const posted: { action: string; key: string }[] = [], forbidden: string[] = [];
      let operation: Operation | undefined;
      await page.routeWebSocket('**/ws/**', socket => socket.close());
      await page.route('**/api/**', async route => {
        const request = route.request(), pathname = new URL(request.url()).pathname;
        if (pathname === '/api/v1/auth/status') return route.fulfill({ json: { data: { configured: true, authenticationRequired: true, auditReady: true } } });
        if (pathname === '/api/v1/auth/session') return route.fulfill(loggedIn ? { json: session } : { status: 401, json: { error: { code: 'AUTH_REQUIRED', message: 'login required' }, meta } });
        if (pathname === '/api/v1/auth/login') { loggedIn = true; return route.fulfill({ json: session }); }
        if (pathname === `/api/v1/servers/${serverId}/whitelist` && request.method() === 'GET') {
          return route.fulfill({ json: { data: { availability: 'available', reason: null, configuredEnabled: true, configuredEnforced: false,
            effectiveEnabled: null, items: members, source: 'whitelist-json', sampledAt: meta.generatedAt,
            ...(enabled ? { membershipWritable: true, writeReason: null, revision: revision.toString(16).padStart(64, '0') } :
              { membershipWritable: false, writeReason: 'MEMBER_RULE_UNAVAILABLE' }) }, meta } });
        }
        if (pathname === `/api/v1/servers/${serverId}/whitelist/members` && request.method() === 'POST') {
          const body = request.postDataJSON() as { action: string; name: string; revision: string; confirm: boolean };
          expect(loggedIn).toBe(true); expect(body.revision).toBe(revision.toString(16).padStart(64, '0')); expect(body.confirm).toBe(true);
          expect(Object.keys(body).sort()).toEqual(['action', 'confirm', 'name', 'revision']);
          expect(request.headers()['x-csrf-token']).toBe(csrf);
          const key = request.headers()['idempotency-key']!; expect(key).toMatch(/^[a-f0-9-]{36}$/u);
          posted.push({ action: body.action, key });
          if (body.action === 'add') members.push({ name: body.name, uuid: '123e4567-e89b-42d3-a456-426614174001' });
          else members = members.filter(row => row.name !== body.name);
          revision++;
          operation = { id: `123e4567-e89b-42d3-a456-42661417400${posted.length}`, serverId, kind: 'whitelist-change', state: 'succeeded',
            step: 'completed', progress: null, createdAt: meta.generatedAt, updatedAt: meta.generatedAt, result: null, error: null };
          return route.fulfill({ status: 202, json: { data: { operation: { ...operation, state: 'queued' } }, meta } });
        }
        if (operation && pathname === `/api/v1/operations/${operation.id}`) return route.fulfill({ json: { data: operation, meta } });
        if (request.method() !== 'GET') { forbidden.push(pathname); return route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', message: 'no other mutation' }, meta } }); }
        const result = await mock.inject({ method: 'GET', url: pathname + new URL(request.url()).search, headers: { host: '127.0.0.1:8080' } });
        return route.fulfill({ status: result.statusCode, contentType: 'application/json', body: result.body });
      });
      await page.setViewportSize({ width, height: 900 }); await page.goto(`/whitelist?server=${serverId}`);
      await page.getByLabel('账号', { exact: true }).fill('fixture-admin');
      await page.getByLabel('密码', { exact: true }).fill('SYNTHETIC_BROWSER_ONLY'); await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.getByText('Player_One', { exact: true })).toBeVisible();
      await page.getByLabel('玩家名称').fill('Player_Two'); await page.getByRole('button', { name: '添加玩家' }).click();
      await expect(page.getByRole('dialog')).toBeVisible(); expect(posted).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('button', { name: '确认执行' }).click(); await expect(page.getByText('白名单操作已确认成功。')).toBeVisible();
      await expect(page.getByText('Player_Two', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '删除 Player_Two' }).click(); await page.getByRole('button', { name: '确认执行' }).click();
      await expect(page.getByText('Player_Two', { exact: true })).toHaveCount(0);
      expect(posted.map(row => row.action)).toEqual(['add', 'remove']); expect(new Set(posted.map(row => row.key)).size).toBe(2);
      expect(forbidden).toEqual([]);
      enabled = false; await page.getByRole('button', { name: '刷新白名单' }).click(); await expect(page.getByRole('button', { name: '添加玩家' })).toBeDisabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await mock.close(); }
  });
}
