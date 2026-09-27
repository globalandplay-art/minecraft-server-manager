import { expect, test, type Page } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const reviewDir = 'test-results/screenshots';
const sentinelPath = join(process.cwd(), '.manager', 'e2e-vite-sentinel.txt');
const sentinelValue = 'phase1-non-sensitive-vite-fs-sentinel';

async function expectNoPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(dimensions.body, 'body should not overflow horizontally').toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.document, 'document should not overflow horizontally').toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function openDashboard(page: Page) {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(page.locator('.metric-card')).toHaveCount(8);
}

test.beforeAll(async () => {
  await mkdir(reviewDir, { recursive: true });
  await mkdir(join(process.cwd(), '.manager'), { recursive: true });
  await writeFile(sentinelPath, sentinelValue, 'utf8');
});

test.afterAll(async () => {
  await rm(sentinelPath, { force: true });
});

test('Vite 不通过 /@fs 暴露管理器私有目录', async ({ request }) => {
  const fsPath = sentinelPath.replaceAll('\\', '/');
  const response = await request.get(`http://127.0.0.1:3000/@fs/${fsPath}`);
  expect(response.status()).not.toBe(200);
  expect(await response.text()).not.toContain(sentinelValue);
});

test('真实 3000 + 8080 链路呈现八项 Mock 指标', async ({ page, request }) => {
  const healthFromBrowser = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/health') && response.status() === 200,
  );
  const overviewFromBrowser = page.waitForResponse(
    (response) => response.url().includes('/api/v1/servers/') && response.url().endsWith('/overview') && response.status() === 200,
  );

  await openDashboard(page);

  const [healthResponse, overviewResponse] = await Promise.all([
    healthFromBrowser,
    overviewFromBrowser,
  ]);
  expect(new URL(healthResponse.url()).port).toBe('3000');
  expect((await healthResponse.json()).meta.mode).toBe('mock');
  expect((await overviewResponse.json()).data.summary.server.id).toBe('paper-demo');

  const directApi = await request.get('http://127.0.0.1:8080/api/v1/health');
  expect(directApi.ok()).toBeTruthy();
  expect((await directApi.json()).data.apiVersion).toBe('1');

  await expect(page.getByText('MOCK DATA', { exact: true })).toBeVisible();
  await expect(page.locator('.metric-card__header > span:first-child')).toHaveText([
    'SERVER STATUS',
    'PLAYERS',
    'TPS',
    'MSPT',
    'CPU',
    'RAM',
    'DISK',
    'UPTIME',
  ]);
  for (const label of ['TPS', 'MSPT']) {
    const card = page.locator('.metric-card').filter({ hasText: label });
    await expect(card.locator('.metric-card__value')).toHaveText('N/A');
    await expect(card).toContainText('未采集');
  }
  await expect(page.getByText('RAM：MC 进程 RSS')).toBeVisible();
  await expect(page.getByText('Disk：服务端目录所在卷')).toBeVisible();
  await expect(page.getByRole('button', { name: '启动' })).toBeDisabled();
  await expect(page.getByText('Phase 2 接入本地服务器后启用')).toBeVisible();
});

test('三档视口无主页面横向溢出并保存 UI Review 截图', async ({ page }) => {
  const viewports = [
    { width: 360, height: 800 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await openDashboard(page);
    await expectNoPageOverflow(page);
    await page.screenshot({
      path: `${reviewDir}/dashboard-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
  }

  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/dashboard');
  const menu = page.getByRole('button', { name: '打开主导航' });
  await menu.click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Worlds/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Backups/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
});

test('实例切换、刷新和 Servers 入口保留 server query', async ({ page }) => {
  await openDashboard(page);
  const switcher = page.getByRole('combobox', { name: '选择服务器实例' });

  await switcher.selectOption('vanilla-demo');
  await expect(page).toHaveURL(/\/dashboard\?server=vanilla-demo$/);
  await expect(page.getByRole('heading', { name: 'Vanilla 建筑服 · 示例', level: 2 })).toBeVisible();

  await page.reload();
  await expect(switcher).toHaveValue('vanilla-demo');
  await expect(page.getByRole('heading', { name: 'Vanilla 建筑服 · 示例', level: 2 })).toBeVisible();

  await page.getByRole('link', { name: 'Servers', exact: true }).click();
  await expect(page).toHaveURL(/\/servers\?server=vanilla-demo$/);
  const paperCard = page.locator('.server-card').filter({ hasText: 'Survival · 示例' });
  await paperCard.getByRole('link', { name: '查看 Dashboard' }).click();
  await expect(page).toHaveURL(/\/dashboard\?server=paper-demo$/);
  await expect(page.getByRole('heading', { name: 'Survival · 示例', level: 2 })).toBeVisible();
});

test('阶段占位页来自后端 features 且不会提供伪操作', async ({ page }) => {
  const pages = [
    ['/players', 'Players', 'Phase 4'],
    ['/worlds', 'Worlds', 'Phase 3'],
    ['/console', 'Console', 'Phase 2'],
    ['/performance', 'Performance', 'Phase 6'],
    ['/backups', 'Backups', 'Phase 3'],
    ['/crashes', 'Crash Analysis', 'Phase 6'],
  ] as const;

  for (const [path, heading, phase] of pages) {
    await page.goto(`${path}?server=paper-demo`);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByText(phase, { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${path.replace('/', '\\/')}\\?server=paper-demo$`));
  }

  await page.goto('/console?server=paper-demo');
  await expect(page.locator('input')).toHaveCount(0);
  await expect(page.getByText('当前没有输入框，也不会模拟命令成功。')).toBeVisible();
});

test('未知实例明确报错且不会悄悄切换', async ({ page }) => {
  await page.goto('/dashboard?server=does-not-exist');
  await expect(page.getByRole('heading', { name: '实例不存在 / 已移除' })).toBeVisible();
  await expect(page).toHaveURL(/server=does-not-exist$/);
  await expect(page.locator('.metric-card')).toHaveCount(0);
});

test('空实例列表显示引导而不展示正常示例', async ({ page }) => {
  await page.route('**/api/v1/servers', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { items: [] },
        meta: {
          requestId: 'req-e2e-empty',
          generatedAt: new Date().toISOString(),
          mode: 'mock',
        },
      }),
    });
  });

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: '没有可显示的服务器' })).toBeVisible();
  await expect(page.getByText('Survival · 示例')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '选择服务器实例' })).toBeDisabled();
});

