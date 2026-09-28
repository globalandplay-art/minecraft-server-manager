import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const realServerId = process.env.MCSM_REAL_SERVER_ID?.trim();
const screenshotDir = 'test-results/screenshots';

async function expectNoPageOverflow(page: import('@playwright/test').Page) {
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(dimensions.body, 'body should not overflow horizontally').toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.document, 'document should not overflow horizontally').toBeLessThanOrEqual(dimensions.viewport + 1);
}

test.describe('Phase 2 real local read-only smoke', () => {
  test.skip(!realServerId, 'Set MCSM_REAL_SERVER_ID to opt in to the real local smoke test.');

  test.beforeAll(async () => {
    await mkdir(screenshotDir, { recursive: true });
  });

  test('Dashboard and Console show the configured local server and its live log snapshot', async ({ page }) => {
    const serverId = realServerId!;
    const query = `?server=${encodeURIComponent(serverId)}`;
    const overviewResponse = page.waitForResponse((response) =>
      response.request().method() === 'GET'
      && response.url().includes(`/api/v1/servers/${encodeURIComponent(serverId)}/overview`)
      && response.status() === 200,
    );

    await page.goto(`/dashboard${query}`);
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await expect(page.locator('.metric-card')).toHaveCount(8);
    await expect(page.getByText('MOCK DATA', { exact: true })).toHaveCount(0);

    const overview = await (await overviewResponse).json() as {
      data?: { summary?: { server?: { id?: string } } };
      meta?: { mode?: string };
    };
    expect(overview.meta?.mode).toBe('local');
    expect(overview.data?.summary?.server?.id).toBe(serverId);

    const webSocketOpened = page.waitForEvent('websocket', (socket) =>
      socket.url().includes(`/ws/v1/servers/${encodeURIComponent(serverId)}/events`),
    );
    await page.goto(`/console${query}`);
    await webSocketOpened;

    await expect(page.getByRole('heading', { name: 'Console', level: 1 })).toBeVisible();
    await expect(page.locator('.console-connection')).toHaveText('已连接', { timeout: 15_000 });
    await expect(page.locator('.log-line').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('textbox', { name: 'Minecraft 命令' })).toBeVisible();

    await page.addStyleTag({
      content: '.log-text { color: transparent !important; text-shadow: none !important; }',
    });
    await page.screenshot({
      path: `${screenshotDir}/phase2-console-desktop.png`,
      fullPage: true,
    });

    for (const viewport of [
      { width: 768, height: 1024, name: 'tablet' },
      { width: 360, height: 800, name: 'mobile' },
    ]) {
      await page.setViewportSize(viewport);
      await expectNoPageOverflow(page);

      const search = page.getByRole('textbox', { name: '搜索日志' });
      const level = page.getByRole('combobox', { name: '级别' });
      const autoScroll = page.getByRole('checkbox', { name: '自动滚动' });
      await expect(search).toBeVisible();
      await expect(level).toBeVisible();
      await expect(autoScroll).toBeVisible();

      await search.fill('__phase2_layout_smoke_no_match__');
      await expect(page.getByText('没有符合筛选条件的日志。')).toBeVisible();
      await search.fill('');
      await level.selectOption('warn');
      await expect(level).toHaveValue('warn');
      await level.selectOption('all');
      await autoScroll.uncheck();
      await expect(autoScroll).not.toBeChecked();
      await autoScroll.check();
      await expect(autoScroll).toBeChecked();

      await page.screenshot({
        path: `${screenshotDir}/phase2-console-${viewport.name}-${viewport.width}x${viewport.height}.png`,
        fullPage: true,
      });
    }
  });
});
