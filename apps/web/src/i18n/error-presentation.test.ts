import { expect, it } from 'vitest';
import { i18n } from './index';
import { ApiClientError, errorMessage } from '../api';
it('localizes client advice without changing raw exception details or backend codes', async () => {
  const error = new ApiClientError('请求超时，管理器 API 暂时没有响应。', 'network');
  const raw = error.message, stack = error.stack;
  await i18n.changeLanguage('en'); expect(errorMessage(error)).toBe('Request timed out. The Manager API is not responding.');
  expect(error.message).toBe(raw); expect(error.stack).toBe(stack); expect(error.kind).toBe('network');
  const backend = new ApiClientError('原始后端诊断 / RAW <cause>', 'http', 409, 'RAW_CODE', 'request-id');
  expect(errorMessage(backend)).toBe(backend.message); expect(backend.code).toBe('RAW_CODE');
  await i18n.changeLanguage('ja'); expect(errorMessage(error)).toBe('リクエストがタイムアウトしました。Manager API が応答していません。');
  expect(errorMessage(backend)).toBe(backend.message);
});
it('preserves HTTP status interpolation and localizes the generic unknown fallback', async () => {
  await i18n.changeLanguage('en');
  expect(errorMessage(new ApiClientError('请求失败（HTTP 503）。', 'http', 503))).toBe('Request failed (HTTP 503).');
  expect(errorMessage(new Error('private raw error'))).toBe('An unknown error occurred. Try again later.');
});
