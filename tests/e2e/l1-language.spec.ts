import { expect, test } from '@playwright/test';
import { buildApp } from '../../apps/api/src/app.js';

// Real Chrome/Vite and injected mock HTTP only. No Java or real credentials.
for (const width of [360, 768, 1440]) {
  test(`L1 language selection persistence and shell layout ${width}`, async ({ page }, testInfo) => {
    const mock = buildApp({ mode: 'mock' });
    await mock.ready();
    try {
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/v1/auth/status') return route.fulfill({ json: { data: { configured: false, authenticationRequired: false, auditReady: false } } });
        // This L1 fixture has no authenticated Access provider. Return explicit
        // unavailability rather than injecting unrelated401s that invalidate the
        // whole app session. No remote action or authentication rule is changed.
        if (url.pathname.startsWith('/api/v1/access/')) return route.fulfill({ status: 503, json: { error: { code: 'ACCESS_UNAVAILABLE', message: 'Remote access is paused in this fixture.' } } });
        const response = await mock.inject({ method: 'GET', url: url.pathname + url.search, headers: { host: '127.0.0.1:8080' } });
        await route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/settings');
      await expect(page.getByRole('heading', { name: 'Language and region' })).toBeVisible();
      const selector = page.getByRole('combobox', { name: 'Interface language' }).last();
      await selector.selectOption('ja');
      await expect(page.getByRole('heading', { name: '言語と地域' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const languageBox = await page.locator('.topbar .language-selector').boundingBox();
      const instanceBox = await page.locator('.topbar .server-switcher select').boundingBox();
      expect(languageBox).not.toBeNull(); expect(instanceBox).not.toBeNull();
      if (languageBox && instanceBox) expect(languageBox.x + languageBox.width <= instanceBox.x || instanceBox.x + instanceBox.width <= languageBox.x || languageBox.y + languageBox.height <= instanceBox.y || instanceBox.y + instanceBox.height <= languageBox.y).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`ja-${width}.png`), fullPage: true });
      await page.reload();
      await expect(page.getByRole('heading', { name: '言語と地域' })).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem('lt.interface-language.v1'))).toBe('ja');
      await page.getByRole('combobox', { name: '表示言語' }).last().selectOption('zh-CN');
      await expect(page.getByRole('heading', { name: '语言与地区' })).toBeVisible();
      await page.getByRole('combobox', { name: '界面语言' }).last().selectOption('en');
      await expect(page.getByRole('heading', { name: 'Language and region' })).toBeVisible();
      if (width < 1100) await page.getByRole('button', { name: 'Open main navigation' }).click();
      await page.getByRole('link', { name: /^Servers/ }).click();
      await expect(page.getByRole('heading', { name: 'Servers', exact: true })).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem('lt.interface-language.v1'))).toBe('en');
    } finally { await mock.close(); }
  });
}
