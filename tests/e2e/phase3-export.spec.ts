import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Requires tests/phase3-export.config.ts: real manager API over synthetic immutable backups.
// It does not launch or operate a real Minecraft server.
test.skip(process.env.MCSM_EXPORT_E2E !== '1', 'Requires the isolated synthetic export API configuration');
for (const width of [360, 768, 1440]) {
  test(`world export downloads a verified ZIP without page overflow at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const response = await request.get('/api/v1/servers/vanilla-test/backups');
    expect(response.ok()).toBeTruthy();
    const backup = (await response.json()).data.items.find((item: { scope: string }) => item.scope === 'world-set');
    await page.goto('/backups?server=vanilla-test');
    await expect(page.getByRole('button', { name: 'Download World Set' })).toHaveCount(1);
    await expect(page.getByText('私有服务端快照禁止下载')).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download World Set' }).click();
    const download = await downloadPromise;
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toBe(`world-set-${backup.id}.zip`);
    const downloadedPath = await download.path(); expect(downloadedPath).not.toBeNull();
    const bytes = await readFile(downloadedPath!);
    const status = await request.get(`/api/v1/servers/vanilla-test/backups/${backup.id}/exports`);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe((await status.json()).data.checksumSha256);
    expect(bytes.includes(Buffer.from('synthetic-private-sentinel'))).toBe(false);
    await expect(page.getByRole('link', { name: '下载世界备份' })).toBeVisible();
    const retryDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '重新校验并下载' }).click();
    const retryDownload = await retryDownloadPromise;
    expect(await retryDownload.failure()).toBeNull();
    expect(retryDownload.suggestedFilename()).toBe(download.suggestedFilename());
    expect(await readFile((await retryDownload.path())!)).toEqual(bytes);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: `test-results/screenshots/phase3-export-${width}.png`, fullPage: true });
  });
}
