import { defineConfig, devices } from '@playwright/test';

// No API listener or reuse of the host Manager. Business reads use in-process mock fixtures.
export default defineConfig({
  testDir: '.', testMatch: 'phase72-auth.spec.ts', fullyParallel: false, workers: 1, retries: 0,
  outputDir: '../../test-results/p72-browser-artifacts', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3001', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js apps/web --config apps/web/vite.config.ts --port 3001',
    cwd: '../..', url: 'http://127.0.0.1:3001', reuseExistingServer: false,
  },
});
