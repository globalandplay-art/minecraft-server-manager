import { expect,test } from '@playwright/test';
test.skip(process.env.MCSM_ARCHIVE_E2E !== '1','Requires isolated synthetic archive API');
for (const width of [360,768,1440]) {
  test(`archive confirms complete world-set and prevents empty-world start at ${width}px`,async ({ page }) => {
    const server = `vanilla-archive-${width}`;
    await page.setViewportSize({ width,height:900 }); await page.goto(`/worlds?server=${server}`);
    const submit = page.getByRole('button',{ name:'确认归档并保持停服' }); await expect(submit).toBeDisabled();
    await page.getByLabel('输入世界名确认归档').fill('world'); await expect(submit).toBeDisabled();
    await page.getByLabel('我确认归档完整世界集，并允许必要停服').check();
    const accepted = page.waitForResponse((res) => res.url().endsWith('/worlds/archive') && res.request().method() === 'POST');
    await submit.click(); const response = await accepted; expect(response.status()).toBe(202);
    const submitted = response.request().postDataJSON(); expect(submitted).toMatchObject({ intent:'archive-world-set',confirmWorldName:'world',allowStop:true });
    expect(submitted.worldRevision).toMatch(/^[a-f0-9]{64}$/u); expect(Object.keys(submitted).sort()).toEqual(['allowStop','confirmWorldName','intent','worldId','worldRevision']);
    await expect(page.getByText('世界归档完成；当前没有活动世界，服务器保持停止。')).toBeVisible();
    await expect(page.getByText('完整世界集已核验，保护备份已固定。',{ exact:false })).toBeVisible();
    await expect(page.getByRole('heading',{ name:'未发现可管理的世界' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path:`test-results/screenshots/phase3-archive-${width}.png`,fullPage:true });
    await page.reload(); await expect(page.getByText('完整世界集已核验，保护备份已固定。',{ exact:false })).toBeVisible();
    await expect(page.getByRole('button',{ name:'确认归档并保持停服' })).toHaveCount(0);
    const blocked = await page.request.post(`/api/v1/servers/${server}/actions/start`,{ headers:{ 'X-Manager-Intent':'local-ui','Idempotency-Key':crypto.randomUUID(),Origin:'http://127.0.0.1:3000' },data:{} });
    expect(blocked.status()).toBe(409); expect((await blocked.json()).error.code).toBe('NO_ACTIVE_WORLD');
  });
}
