const sourceLabels: Record<string, string> = {
  mock: 'Mock 示例',
  process: 'MC 进程',
  filesystem: '文件系统',
  'status-query': '状态查询',
  rcon: 'RCON',
  log: '日志',
  plugin: '插件',
  jmx: 'JMX',
};

export function formatSource(source: string | null) {
  return source ? (sourceLabels[source] ?? source) : '未采集';
}

export function formatLocalTime(iso: string | null | undefined) {
  if (!iso) return '未知';
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return '未知';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value);
}

export function localTimezoneLabel() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || '本地时区';
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
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function formatUptime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'N/A';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}天 ${hours}小时`;
  if (hours > 0) return `${hours}小时 ${minutes}分`;
  return `${minutes}分钟`;
}

export const statusLabels: Record<string, string> = {
  stopped: '已停止',
  starting: '启动中',
  running: '运行中',
  stopping: '停止中',
  crashed: '异常退出',
  unknown: '未知',
};

export function statusDescription(status: string) {
  if (status === 'crashed') return '服务端意外退出，请在后续 Crash Analysis 中查看证据。';
  if (status === 'unknown') return '当前无法可靠确认 Minecraft 进程状态。';
  return null;
}
