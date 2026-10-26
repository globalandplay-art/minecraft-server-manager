import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: '.', testMatch: 'ui2-workspace.spec.ts', workers: 1, retries: 0,
  outputDir: '../../test-results/ui2-browser-v1', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3019', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: { cwd: fileURLToPath(new URL('../..', import.meta.url)), command: 'node node_modules/vite/bin/vite.js apps/web --config apps/web/vite.config.ts --port 3019', url: 'http://127.0.0.1:3019', reuseExistingServer: false },
});
