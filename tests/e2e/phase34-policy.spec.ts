import { expect, test } from '@playwright/test';
test.skip(process.env.MCSM_POLICY_E2E !== '1', 'Requires fresh synthetic policy API');
for (const width of [360, 768, 1440]) {
  test(`daily schedule and guarded union retention at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.goto(`/backups?server=vanilla-policy-${width}`);
    await expect(page.getByLabel('启用每日备份')).not.toBeChecked(); await expect(page.getByLabel('启用安全保留清理')).not.toBeChecked();
    await expect(page.getByRole('button', { name: '保存备份计划' })).toBeDisabled();
    await page.getByLabel('启用每日备份').check(); await page.getByLabel('每日时间').fill('23:59'); await page.getByLabel('IANA 时区').fill('America/New_York');
    const schedule = page.waitForResponse((response) => response.url().endsWith('/backup-schedule') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '保存备份计划' }).click(); expect((await schedule).status()).toBe(200);
    await expect(page.getByText('计划已保存。')).toBeVisible(); await page.reload();
    await expect(page.getByLabel('启用每日备份')).toBeChecked(); await expect(page.getByLabel('IANA 时区')).toHaveValue('America/New_York');
    await page.getByLabel('至少保留最近份数').fill('1'); await page.getByLabel('至少保留最近天数').fill('1'); await page.getByLabel('启用安全保留清理').check();
    page.once('dialog', (dialog) => dialog.accept());
    const policy = page.waitForResponse((response) => response.url().endsWith('/backup-retention') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '保存保留策略' }).click(); expect((await policy).status()).toBe(200);
    await expect(page.getByRole('button', { name: '按已保存策略清理' })).toBeEnabled(); page.once('dialog', (dialog) => dialog.accept());
    const cleanup = page.waitForResponse((response) => response.url().endsWith('/backup-retention/run') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '按已保存策略清理' }).click(); const result = await cleanup; expect(result.status()).toBe(200);
    expect((await result.json()).data.lastRun).toMatchObject({ state: 'completed', removed: expect.any(Array) });
    await expect(page.getByText('上次清理：completed · 删除 2 份 · 保留 1 份')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Old fixture 2' })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Old fixture 0' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: `test-results/screenshots/phase34-policy-${width}.png`, fullPage: true });
    const response = await page.request.get(`/api/v1/servers/vanilla-policy-${width}/backups`); expect((await response.json()).data.items).toHaveLength(1);
  });
}
