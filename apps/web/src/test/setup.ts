import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';
import { i18n } from '../i18n';

beforeEach(async () => { await i18n.changeLanguage('zh-CN'); });

if (typeof document !== 'undefined') Object.defineProperty(document, 'hidden', {
  configurable: true,
  value: false,
});
