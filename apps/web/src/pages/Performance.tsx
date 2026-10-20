import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Metrics, ServersResponse } from '@mcsm/contracts';
import { api, errorMessage } from '../api';
import { EmptyState, ErrorState, MockBanner, PageHeading } from '../components/Ui';
import { formatBytes } from '../format';
import { formatLocalTime, statusLabels } from '../format';
import { PerformanceTrend } from '../components/PerformanceTrend';
import { PerformanceNotices } from '../components/PerformanceNotices';

function reading(metric: Metrics[keyof Metrics]): string {
  if (metric.status === 'unavailable') return `N/A · ${metric.reason}`;
  const value = typeof metric.value === 'number' ? String(metric.value) :
    'rssBytes' in metric.value ? formatBytes(metric.value.rssBytes) :
    'online' in metric.value ? `${metric.value.online}/${metric.value.max}` :
      `已用 ${formatBytes(metric.value.usedBytes)} / 总量 ${formatBytes(metric.value.totalBytes)} / 可用 ${formatBytes(metric.value.freeBytes)}`;
  return `${value}${metric.status === 'stale' ? ` · 旧数据 (${metric.reason})` : ''}`;
}

export function PerformancePage({ server }: { server?: ServersResponse['data']['items'][number] | undefined }) {
  const id = server?.server.id;
  const [automatic, setAutomatic] = useState(true), [visible, setVisible] = useState(() => !document.hidden);
  const [range, setRange] = useState('all');
  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  const query = useQuery({ queryKey: ['performance', id], queryFn: ({ signal }) => api.performance(id!, signal),
    enabled: Boolean(id) && visible, retry: false, refetchInterval: automatic && visible ? 5000 : false,
    refetchOnWindowFocus: false, refetchOnReconnect: false, refetchIntervalInBackground: false });
  const samples = query.data?.data.samples ?? [];
  const latest = samples.at(-1);
  return <div className="page-stack">
    <PageHeading eyebrow="SESSION METRICS" title="Performance" description="会话内最多120个点；重启清空。没有请求期间不采样，不补点。" />
    {query.data?.meta.mode === 'mock' ? <MockBanner /> : null}
    {!server ? <EmptyState title="请选择服务器" description="从 Servers 选择实例。" /> : null}
    {id ? <div className="performance-controls">
      <button className="button button--secondary" onClick={() => setAutomatic(value => !value)}>{automatic ? '暂停自动刷新' : '恢复自动刷新'}</button>
      <label>历史范围<select value={range} onChange={event => setRange(event.target.value)}>
        <option value="all">本会话全部（最多120点）</option><option value="minute">最近1分钟</option><option value="five">最近5分钟</option>
      </select></label>
      <p role="status">{!visible ? '页面不可见，自动采样已暂停。' : automatic ? '自动刷新：每5秒，后台页面不采样。' : '自动刷新已暂停；可手动刷新采样。'}</p>
    </div> : null}
    {server?.status ? <p>实例状态（列表快照）：{statusLabels[server.status.state] ?? server.status.state} · {formatLocalTime(server.status.observedAt)}
      {server.status.recoveryRequired ? ' · 需要恢复检查' : ''}</p> : null}
    {id && query.isPending ? <p role="status">正在采样…</p> : null}
    {query.isError ? <ErrorState description={errorMessage(query.error)} retry={() => void query.refetch()} /> : null}
    {id ? <PerformanceNotices status={server?.status} metrics={latest?.metrics} readFailed={query.isError} /> : null}
    {id && query.isSuccess && !latest ? <EmptyState title="暂无采样记录" description="不能据此推断服务器性能。" /> : null}
    {latest ? <section className="settings-panel" aria-label="性能采样">
      {query.isError ? <p role="alert">以下为上次成功读取的旧快照，当前指标尚未确认。</p> : null}
      <p>最后收集：{new Date(latest.collectedAt).toLocaleString()} · {samples.length} / 120 个点</p>
      <p>历史快照，不代表持续实时监测。CPU：Minecraft进程占全部逻辑CPU容量的百分比；RAM：进程驻留内存，不是JVM堆。磁盘：所在卷；Uptime：秒；TPS：t/s；MSPT：ms。</p>
      <dl>{(Object.keys(latest.metrics) as (keyof Metrics)[]).map((key) => {
        const metric = latest.metrics[key];
        return <div key={key}><dt>{key.toUpperCase()}</dt><dd>{reading(metric)}</dd>
          <dd>{metric.status === 'unavailable' ? '无可信来源' : `${metric.source} · ${new Date(metric.sampledAt).toLocaleString()}`}</dd></div>;
      })}</dl>
      <details><summary>查看采样历史</summary><ul>{[...samples].reverse().map((sample) => <li key={sample.collectedAt}>
        {new Date(sample.collectedAt).toLocaleTimeString()} · CPU {reading(sample.metrics.cpu)} · RAM {reading(sample.metrics.ram)} · TPS {reading(sample.metrics.tps)}
      </li>)}</ul></details>
    </section> : null}
    {latest ? <section aria-label="指标历史趋势">
      <p>趋势按指标实际采样时间绘制。旧数据和缺失数据断线，不补点、不补零；连线不代表中间存在测量。</p>
      <div className="performance-trends">{(['cpu', 'ram', 'disk', 'players'] as const).map(metric =>
        <PerformanceTrend key={metric} samples={samples} metric={metric} windowMs={range === 'minute' ? 60_000 : range === 'five' ? 300_000 : null} />)}</div>
    </section> : null}
    {id ? <button className="button button--secondary" disabled={query.isFetching || !visible} onClick={() => void query.refetch()}>刷新采样</button> : null}
  </div>;
}
