import { expect, test } from '@playwright/test';
import { buildApp } from '../../apps/api/src/app.js';

for (const width of [360, 768, 1440]) {
  test(`dual theme workspace ${width}`, async ({ page }, testInfo) => {
    const mock = buildApp({ mode: 'mock' }); await mock.ready();
    const mutations: string[] = [];
    try {
      await page.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url());
        if (request.method() !== 'GET') mutations.push(request.method() + url.pathname);
        if (url.pathname === '/api/v1/auth/status') return route.fulfill({ json: { data: { configured: false, authenticationRequired: false, auditReady: false } } });
        if (url.pathname.startsWith('/api/v1/access/')) return route.fulfill({ status: 503, json: { error: { code: 'ACCESS_UNAVAILABLE', message: 'Remote access paused.' } } });
        const response = await mock.inject({ method: 'GET', url: url.pathname + url.search, headers: { host: '127.0.0.1:8080' } });
        await route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/settings');
      await expect(page.locator('.appearance-settings')).toBeVisible();
      for (const language of ['zh-CN', 'ja']) {
        await page.locator('.topbar .language-selector select').selectOption(language);
        for (const theme of ['light', 'dark']) {
          await page.locator('.topbar .theme-selector select').selectOption(theme);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await page.locator('.topbar .theme-selector select').focus();
          expect(await page.locator('.topbar .theme-selector select').evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
          expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(theme === 'light' ? 'rgb(247, 247, 244)' : 'rgb(27, 29, 30)');
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          const controls = await page.locator('.topbar select').evaluateAll(elements => elements.map(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; }));
          for (let a = 0; a < controls.length; a++) for (let b = a + 1; b < controls.length; b++) {
            const x = controls[a]!, y = controls[b]!;
            expect(x.right <= y.x || y.right <= x.x || x.bottom <= y.y || y.bottom <= x.y).toBe(true);
          }
          await page.screenshot({ path: testInfo.outputPath(`${language}-${theme}-${width}.png`), fullPage: true, animations: 'disabled' });
        }
      }
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
      await page.locator('.topbar .theme-selector select').selectOption('system');
      await page.emulateMedia({ colorScheme: 'light' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await page.emulateMedia({ colorScheme: 'dark' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await page.locator('.topbar .theme-selector select').selectOption('light');
      await page.emulateMedia({ colorScheme: 'dark' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      for (const route of ['/dashboard', '/servers', '/players', '/worlds', '/addons', '/console', '/performance', '/backups', '/crashes']) {
        await page.goto(route);
        await expect(page.locator('.main-content')).toBeVisible();
        await expect(page.locator('.main-content .page-heading h1').first()).toBeVisible();
        await expect(page.locator('.main-content .page-heading h1').first()).not.toHaveText(/ページを読み込み中|正在加载页面|Loading page/);
        if (route === '/servers') await expect(page.locator('.workspace-server-table tbody tr').first()).toBeVisible();
        if (route === '/dashboard') await expect(page.locator('.server-hero')).toBeVisible();
        for (const theme of ['light', 'dark']) {
          await page.locator('.topbar .theme-selector select').selectOption(theme);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          if (['/dashboard', '/servers', '/console'].includes(route)) await page.screenshot({ path: testInfo.outputPath(`${route.slice(1)}-${theme}-${width}.png`), fullPage: true, animations: 'disabled' });
        }
      }
      expect(mutations).toEqual([]);
    } finally { await mock.close(); }
  });
}

test('theme is applied before React executes with storage blocked and system dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get: () => { throw new Error('restricted'); } }); });
  await page.route('**/src/main.tsx*', route => route.abort());
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('dark');
  expect(await page.locator('#root').textContent()).toBe('');
});
