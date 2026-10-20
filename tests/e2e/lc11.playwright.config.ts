import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
export default defineConfig({
  testDir: '.', testMatch: 'lc11-discovery.spec.ts', workers: 1, retries: 0,
  outputDir: `../../test-results/lc11-browser-${randomUUID()}`, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3014', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
});
