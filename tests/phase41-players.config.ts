import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../playwright.config.js';
const root = fileURLToPath(new URL('../', import.meta.url));
process.env.MCSM_PLAYERS_E2E = '1';
export default defineConfig({ ...base, testDir: './e2e', testMatch: 'phase41-players.spec.ts',
  outputDir: `${root}/test-results/p41-browser-artifacts`, reporter: [['list']],
  webServer: process.env.MCSM_PLAYERS_EXTERNAL === '1' ? [] : [
  { command: 'node --import tsx tests/e2e/fixtures/phase41-api.ts', cwd: root, url: 'http://127.0.0.1:8080/api/v1/health', reuseExistingServer: false, timeout: 30000 },
  { command: 'node node_modules/vite/bin/vite.js apps/web --config apps/web/vite.config.ts', cwd: root, url: 'http://127.0.0.1:3000', reuseExistingServer: false, timeout: 30000 }
] });
