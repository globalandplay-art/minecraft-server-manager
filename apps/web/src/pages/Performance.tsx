import { useQuery } from '@tanstack/react-query';
import type { Metrics, ServersResponse } from '@mcsm/contracts';
import { api, errorMessage } from '../api';
import { EmptyState, ErrorState, MockBanner, PageHeading } from '../components/Ui';
import { formatBytes } from '../format';

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
  const query = useQuery({ queryKey: ['performance', id], queryFn: ({ signal }) => api.performance(id!, signal),
    enabled: Boolean(id), retry: false, refetchInterval: () => document.hidden ? false : 5000,
    refetchIntervalInBackground: false });
  const samples = query.data?.data.samples ?? [];
  const latest = samples.at(-1);
  return <div className="page-stack">
    <PageHeading eyebrow="SESSION METRICS" title="Performance" description="会话内最多120个点；重启清空。没有请求期间不采样，不补点。" />
    {query.data?.meta.mode === 'mock' ? <MockBanner /> : null}
    {!server ? <EmptyState title="请选择服务器" description="从 Servers 选择实例。" /> : null}
    {id && query.isPending ? <p role="status">正在采样…</p> : null}
    {query.isError ? <ErrorState description={errorMessage(query.error)} retry={() => void query.refetch()} /> : null}
    {id && query.isSuccess && !latest ? <EmptyState title="暂无采样记录" description="不能据此推断服务器性能。" /> : null}
    {latest ? <section className="settings-panel" aria-label="性能采样">
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
    {id ? <button className="button button--secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>刷新采样</button> : null}
  </div>;
}
