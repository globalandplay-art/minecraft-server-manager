import { expect, test } from '@playwright/test';

// Real frontend + Fastify + journals/files, synthetic NBT, no Minecraft/Java.
for (const width of [360, 768, 1440]) {
  test(`confirms a saved world activation at ${width}px without starting Minecraft`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem('lt.interface-language.v1', 'en'));
    const base = '/api/v1/servers/v2-browser/world-library';
    const before = await request.get(base); expect(before.ok()).toBe(true);
    const world = (await before.json()).data.items.find((item: { levelName: string }) => item.levelName === `Browser-${width}`);
    expect(world).toBeTruthy();
    await page.goto('/worlds?server=v2-browser');
    await page.getByRole('combobox', { name: 'Target world', exact: true }).selectOption(world.worldId);
    await page.getByRole('button', { name: 'Check activation plan', exact: true }).click();
    await expect(page.getByText(/Read-only checks completed/)).toBeVisible();
    await page.getByLabel('Type the target world name to confirm', { exact: true }).fill(world.levelName);
    await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('ja');
    await expect(page.getByLabel('切り替え先のワールド名を入力して確認', { exact: true })).toHaveValue(world.levelName);
    await page.getByRole('combobox', { name: '表示言語', exact: true }).selectOption('en');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Confirm world activation', exact: true }).click();
    await expect(page.getByText(/World activation completed and the saved active world was verified/)).toBeVisible({ timeout: 30_000 });
    const after = await request.get(base); expect(after.ok()).toBe(true);
    expect((await after.json()).data.activeWorldId).toBe(world.worldId);
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: testInfo.outputPath(`worlds-v2-activation-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Target world', exact: true })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('lt.pendingWorldActivation.v2-browser'))).toBeNull();
  });
}
