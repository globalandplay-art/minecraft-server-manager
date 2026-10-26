import { i18n } from './index';
import { errorMessages } from './errors';
const known = new Map<string, string>(Object.entries(errorMessages)
  .filter(([key]) => key !== 'error.http' && key !== 'error.unexpectedStatus')
  .map(([key, values]) => [values[0], key]));
/** Localize only fixed client-authored advice. Never mutate Error/message/stack,
 * backend error codes, request IDs or unknown server diagnostics. */
export function localizeClientError(message: string): string {
  const key = known.get(message);
  if (key) return i18n.t(key);
  const failed = /^请求失败（HTTP (\d{3})）。$/u.exec(message);
  if (failed) return i18n.t('error.http', { status: failed[1] });
  const unexpected = /^后端返回了意外的状态码（HTTP (\d{3})）。$/u.exec(message);
  return unexpected ? i18n.t('error.unexpectedStatus', { status: unexpected[1] }) : message;
}
