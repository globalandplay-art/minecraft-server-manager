import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../playwright.config.js';

const root = fileURLToPath(new URL('../', import.meta.url));
process.env.MCSM_EXPORT_E2E = '1';
export default defineConfig({ ...base, testDir: './e2e', testMatch: 'phase3-export.spec.ts',
  webServer: [
    { command: 'node --import tsx tests/e2e/fixtures/phase3-api.ts', cwd: root,
      url: 'http://127.0.0.1:8080/api/v1/health', reuseExistingServer: false, timeout: 30_000 },
    { command: 'node node_modules/vite/bin/vite.js apps/web --config apps/web/vite.config.ts', cwd: root,
      url: 'http://127.0.0.1:3000', reuseExistingServer: false, timeout: 30_000 },
  ] });
