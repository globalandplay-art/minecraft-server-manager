import { expect, it } from 'vitest';
import { i18n } from './index';
import { consoleNotice } from './console-notice';
import { readableReadinessReason } from '../readiness';

it('updates known LT connection advice while preserving unknown raw diagnostics', async () => {
  await i18n.changeLanguage('en');
  expect(consoleNotice('Console WebSocket 已断开。')).toBe('Console WebSocket disconnected.');
  const raw = '原始服务端错误 <stack> / Mod-ID:Example';
  expect(consoleNotice(raw)).toBe(raw);
  await i18n.changeLanguage('ja');
  expect(consoleNotice('Console WebSocket 已断开。')).toBe('コンソールの WebSocket が切断されました。');
  expect(consoleNotice(raw)).toBe(raw);
});
it('localizes known readiness reasons and preserves unknown reason identifiers', async () => {
  await i18n.changeLanguage('en');
  expect(readableReadinessReason('already-running')).toBe('The server is already running');
  expect(readableReadinessReason('NEW_RAW_CODE')).toBe('Backend reason: NEW_RAW_CODE');
  await i18n.changeLanguage('ja');
  expect(readableReadinessReason(null)).toBe('バックエンドから理由が返されていません');
  expect(readableReadinessReason('NEW_RAW_CODE')).toContain('NEW_RAW_CODE');
});
it('uses English log-line plurals without changing the numeric count', async () => {
  await i18n.changeLanguage('en');
  expect(i18n.t('console.newLogs', { count: 1 })).toBe('1 new log line · Go to bottom');
  expect(i18n.t('console.newLogs', { count: 2 })).toBe('2 new log lines · Go to bottom');
});
