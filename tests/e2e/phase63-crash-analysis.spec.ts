import { expect, test } from '@playwright/test';

for (const width of [360, 768, 1440]) {
  test(`manual bounded crash evidence ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let requests = 0;
    let state: 'findings' | 'partial' | 'error' = 'findings';
    await page.route('**/api/v1/servers/*/crash-analysis', async (route) => {
      requests++;
      if (state === 'error') {
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: {
          code: 'CRASH_EVIDENCE_UNSAFE', message: '日志证据无法安全读取' },
          meta: { requestId: 'browser', mode: 'local', generatedAt: '2026-10-08T00:00:00Z' } }) }); return;
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: {
        status: 'available', reason: null, sampledAt: '2026-10-08T00:00:00Z', minimumIntervalMs: 5000,
        incomplete: state === 'partial', conclusion: state === 'partial' ? 'insufficient-evidence' : 'possible-causes',
        sources: [{ id: 'latest-log', source: 'latest-log', truncated: state === 'partial' }],
        findings: state === 'partial' ? [] : [{ code: 'out-of-memory', confidence: 'possible', title: '可能存在内存分配失败',
          guidance: '核对完整异常，不自动调整内存。', evidence: [{ sourceId: 'latest-log', excerptLine: 1,
            snippet: `OutOfMemoryError [REDACTED] ${'x'.repeat(800)}` }] }],
        limitations: ['bounded-local-evidence', 'possible-not-certain', 'excerpt-line-not-file-line', 'no-automatic-repair'] },
        meta: { requestId: 'browser', mode: 'local', generatedAt: '2026-10-08T00:00:00Z' } }) });
    });
    await page.goto('/crashes?server=paper-demo');
    await expect(page.getByRole('heading', { name: 'Crash Analysis', exact: true })).toBeVisible();
    expect(requests).toBe(0);
    const refresh = page.getByRole('button', { name: '读取崩溃证据', exact: true });
    await refresh.click();
    await expect(page.getByRole('heading', { name: '可能存在内存分配失败 · 可能' })).toBeVisible();
    await expect(page.getByText(/不是完整文件行号/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    state = 'partial'; await refresh.click();
    await expect(page.getByText('证据不足，无法给出可能原因。')).toBeVisible();
    await expect(page.locator('pre')).toHaveCount(0);
    state = 'error'; await refresh.click();
    await expect(page.getByText(/日志证据无法安全读取/)).toBeVisible();
    await expect(page.getByRole('region', { name: '崩溃分析结果' })).toHaveCount(0);
    expect(requests).toBe(3);
  });
}

test('actual mock crash API stays unavailable without fabricated evidence', async ({ page }) => {
  await page.goto('/crashes?server=paper-demo');
  await page.getByRole('button', { name: '读取崩溃证据' }).click();
  await expect(page.getByText('分析不可用', { exact: true })).toBeVisible();
  await expect(page.locator('pre')).toHaveCount(0);
});
