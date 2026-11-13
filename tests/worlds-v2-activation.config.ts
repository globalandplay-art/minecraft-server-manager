import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import base from '../playwright.config.js';
const evidenceRoot = fileURLToPath(new URL('../test-results/', import.meta.url));
const runId = `worlds-v2-activation-browser-${randomUUID()}`;
export default defineConfig({ ...base, testDir: './e2e', testMatch: 'worlds-v2-activation.spec.ts', retries: 0,
  maxFailures: 1,
  outputDir: path.join(evidenceRoot, `${runId}-artifacts`),
  reporter: [['list'], ['json', { outputFile: path.join(evidenceRoot, `${runId}.json`) }]],
  globalSetup: './e2e/fixtures/worlds-v2-browser-setup.ts',
  use: { ...base.use, trace: 'retain-on-failure' },
  webServer: [] });
