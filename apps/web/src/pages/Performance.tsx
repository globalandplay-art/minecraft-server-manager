import { useTranslation } from 'react-i18next';
import { i18n, number } from '../i18n';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Metrics, ServersResponse } from '@mcsm/contracts';
import { api, errorMessage } from '../api';
import { EmptyState, ErrorState, MockBanner, PageHeading } from '../components/Ui';
import { formatBytes } from '../format';
import { formatLocalTime, statusLabels } from '../format';
import { PerformanceTrend } from '../components/PerformanceTrend';
import { PerformanceNotices } from '../components/PerformanceNotices';
import { performanceTrend, type TrendMetric } from '../performanceTrends';

function reading(metric: Metrics[keyof Metrics]): string {
  if (metric.status === 'unavailable') return `N/A · ${metric.reason}`;
  const value = typeof metric.value === 'number' ? number(metric.value, { maximumFractionDigits: 20 }) :
    'rssBytes' in metric.value ? formatBytes(metric.value.rssBytes) :
    'online' in metric.value ? `${number(metric.value.online)}/${number(metric.value.max)}` :
      i18n.t('performance.diskReading', { used: formatBytes(metric.value.usedBytes), total: formatBytes(metric.value.totalBytes), free: formatBytes(metric.value.freeBytes) });
  return `${value}${metric.status === 'stale' ? ` · ${i18n.t('performance.staleReading', { reason: metric.reason })}` : ''}`;
}
function compactReading(metric: Metrics[keyof Metrics]): string {
  if (metric.status === 'unavailable') return 'N/A';
  if (typeof metric.value === 'number') return number(metric.value, { maximumFractionDigits: 2 });
  if ('rssBytes' in metric.value) return formatBytes(metric.value.rssBytes);
  if ('online' in metric.value) return `${number(metric.value.online)}/${number(metric.value.max)}`;
  return formatBytes(metric.value.freeBytes);
}

