import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
export default defineConfig({
  testDir: '.', testMatch: ['lm1-performance.spec.ts', 'lc2-members.spec.ts', 'phase72-auth.spec.ts'], workers: 1, retries: 0,
  outputDir: `../../test-results/debt-closure-browser-${randomUUID()}`, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3014', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
});
