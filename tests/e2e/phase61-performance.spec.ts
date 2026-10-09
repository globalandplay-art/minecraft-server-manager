import { expect, test } from '@playwright/test';

for (const width of [360, 768, 1440]) {
  test(`performance session snapshots ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/performance');
    await expect(page.getByRole('heading', { name: 'Performance', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: '性能采样' })).toBeVisible();
    await expect(page.getByText(/历史快照，不代表持续实时监测/)).toBeVisible();
    await page.getByText('查看采样历史', { exact: true }).click();
    await expect(page.getByRole('region', { name: '性能采样' }).getByRole('listitem').first()).toBeVisible();
    await expect(page.getByRole('button', { name: '刷新采样' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
