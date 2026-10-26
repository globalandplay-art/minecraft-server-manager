import { expect, test } from '@playwright/test';
import type { HealthResponse, ServersResponse } from '@mcsm/contracts';
import { buildApp } from '../../apps/api/src/app.js';

for (const width of [360, 768, 1440]) test(`Workspace locales, Performance and demo Settings ${width}`, async ({ page }, testInfo) => {
  const mock = buildApp({ mode: 'mock' }); await mock.ready();
  const requests: string[] = []; let servers: ServersResponse['data']['items'] = [];
  try {
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()); requests.push(request.method() + ' ' + url.pathname);
      // Deliberately no auth/access overrides: the real mock API must declare
      // no password, and Settings must not call the protected remote endpoints.
      const response = await mock.inject({ method: 'GET', url: url.pathname + url.search, headers: { host: '127.0.0.1:8080' } });
      let body = response.body;
      if (url.pathname === '/api/v1/health') {
        const payload = response.json<HealthResponse>();
        payload.data.features.performance.implemented = true; body = JSON.stringify(payload);
      } else if (url.pathname === '/api/v1/servers') servers = response.json<ServersResponse>().data.items;
      await route.fulfill({ status: response.statusCode, contentType: 'application/json', body });
    });
    await page.setViewportSize({ width, height: 960 }); await page.goto('/settings');
    await expect(page.locator('.appearance-settings')).toBeVisible();
    await expect(page.locator('.auth-page')).toHaveCount(0);
    expect(requests.filter(request => request.includes('/access/'))).toEqual([]);
    const initialId = await page.locator('.server-switcher select').inputValue();
    await page.goto(`/performance?server=${encodeURIComponent(initialId)}`);
    await expect(page.locator('.performance-history tbody tr').first()).toBeVisible();
    await page.getByRole('button', { name: 'Pause automatic refresh', exact: true }).click();
    await page.locator('.performance-controls select').selectOption('minute');
    const perfRequests = () => requests.filter(request => request.includes('/performance')).length;
    const count = perfRequests();
    for (const [locale, title, mods] of [['zh-CN', '性能监控', '插件'], ['en', 'Performance', 'Plugins'], ['ja', 'パフォーマンス', 'プラグイン']] as const) {
      await page.locator('.topbar .language-selector select').selectOption(locale);
      await expect(page.locator('.page-heading h1')).toHaveText(title);
      await expect(page.locator('.workspace-breadcrumb')).toHaveText(`LT / ${title}`);
      await expect(page.locator('.server-switcher select')).toHaveValue(initialId);
      await expect(page.locator('.performance-controls select')).toHaveValue('minute');
      await expect(page.locator('.nav-item[href^="/addons"] > span')).toHaveText(mods);
      expect(perfRequests()).toBe(count);
      for (const theme of ['light', 'dark']) {
        await page.locator('.topbar .theme-selector select').selectOption(theme);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: testInfo.outputPath(`performance-${locale}-${theme}-${width}.png`), fullPage: true, animations: 'disabled' });
      }
      await page.locator('.performance-trend-toolbar select').selectOption('tps');
      await expect(page.locator('.performance-trend svg')).toHaveCount(0);
      await expect(page.locator('.performance-trend-empty')).toHaveText(locale === 'zh-CN' ? '暂无可信趋势数据' : locale === 'en' ? 'No Reliable Trend Data' : '信頼できる推移データがありません');
      await page.locator('.performance-trend-toolbar select').selectOption('cpu');
    }
    await page.goto(`/servers?server=${encodeURIComponent(initialId)}`);
    await expect(page.locator('.workspace-server-table tbody tr').first()).toBeVisible();
    for (const [locale, title, mods] of [['zh-CN', '服务器', '模组'], ['en', 'Servers', 'Mods'], ['ja', 'サーバー', 'MOD']] as const) {
      await page.locator('.topbar .language-selector select').selectOption(locale);
      await expect(page.locator('.page-heading h1')).toHaveText(title);
      await expect(page.locator('.workspace-breadcrumb')).toHaveText(`LT / ${title}`);
      const fabric = servers.find(row => row.server.type === 'fabric')!;
      await page.locator('.server-switcher select').selectOption(fabric.server.id);
      await expect(page.locator('.nav-item[href^="/addons"] > span')).toHaveText(mods);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath(`servers-${locale}-${width}.png`), fullPage: true, animations: 'disabled' });
      if (width < 1200) await page.locator('.menu-button').click();
      await page.screenshot({ path: testInfo.outputPath(`navigation-${locale}-${width}.png`), fullPage: true, animations: 'disabled' });
      if (width < 1200) await page.locator('.sidebar__close').click();
    }
    await page.reload(); await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await page.goto('/settings'); await expect(page.locator('.appearance-settings')).toBeVisible();
    await expect(page.locator('.auth-page')).toHaveCount(0);
    expect(requests.filter(request => request.includes('/access/'))).toEqual([]);
    expect(requests.filter(request => !request.startsWith('GET '))).toEqual([]);
  } finally { await mock.close(); }
});
