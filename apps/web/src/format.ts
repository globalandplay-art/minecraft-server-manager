import { currentLanguage, i18n, number } from './i18n';

const sourceLabels: Record<string, string> = {
  mock: 'source.mock', process: 'source.process', filesystem: 'source.filesystem',
  'status-query': 'source.statusQuery', rcon: 'source.rcon', log: 'source.log',
  plugin: 'source.plugin', jmx: 'source.jmx',
};

export function formatSource(source: string | null) {
  return source ? (sourceLabels[source] ? i18n.t(sourceLabels[source]!) : source) : i18n.t('common.notCollected');
}

export function formatLocalTime(iso: string | null | undefined) {
  if (!iso) return i18n.t('common.unknown');
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return i18n.t('common.unknown');
  return new Intl.DateTimeFormat(currentLanguage(), {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value);
}

export function localTimezoneLabel() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || i18n.t('format.localTimezone');
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'N/A';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const decimals = value >= 10 || index === 0 ? 0 : 1;
  return `${number(value, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${units[index]}`;
}

export function formatUptime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'N/A';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return i18n.t('format.daysHours', { days: number(days), hours: number(hours) });
  if (hours > 0) return i18n.t('format.hoursMinutes', { hours: number(hours), minutes: number(minutes) });
  return i18n.t('format.minutes', { minutes: number(minutes) });
}

// Getters keep legacy callers reactive without freezing translated module values.
export const statusLabels: Record<string, string> = Object.defineProperties({},
  Object.fromEntries(['stopped', 'starting', 'running', 'stopping', 'crashed', 'unknown']
    .map(status => [status, { enumerable: true, get: () => i18n.t(`status.${status}`) }])));

export function statusDescription(status: string) {
  if (status === 'crashed') return i18n.t('status.crashedDescription');
  if (status === 'unknown') return i18n.t('status.unknownDescription');
  return null;
}
