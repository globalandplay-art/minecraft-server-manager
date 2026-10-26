import { i18n } from './index';
import type { MessageKey } from './resources';

// Keep message identity/variables in state so notices also switch at runtime.
// Plain strings are deliberately raw (e.g. original backend diagnostic text).
export type UiMessage = string | { key: MessageKey; values?: Record<string, string | number> };
export function renderMessage(message: UiMessage): string {
  return typeof message === 'string' ? message : i18n.t(message.key, message.values ?? {});
}
