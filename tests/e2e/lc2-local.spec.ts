import { expect, test } from '@playwright/test';
import type { ServersResponse, WhitelistMemberRequest } from '@mcsm/contracts';
import { buildApp } from '../../apps/api/src/app.js';

// UI/HTTP simulation. No real Java, RCON, credentials or user-world access.
for (const width of [360, 768, 1440]) test(`LT direct whitelist add/remove/unknown ${width}`, async ({ page }) => {
  const mock = buildApp({ mode: 'mock' }); await mock.ready();
  try {
    const servers = (await mock.inject({ method: 'GET', url: '/api/v1/servers', headers: { host: '127.0.0.1:8080' } })).json<ServersResponse>();
    const id = servers.data.items[0]!.server.id, meta = { requestId: 'lt-local', generatedAt: '2026-10-21T00:00:00Z', mode: 'local' };
    let members = [{ name: 'Player_One', uuid: '123e4567-e89b-42d3-a456-426614174000' }], revision = 1, lost = false;
    const posted: WhitelistMemberRequest[] = [], forbidden: string[] = [];
    await page.routeWebSocket('**/ws/**', socket => socket.close());
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), pathname = url.pathname;
      if (pathname === '/api/v1/auth/status') return route.fulfill({ json: { data: { configured: false, authenticationRequired: false, auditReady: false } } });
      if (pathname === `/api/v1/servers/${id}/whitelist`) return route.fulfill({ json: { data: {
        executionMode: 'direct-rcon', availability: 'available', reason: null, configuredEnabled: true, configuredEnforced: false,
        effectiveEnabled: null, items: members, source: 'whitelist-json', sampledAt: meta.generatedAt,
        membershipWritable: true, writeReason: null, revision: revision.toString(16).padStart(64, '0'),
        runtime: { available: true, reason: null, names: members.map(row => row.name), consistent: true } }, meta } });
      if (pathname === `/api/v1/servers/${id}/whitelist/candidates`) return route.fulfill({ json: { data: { availability: 'available', reason: null,
        sampledAt: meta.generatedAt, items: members.some(row => row.name === 'Player_Two') ? [] : [
          { name: 'Player_Two', uuid: '123e4567-e89b-42d3-a456-426614174001', source: 'usercache', identityVerified: false }] }, meta } });
      if (pathname === `/api/v1/servers/${id}/whitelist/members` && request.method() === 'POST') {
        const body = request.postDataJSON() as WhitelistMemberRequest;
        expect(body.revision).toBe(revision.toString(16).padStart(64, '0')); expect(body.confirm).toBe(true);
        expect(request.headers()['x-manager-intent']).toBe('local-ui'); expect(request.headers()['idempotency-key']).toMatch(/^[a-f0-9-]{36}$/u);
        posted.push(body);
        if (!lost) {
          if (body.action === 'add') members.push({ name: body.name, uuid: '123e4567-e89b-42d3-a456-426614174001' });
          else members = members.filter(row => row.name !== body.name);
          revision++;
        }
        return route.fulfill({ json: { data: { serverId: id, action: body.action, name: body.name, outcome: lost ? 'unknown' : 'succeeded',
          code: lost ? 'WHITELIST_RESULT_UNKNOWN' : 'WHITELIST_UPDATED', message: lost ? '响应丢失，不会自动重发' : '名单已核实', relatedErrorObserved: false }, meta } });
      }
      if (request.method() !== 'GET') { forbidden.push(pathname); return route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', message: 'unexpected mutation' }, meta } }); }
      const response = await mock.inject({ method: 'GET', url: pathname + url.search, headers: { host: '127.0.0.1:8080' } });
      return route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
    });
    await page.setViewportSize({ width, height: 900 }); await page.goto(`/whitelist?server=${id}`);
    await expect(page.getByRole('button', { name: '添加 Player_Two', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '添加 Player_Two', exact: true }).click();
    await expect(page.getByText('成功：名单已核实')).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '删除 Player_Two' }).click(); expect(posted).toHaveLength(1);
    await expect(page.getByRole('dialog')).toContainText(`目标服务器：${id}`);
    await page.getByRole('button', { name: '确认执行' }).click();
    await expect(page.getByRole('button', { name: '删除 Player_Two' })).toHaveCount(0);
    await page.getByLabel('玩家名称').fill('Manual_Name'); lost = true;
    await page.getByRole('button', { name: '添加玩家', exact: true }).click();
    await expect(page.getByText(/结果未知：响应丢失/)).toBeVisible(); await expect(page.getByRole('button', { name: '添加玩家', exact: true })).toBeDisabled();
    expect(posted.map(row => row.action)).toEqual(['add', 'remove', 'add']); expect(forbidden).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await mock.close(); }
});