test('合约错误显示安全错误，不拼接 Dashboard 数据', async ({ page }) => {
  await page.route('**/api/v1/servers/paper-demo/overview', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { invalid: true },
        meta: {
          requestId: 'req-e2e-schema',
          generatedAt: new Date().toISOString(),
          mode: 'mock',
        },
      }),
    });
  });

  await page.goto('/dashboard?server=paper-demo');
  await expect(page.getByRole('heading', { name: '后端响应格式异常' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.metric-card')).toHaveCount(0);
});

test('API 断线保留快照，15 秒后标旧数据，重试可恢复', async ({ page }) => {
  await openDashboard(page);
  await page.route('**/api/v1/servers/paper-demo/overview', async (route) => {
    await route.abort('failed');
  });

  await page.getByRole('button', { name: '刷新数据' }).click();
  await expect(page.getByText('管理器 API 连接异常')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Survival · 示例', level: 2 })).toBeVisible();
  await expect(page.getByText('超过 15 秒未获得成功快照')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.stale-label')).toHaveCount(8);
  const statusCard = page.locator('.metric-card').filter({ hasText: 'SERVER STATUS' });
  await expect(statusCard).toContainText('未知');
  await expect(statusCard).toContainText('上次：运行中');

  await page.unroute('**/api/v1/servers/paper-demo/overview');
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByText('管理器 API 连接异常')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText('超过 15 秒未获得成功快照')).toHaveCount(0);
  await expect(statusCard).toContainText('运行中');
});

test('Servers API 断线超过 15 秒后降级状态并可恢复', async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto('/servers?server=paper-demo');
  await expect(page.getByRole('heading', { name: 'Servers', level: 1 })).toBeVisible();
  const paperCard = page.locator('.server-card').filter({ hasText: 'Survival · 示例' });
  await expect(paperCard).toContainText('运行中');

  await page.route('**/api/v1/servers', async (route) => {
    await route.abort('failed');
  });

  await expect(page.getByText('管理器 API 连接异常')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText('服务器列表超过 15 秒未刷新成功')).toBeVisible();
  await expect(paperCard).toContainText('未知');
  await expect(paperCard).toContainText('上次状态');
  await expect(paperCard).toContainText('运行中');

  await page.unroute('**/api/v1/servers');
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByText('管理器 API 连接异常')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText('服务器列表超过 15 秒未刷新成功')).toHaveCount(0);
  await expect(paperCard).toContainText('状态采样');
  await expect(paperCard).toContainText('运行中');
});

test('Servers 列表刷新挂起超过 15 秒时不继续显示实时状态', async ({ page }) => {
  test.setTimeout(40_000);
  await page.goto('/servers?server=paper-demo');
  await expect(page.getByRole('heading', { name: 'Servers', level: 1 })).toBeVisible();
  const paperCard = page.locator('.server-card').filter({ hasText: 'Survival · 示例' });
  await expect(paperCard).toContainText('运行中');

  let releaseRequest = () => {};
  let signalPending = () => {};
  const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve; });
  const pendingStarted = new Promise<void>((resolve) => { signalPending = resolve; });
  await page.route('**/api/v1/servers', async (route) => {
    signalPending();
    await requestGate;
    await route.continue();
  });

  try {
    await pendingStarted;
    await expect(page.getByText('服务器列表超过 15 秒未刷新成功')).toBeVisible({ timeout: 5_000 });
    await expect(paperCard).toContainText('未知');
    await expect(paperCard).toContainText('上次状态');
  } finally {
    releaseRequest();
  }

  await expect(page.getByText('服务器列表超过 15 秒未刷新成功')).toHaveCount(0, { timeout: 10_000 });
  await expect(paperCard).toContainText('状态采样');
  await expect(paperCard).toContainText('运行中');
});
