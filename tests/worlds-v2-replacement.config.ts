import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import base from '../playwright.config.js';
const runId = `worlds-v2-replacement-browser-${randomUUID()}`;
export default defineConfig({ ...base, testDir: './e2e', testMatch: 'worlds-v2-replacement.spec.ts', retries: 0, maxFailures: 1,
  outputDir: path.resolve('test-results', `${runId}-artifacts`),
  reporter: [['list'], ['json', { outputFile: path.resolve('test-results', `${runId}.json`) }]],
  globalSetup: './e2e/fixtures/worlds-v2-replacement-browser-setup.ts', use: { ...base.use, trace: 'retain-on-failure' }, webServer: [] });