export function PerformancePage({ server }: { server?: ServersResponse['data']['items'][number] | undefined }) {
  useTranslation();
  const id = server?.server.id;
  const [automatic, setAutomatic] = useState(true), [visible, setVisible] = useState(() => !document.hidden);
  const [range, setRange] = useState('all');
  const [selectedMetric, setSelectedMetric] = useState<TrendMetric>('cpu');
  const [historyLimit, setHistoryLimit] = useState(12);
  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  const query = useQuery({ queryKey: ['performance', id], queryFn: ({ signal }) => api.performance(id!, signal),
    enabled: Boolean(id) && visible, retry: false, refetchInterval: automatic && visible ? 5000 : false,
    refetchOnWindowFocus: false, refetchOnReconnect: false, refetchIntervalInBackground: false });
  const samples = (query.data?.data.samples ?? []).slice(-120);
  const latest = samples.at(-1);
  const metricKeys = ['cpu', 'ram', 'tps', 'mspt', 'players', 'disk'] as const;
  const windowMs = range === 'minute' ? 60_000 : range === 'five' ? 300_000 : null;
  const trend = performanceTrend(samples, selectedMetric, windowMs);
  const history = [...samples].reverse().filter(sample => windowMs === null || Date.parse(sample.collectedAt) >= trend.end - windowMs);
  const refreshState = !visible ? i18n.t('performance.hidden') : automatic ? i18n.t('performance.automatic') : i18n.t('performance.paused');
  const mode = query.data?.meta.mode;
  const selectedReading = latest?.metrics[selectedMetric];
  const metricState = (metric: Metrics[keyof Metrics] | undefined) => !metric ? i18n.t('monitor.pending') : metric.status === 'unavailable' ? i18n.t('monitor.unavailable') : query.isError || metric.status === 'stale' ? i18n.t('monitor.stale') : i18n.t('monitor.available');
  return <div className="page-stack performance-workspace">
    <PageHeading eyebrow={i18n.t('monitor.eyebrow')} title={i18n.t('nav.performance')} description={server?.server.name ?? i18n.t('performance.choose')} />
    {query.data?.meta.mode === 'mock' ? <MockBanner /> : null}
    {!server ? <EmptyState title={i18n.t('players.choose')} description={i18n.t('performance.choose')} /> : null}
    {id ? <div className="performance-controls">
      <span className="topbar-chip">{mode ? i18n.t(mode === 'mock' ? 'monitor.mock' : 'monitor.local') : i18n.t('common.unknown')}</span>
      <label>{i18n.t('performance.range')}<select value={range} onChange={event => setRange(event.target.value)}>
        <option value="all">{i18n.t('performance.all')}</option><option value="minute">{i18n.t('performance.minute')}</option><option value="five">{i18n.t('performance.fiveMinutes')}</option>
      </select></label>
      <button className="button button--secondary" onClick={() => setAutomatic(value => !value)}>{automatic ? i18n.t('performance.pause') : i18n.t('performance.resume')}</button>
      <button className="button button--secondary" disabled={query.isFetching || !visible} onClick={() => void query.refetch()}>{i18n.t('performance.refresh')}</button>
      <p role="status">{refreshState}</p>
    </div> : null}
    {server?.status ? <p>{i18n.t('performance.state', { state: statusLabels[server.status.state] ?? server.status.state })} · {formatLocalTime(server.status.observedAt)}
      {server.status.recoveryRequired ? ` · ${i18n.t('performance.recovery')}` : ''}</p> : null}
    {id && query.isPending ? <p role="status">{i18n.t('performance.sampling')}</p> : null}
    {query.isError ? <ErrorState description={errorMessage(query.error)} retry={() => void query.refetch()} /> : null}
    {id && query.isSuccess && !latest ? <EmptyState title={i18n.t('performance.noSamples')} description={i18n.t('performance.noInference')} /> : null}
    {query.isError && latest ? <p className="stale-banner" role="alert">{i18n.t('performance.oldSnapshot')}</p> : null}
    {id ? <>
      <section className="performance-metric-strip" aria-label={i18n.t('performance.samples')}>
        {metricKeys.map(key => {
          const metric = latest?.metrics[key];
          const value = metric ? compactReading(metric) : 'N/A';
          const state = query.isError && metric?.status === 'available' ? 'stale' : metric?.status ?? 'unavailable';
          return <article key={key} className={`performance-reading performance-reading--${state}`}>
            <h2>{i18n.t(`monitor.metric.${key}`)}</h2>
            <div className="performance-reading__value" title={metric ? reading(metric) : undefined}>{value}{metric?.status !== 'unavailable' && metric ? <small>{key === 'cpu' ? '%' : key === 'mspt' ? 'ms' : key === 'tps' ? 'TPS' : ''}</small> : null}</div>
            <span>{metricState(metric)}</span>
          </article>;
        })}
      </section>
      <div className="performance-main-grid">
        <section className="panel performance-main-trend" aria-label={i18n.t('performance.trends')}>
          <div className="performance-trend-toolbar"><h2>{i18n.t('monitor.trend')}</h2>
            <label>{i18n.t('monitor.trendMetric')}<select value={selectedMetric} onChange={event => setSelectedMetric(event.target.value as TrendMetric)}>
              {metricKeys.map(key => <option key={key} value={key}>{i18n.t(`monitor.metric.${key}`)}</option>)}
            </select></label></div>
          <PerformanceTrend samples={samples} metric={selectedMetric} windowMs={windowMs} />
        </section>
        <aside className="panel performance-sampling" aria-label={i18n.t('monitor.sampling')}>
          <h2>{i18n.t('monitor.sampling')}</h2><dl>
            <div><dt>{i18n.t('monitor.instance')}</dt><dd>{server?.server.name ?? id}</dd></div>
            <div><dt>{i18n.t('monitor.mode')}</dt><dd>{mode ? i18n.t(mode === 'mock' ? 'monitor.mock' : 'monitor.local') : i18n.t('common.unknown')}</dd></div>
            <div><dt>{i18n.t('monitor.collected')}</dt><dd>{number(samples.length)} / 120</dd></div>
            <div><dt>{i18n.t('monitor.valid')}</dt><dd>{number(trend.count)} · {i18n.t(`monitor.metric.${selectedMetric}`)}</dd></div>
            <div><dt>{i18n.t('monitor.lastSample')}</dt><dd><time dateTime={latest?.collectedAt}>{latest ? formatLocalTime(latest.collectedAt) : 'N/A'}</time></dd></div>
            <div><dt>{i18n.t('monitor.interval')}</dt><dd>{query.data ? i18n.t('monitor.seconds', { count: query.data.data.minimumIntervalMs / 1000 }) : 'N/A'}</dd></div>
            <div><dt>{i18n.t('monitor.refreshState')}</dt><dd>{refreshState}</dd></div>
            <div><dt>{i18n.t('monitor.state')}</dt><dd>{metricState(latest?.metrics[selectedMetric])}</dd></div>
            <div><dt>{i18n.t('monitor.source')}</dt><dd>{latest?.metrics[selectedMetric].source ?? 'N/A'}</dd></div>
            {selectedReading && 'reason' in selectedReading ? <div><dt>{i18n.t('monitor.reason')}</dt><dd>{selectedReading.reason}</dd></div> : null}
          </dl>
        </aside>
      </div>
      <section className="panel performance-history" aria-label={i18n.t('monitor.history')}>
        <h2>{i18n.t('monitor.history')}</h2><div className="performance-history-scroll" tabIndex={0} role="region" aria-label={i18n.t('monitor.history')}>
          <table><thead><tr>{(['timestamp', 'metric', 'reading', 'state', 'source'] as const).map(key => <th key={key}>{i18n.t(`monitor.${key}`)}</th>)}</tr></thead>
            <tbody>{history.slice(0, historyLimit).map(sample => <tr key={sample.collectedAt}>
              <td><time dateTime={sample.collectedAt}>{formatLocalTime(sample.collectedAt)}</time></td><td>{i18n.t(`monitor.metric.${selectedMetric}`)}</td>
              <td>{reading(sample.metrics[selectedMetric])}</td><td>{metricState(sample.metrics[selectedMetric])}</td><td>{sample.metrics[selectedMetric].source ?? 'N/A'}</td>
            </tr>)}</tbody></table></div>
        {history.length > historyLimit ? <button className="button button--secondary" onClick={() => setHistoryLimit(limit => Math.min(120, limit + 12))}>{i18n.t('monitor.more', { shown: historyLimit, total: history.length })}</button> : null}
      </section>
      <details className="panel performance-technical"><summary>{i18n.t('monitor.technical')}</summary>
        <p>{i18n.t('performance.definitions')}</p><p>{i18n.t('performance.gaps')}</p><p>{i18n.t('monitor.boundary')}</p>
        {latest ? <p>{i18n.t('monitor.metric.disk')}：{reading(latest.metrics.disk)}</p> : null}
        <PerformanceNotices status={server?.status} metrics={latest?.metrics} readFailed={query.isError} />
      </details>
    </> : null}
  </div>;
}
