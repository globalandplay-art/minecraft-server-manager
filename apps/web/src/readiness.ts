const reasonLabels: Record<string, string> = {
  'mock-mode': 'Mock 模式只读，不会控制真实进程',
  'feature-not-implemented': '当前版本尚未实现此操作',
  'already-running': '服务器已经在运行',
  'already-stopped': '服务器已经停止',
  'operation-active': '此实例已有操作正在执行',
  'eula-not-accepted': '尚未接受 Minecraft EULA',
  'external-process': '外部 Java 进程不归管理器控制',
  'recovery-required': '需要先完成人工恢复检查',
  'unknown-status': '无法确认进程身份或状态',
  'server-state-unknown': '无法可靠确认服务器状态',
  'transport-unavailable': '当前没有可用的 RCON 或受管 stdin 通道',
  'capability-unsupported': '此服务端类型尚不支持该操作',
  'state-stopped': '服务器当前已停止',
  'state-starting': '服务器正在启动',
  'state-running': '服务器当前正在运行',
  'state-stopping': '服务器正在停止',
  'state-crashed': '服务器已异常退出，需要先检查状态',
  'state-unknown': '服务器状态未知',
};

export function readableReadinessReason(reason: string | null) {
  if (!reason) return '后端未提供原因';
  return reasonLabels[reason] ?? `后端原因：${reason}`;
}
