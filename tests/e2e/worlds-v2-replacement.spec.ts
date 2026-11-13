import { expect, test } from '@playwright/test';
// Real React/Fastify/journals; synthetic world bytes, never Minecraft acceptance.
for (const width of [360, 768, 1440]) {
  test(`replaces and explicitly verifies a synthetic world at ${width}px`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(({ theme }) => {
      localStorage.setItem('lt.interface-language.v1', 'en'); localStorage.setItem('lt.appearance.v1', theme);
    }, { theme: width === 768 ? 'dark' : 'light' });
    const serverId = `replace-${width}`, base = `/api/v1/servers/${serverId}/world-library`;
    const before = await request.get(base); expect(before.ok()).toBe(true); const previousId = (await before.json()).data.activeWorldId;
    await page.goto(`/worlds?server=${serverId}`);
    await page.getByRole('button', { name: '选择此暂存规划导入', exact: true }).click();
    await page.getByText('Replace current world (confirmation required)', { exact: true }).click();
    await page.getByRole('button', { name: 'Check replacement plan', exact: true }).click();
    await page.getByLabel('Type the current world name to confirm replacement', { exact: true }).fill('world');
    await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('ja');
    await expect(page.getByLabel('置き換える現在のワールド名を入力して確認', { exact: true })).toHaveValue('world');
    await page.getByRole('combobox', { name: '表示言語', exact: true }).selectOption('zh-CN');
    await expect(page.getByLabel('输入当前世界名称确认替换', { exact: true })).toHaveValue('world');
    await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Confirm world replacement', exact: true }).click();
    const verify = page.getByRole('button', { name: 'Verify saved replacement result', exact: true });
    await expect(verify).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Replacement and the new world identity were verified/)).toHaveCount(0);
    await verify.click();
    await expect(page.getByText(/Replacement and the new world identity were verified/)).toBeVisible({ timeout: 30_000 });
    const after = await request.get(base); expect(after.ok()).toBe(true); const library = (await after.json()).data;
    expect(library.activeWorldId).not.toBe(previousId);
    expect(library.items.find((item: { worldId: string }) => item.worldId === previousId)?.state).toBe('retired');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: testInfo.outputPath(`replacement-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Done', exact: true }).click(); await page.reload();
    expect(await page.evaluate(id => sessionStorage.getItem(`lt.pendingWorldReplacement.${id}`), serverId)).toBeNull();
  });
}
