import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'phase72b-tailscale.spec.ts', fullyParallel: false, workers: 1, retries: 0,
  outputDir: '../../test-results/p72b-b-artifacts', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3001', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
});
