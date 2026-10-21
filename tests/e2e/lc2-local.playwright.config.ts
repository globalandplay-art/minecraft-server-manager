import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
export default defineConfig({
  testDir: '.', testMatch: 'lc2-local.spec.ts', fullyParallel: false, workers: 1, retries: 0,
  outputDir: `../../test-results/lc2-local-browser-${randomUUID()}`, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3013', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }]
});
