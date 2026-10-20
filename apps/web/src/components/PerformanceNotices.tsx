import type { Metrics, ServerStatus } from '@mcsm/contracts';
import { formatLocalTime } from '../format';

/** Observations only: no inferred crash cause, thresholds or automatic actions. */
export function PerformanceNotices({ status, metrics, readFailed }: {
  status?: ServerStatus | undefined; metrics?: Metrics | undefined; readFailed: boolean;
}) {
  const missing = metrics ? Object.entries(metrics).filter(([, metric]) => metric.status === 'unavailable').map(([key]) => key.toUpperCase()) : [];
  const stale = metrics ? Object.entries(metrics).filter(([, metric]) => metric.status === 'stale').map(([key]) => key.toUpperCase()) : [];
  return <section className="settings-panel" aria-label="监测提示">
    <h2>监测提示</h2>
    {status ? <>
      <p>状态依据：实例列表快照 · {formatLocalTime(status.observedAt)}。不代表当前进程的实时确认。</p>
      {status.recoveryRequired ? <p role="alert">该快照记录需要恢复检查；请查看实例操作与恢复状态。监测不会自动恢复或重启。</p> : null}
      {status.state === 'crashed' ? <p role="alert">该快照记录异常退出。请查看 Crash Analysis；不能仅凭此状态确定崩溃原因。</p> : null}
      {status.state === 'unknown' ? <p>该快照的运行状态未知，不能认定服务器正常运行。</p> : null}
    </> : <p>没有可信实例状态快照，不能确认进程健康。</p>}
    {readFailed ? <p>本次指标读取失败；保留的快照不能用于确认当前健康状态。</p> : null}
    {stale.length ? <p>旧指标：{stale.join('、')}。仅保留历史值，不据此发出当前性能阈值告警。</p> : null}
    {missing.length ? <p>不可用指标：{missing.join('、')}。N/A 不等于零或健康。</p> : null}
    {metrics?.tps.status === 'unavailable' || metrics?.mspt.status === 'unavailable' ?
      <p>TPS/MSPT 暂无可信采集结果；不会根据 CPU、玩家数或日志猜测。</p> : null}
    {!metrics ? <p>尚无指标样本，不能判断性能是否正常。</p> : null}
    <p>当前仅展示已报告的状态与数据质量提示；未启用自动处置、阈值通知或持久告警历史。</p>
  </section>;
}
