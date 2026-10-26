// @vitest-environment node
import { expect, it } from 'vitest';
import { createInstance } from 'i18next';
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseLanguage, currentLanguage, initialLanguage, number } from './index';
import { resources } from './resources';

it('runs the shared locale core with an injected store and no browser globals', async () => {
  expect(typeof window).toBe('undefined');
  let selected: string | null = null;
  const preferences = { read: () => selected, write: (value: string) => { selected = value; } };
  expect(initialLanguage(preferences, ['ja-JP'])).toBe('ja');
  await chooseLanguage('ja', preferences);
  expect(selected).toBe('ja');
  expect(currentLanguage()).toBe('ja');
  expect(number(1234)).toBe(new Intl.NumberFormat('ja').format(1234));
});

it('falls back to the bundled English locale for missing translated keys', async () => {
  const instance = createInstance();
  await instance.init({ initAsync: false, lng: 'ja', fallbackLng: 'en', resources: {
    en: { translation: { notice: 'English fallback' } }, ja: { translation: {} },
  } });
  expect(instance.t('notice')).toBe('English fallback');
});

it('has no missing statically referenced translation keys in application source', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const missing: string[] = [];
  for (const file of fs.readdirSync(root, { recursive: true }).filter(file => /\.tsx?$/.test(String(file)) && !String(file).includes('.test.'))) {
    const source = ts.createSourceFile(String(file), fs.readFileSync(path.join(root, String(file)), 'utf8'), ts.ScriptTarget.Latest, true);
    function inspect(node: ts.Node) {
      if (ts.isCallExpression(node) && (ts.isIdentifier(node.expression) && node.expression.text === 't' ||
        ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === 'i18n' && node.expression.name.text === 't')) {
        const key = node.arguments[0];
        if (key && ts.isStringLiteral(key) && !Object.hasOwn(resources.en.translation, key.text)) missing.push(`${file}:${key.text}`);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }
  expect(missing).toEqual([]);
});
