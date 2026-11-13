import { startWorldsBrowserFixture } from './worlds-v2-browser-setup.js';
export default async function setup() {
  return startWorldsBrowserFixture('tests/e2e/fixtures/worlds-v2-replacement-api.ts');
}
