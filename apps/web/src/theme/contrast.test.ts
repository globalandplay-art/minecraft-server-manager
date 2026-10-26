// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
function luminance(hex: string) {
  const values = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return values[0]! * .2126 + values[1]! * .7152 + values[2]! * .0722;
}
it('uses AA contrast for small text, controls, status and raw logs in both palettes', () => {
  const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
  let tokens: Record<string, string> = {};
  for (const block of css.split('}').filter(value => value.includes('{'))) {
    tokens = { ...tokens, ...Object.fromEntries([...block.matchAll(/--color-([\w-]+):\s*#([\da-f]{6});/gi)].map(match => [match[1]!, match[2]!])) };
    for (const [foreground, background] of [['text', 'bg'], ['text', 'surface'], ['muted', 'surface'], ['muted', 'sidebar'], ['accent', 'surface'], ['on-accent', 'accent'], ['text', 'console'], ['success', 'success-subtle'], ['danger', 'danger-subtle'], ['warning', 'warning-subtle']]) {
      const a = luminance(tokens[foreground!]!), b = luminance(tokens[background!]!);
      expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05), `${foreground}/${background}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
