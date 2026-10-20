import { expect, test } from '@playwright/test';
import type { Metrics, ServersResponse } from '@mcsm/contracts';
import { buildApp } from '../../apps/api/src/app.js';

// Synthetic HTTP evidence only; no Java, RCON or real process metrics.
for (const width of [360, 768, 1440]) {
  test(`LM1 truthful trends and controls ${width}`, async ({ page }) => {
    const app = buildApp({ mode: 'mock' }); await app.ready();
    try {
      const servers = (await app.inject({ method: 'GET', url: '/api/v1/servers', headers: { host: '127.0.0.1:8080' } })).json<ServersResponse>();
      const serverId = servers.data.items[0]!.server.id;
      const meta = { mode: 'mock', requestId: 'lm1-browser', generatedAt: '2026-10-20T00:02:00Z' };
      const missing = { status: 'unavailable', value: null, source: null, sampledAt: null, reason: 'not-collected' } as const;
      const samples = [0, 5000, 120000].map((offset, index) => {
        const time = new Date(Date.parse('2026-10-20T00:00:00Z') + offset).toISOString();
        const metrics: Metrics = { cpu: { status: 'available', value: index * 10, source: 'process', sampledAt: time },
          ram: { status: 'available', value: { rssBytes: 1024 * (index + 1) }, source: 'process', sampledAt: time },
          disk: { status: 'available', value: { totalBytes: 4096, usedBytes: 1024, freeBytes: 3072 }, source: 'filesystem', sampledAt: time },
          players: { status: 'available', value: { online: index, max: 20 }, source: 'rcon', sampledAt: time },
          uptime: missing, tps: missing, mspt: missing };
        return { collectedAt: time, metrics };
      });
      let requests = 0, failed = false;
      const writes: string[] = [];
      await page.routeWebSocket('**/ws/**', socket => socket.close());
      await page.route('**/api/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        if (path === '/api/v1/auth/status') return route.fulfill({ json: { data: { configured: false, authenticationRequired: false, auditReady: false } } });
        if (path.endsWith('/performance')) {
          requests++;
          return route.fulfill(failed ? { status: 503, json: { error: { code: 'UNAVAILABLE', message: 'synthetic read failure' }, meta } } :
            { json: { data: { retention: 'manager-session', minimumIntervalMs: 5000, samples }, meta } });
        }
        if (request.method() !== 'GET') { writes.push(path); return route.fulfill({ status: 403 }); }
        const result = await app.inject({ method: 'GET', url: path + new URL(request.url()).search, headers: { host: '127.0.0.1:8080' } });
        return route.fulfill({ status: result.statusCode, contentType: 'application/json', body: result.body });
      });
      await page.setViewportSize({ width, height: 900 }); await page.goto(`/performance?server=${serverId}`);
      await expect(page.getByRole('img', { name: /^CPU 使用率历史趋势/ })).toBeVisible();
      await expect(page.getByRole('region', { name: '监测提示' })).toBeVisible();
      await expect(page.getByText('TPS/MSPT 暂无可信采集结果；不会根据 CPU、玩家数或日志猜测。')).toBeVisible();
      await expect(page.getByText('3 个可信采样点', { exact: true })).toHaveCount(4);
      const chart = page.getByRole('img', { name: /^CPU 使用率历史趋势/ });
      await expect(chart.locator('polyline')).toHaveCount(1);
      await expect(chart.locator('circle')).toHaveCount(3);
      await page.getByRole('button', { name: '暂停自动刷新' }).click();
      await expect(page.getByRole('button', { name: '恢复自动刷新' })).toBeVisible();
      await page.getByLabel('历史范围').selectOption('minute');
      await expect(chart.locator('circle')).toHaveCount(1);
      await expect(chart.locator('polyline')).toHaveCount(0);
      failed = true;
      const before = requests;
      await page.getByRole('button', { name: '刷新采样' }).click();
      await expect(page.getByText('以下为上次成功读取的旧快照，当前指标尚未确认。')).toBeVisible();
      await expect(page.getByText('本次指标读取失败；保留的快照不能用于确认当前健康状态。')).toBeVisible();
      expect(requests).toBe(before + 1);
      await expect(page.getByText('N/A · not-collected', { exact: true })).toHaveCount(3);
      expect(writes).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await app.close(); }
  });
}
