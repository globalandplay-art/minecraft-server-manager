// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { normalizePreference } from './store';

describe('pre-paint bootstrap', () => {
  it('agrees with preference normalization without writing storage or executing application code', () => {
    const script = readFileSync(new URL('../../public/theme-init.js', import.meta.url), 'utf8');
    for (const value of [null, 'dark', 'light', 'system', 'unrecognized']) for (const dark of [true, false]) {
      const document = { documentElement: { dataset: {} as Record<string, string>, style: {} as Record<string, string> }, querySelector: () => null };
      runInNewContext(script, { document, localStorage: { getItem: () => value }, matchMedia: () => ({ matches: dark }) });
      const preference = normalizePreference(value);
      expect(document.documentElement.dataset.theme).toBe(preference === 'system' ? dark ? 'dark' : 'light' : preference);
      expect(document.documentElement.style.colorScheme).toBe(document.documentElement.dataset.theme);
    }
  });
  it('keeps palette literals out of component CSS and rejects decorative gradients', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    expect(css).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|gradient\(/i);
    expect(css).toContain('@import "./theme/tokens.css"');
  });
});
