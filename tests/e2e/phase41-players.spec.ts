import { expect, test } from '@playwright/test';
test.skip(process.env.MCSM_PLAYERS_E2E !== '1', 'Requires dedicated read-only Players fixture');
for (const width of [360, 768, 1440]) {
  test(`Players truthful states at ${width}px (synthetic RCON)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/players?server=players-names-${width}`);
    await expect(page.getByText('Steve', { exact: true })).toBeVisible();
    await expect(page.getByText('Alex', { exact: true })).toBeVisible();
    await expect(page.getByText('2 位 · 完整名单')).toBeVisible();
    await page.getByRole('button', { name: '刷新在线名单' }).click();
    await expect(page.getByRole('button', { name: '刷新在线名单' })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    await page.goto(`/players?server=players-empty-${width}`);
    await expect(page.getByText('当前没有在线玩家。')).toBeVisible();
    await page.goto(`/players?server=players-stopped-${width}`);
    await expect(page.getByText('在线名单暂不可用')).toBeVisible();
    await expect(page.getByText('当前没有在线玩家。')).toHaveCount(0);
    await expect(page.getByText('Steve', { exact: true })).toHaveCount(0);
    const response = await page.request.get(`/api/v1/servers/players-stopped-${width}/players`);
    expect(response.status()).toBe(200); expect((await response.json()).data.availability).toBe('unavailable');
  });
}
