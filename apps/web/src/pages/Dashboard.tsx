import { useTranslation } from 'react-i18next';
import { i18n, number } from '../i18n';
import type { HealthResponse, OverviewResponse } from '@mcsm/contracts';
import { AlertTriangle, Clock3, Cpu, HardDrive, MemoryStick, RefreshCw, Server } from 'lucide-react';
import { formatBytes, formatLocalTime, formatSource, formatUptime, localTimezoneLabel, statusDescription, statusLabels } from '../format';
import { MetricCard, MockBanner, PageHeading, StatusBadge } from '../components/Ui';
import { LifecycleControls } from '../components/LifecycleControls';

type Overview = OverviewResponse['data'];
type Metric = Overview['metrics'][keyof Overview['metrics']];

const reasonLabels: Record<string, string> = {
  'not-collected': 'common.notCollected',
  'server-stopped': 'dashboard.reason.stopped',
  'not-supported': 'dashboard.reason.unsupported',
  'probe-unavailable': 'dashboard.reason.probe',
  'mock-unavailable': 'dashboard.reason.mock',
};

function reasonLabel(reason: string) {
  return reasonLabels[reason] ? i18n.t(reasonLabels[reason]!) : reason;
}

function metricMeta(metric: Metric, forceStale: boolean) {
  if (metric.status === 'unavailable') {
    return {
      source: null,
      sampledAt: null,
      unavailableReason: reasonLabel(metric.reason),
      staleReason: undefined,
      forceStale,
    };
  }
  return {
    source: metric.source,
    sampledAt: metric.sampledAt,
    staleReason: metric.status === 'stale' ? reasonLabel(metric.reason) : undefined,
    forceStale,
  };
}

function metricNumber(metric: Overview['metrics']['cpu'], suffix = '') {
  return metric.status === 'unavailable' ? 'N/A' : `${number(metric.value, { maximumFractionDigits: metric.value % 1 ? 1 : 0 })}${suffix}`;
}

function MetricGrid({ overview, forceStale }: { overview: Overview; forceStale: boolean }) {
  const { summary, metrics } = overview;
  const effectiveState = forceStale ? 'unknown' : summary.status.state;
  const previousStatus = forceStale ? i18n.t('dashboard.previous', { state: statusLabels[summary.status.state] }) : undefined;
  const players = metrics.players.status === 'unavailable'
    ? 'N/A'
    : `${metrics.players.value.online} / ${metrics.players.value.max}`;
  const ram = metrics.ram.status === 'unavailable' ? 'N/A' : formatBytes(metrics.ram.value.rssBytes);
  const disk = metrics.disk.status === 'unavailable'
    ? 'N/A'
    : formatBytes(metrics.disk.value.usedBytes);
  const diskDetail = metrics.disk.status === 'unavailable'
    ? undefined
    : i18n.t('dashboard.totalDisk', { bytes: formatBytes(metrics.disk.value.totalBytes) });
  const uptime = metrics.uptime.status === 'unavailable' ? 'N/A' : formatUptime(metrics.uptime.value);
  const statusTone = effectiveState === 'running' ? 'success' : effectiveState === 'crashed' ? 'danger' : 'warning';

  return (
    <div className="metrics-grid">
      <MetricCard
        label="SERVER STATUS"
        value={statusLabels[effectiveState] ?? effectiveState}
        source={summary.status.source}
        sampledAt={summary.status.observedAt}
        staleReason={previousStatus}
        tone={statusTone}
      />
      <MetricCard label="PLAYERS" value={players} {...metricMeta(metrics.players, forceStale)} />
      <MetricCard label="TPS" value={metricNumber(metrics.tps)} unit={metrics.tps.status === 'unavailable' ? undefined : 't/s'} {...metricMeta(metrics.tps, forceStale)} />
      <MetricCard label="MSPT" value={metricNumber(metrics.mspt)} unit={metrics.mspt.status === 'unavailable' ? undefined : 'ms'} {...metricMeta(metrics.mspt, forceStale)} />
      <MetricCard label="CPU" value={metricNumber(metrics.cpu, '%')} {...metricMeta(metrics.cpu, forceStale)} />
      <MetricCard label="RAM" value={ram} {...metricMeta(metrics.ram, forceStale)} />
      <MetricCard label="DISK" value={disk} unit={metrics.disk.status === 'unavailable' ? undefined : i18n.t('dashboard.used')} detail={diskDetail} {...metricMeta(metrics.disk, forceStale)} />
      <MetricCard label="UPTIME" value={uptime} {...metricMeta(metrics.uptime, forceStale)} />
    </div>
  );
}

function ServerOverview({ overview }: { overview: Overview }) {
  const { server, capabilities, readiness } = overview.summary;
  const support = [
    capabilities.mods ? 'Mods' : null,
    capabilities.plugins ? 'Plugins' : null,
  ].filter(Boolean).join('、') || i18n.t('dashboard.native');
  return (
    <section className="panel overview-panel">
      <div className="panel__heading"><div><span className="eyebrow">{i18n.t('monitor.instance')}</span><h2>{i18n.t('dashboard.overview')}</h2></div><Server size={20} /></div>
      <dl className="detail-list">
        <div><dt>{i18n.t('dashboard.type')}</dt><dd>{server.type.toUpperCase()}</dd></div>
        <div><dt>Minecraft</dt><dd>{server.minecraftVersion ?? 'N/A'}</dd></div>
        <div><dt>Java Runtime</dt><dd>{server.java.runtimeVersion ?? 'N/A'}</dd></div>
        <div><dt>{i18n.t('dashboard.extensions')}</dt><dd>{support}</dd></div>
        <div><dt>{i18n.t('dashboard.transport')}</dt><dd>{readiness.commandTransport === 'unavailable' ? i18n.t('dashboard.unavailable') : readiness.commandTransport.toUpperCase()}</dd></div>
        <div><dt>{i18n.t('dashboard.confidence')}</dt><dd>{server.detection.confidence}</dd></div>
      </dl>
      <p className="data-footnote">{i18n.t('dashboard.source', { source: formatSource(overview.summary.status.source) })}</p>
      {server.detection.warnings.length ? (
        <div className="inline-warning"><AlertTriangle size={16} />{server.detection.warnings.join('；')}</div>
      ) : null}
    </section>
  );
}

function ActivityList({ activity, mode }: { activity: Overview['activity']; mode: 'mock' | 'local' }) {
  const sourceLabel = mode === 'mock' ? i18n.t('source.mock') : i18n.t('dashboard.localActivity');
  return (
    <section className="panel activity-panel">
      <div className="panel__heading"><div><span className="eyebrow">{i18n.t(mode === 'mock' ? 'monitor.mock' : 'monitor.localActivity')}</span><h2>{i18n.t('dashboard.activity')}</h2></div><Clock3 size={20} /></div>
      {activity.length === 0 ? (
        <div className="compact-empty">{i18n.t('dashboard.noActivity')}</div>
      ) : (
        <ol className="activity-list">
          {activity.slice(0, 5).map((item) => (
            <li key={item.id}>
              <span className={`activity-marker activity-marker--${item.kind}`} aria-hidden="true" />
              <div><p>{item.message}</p><time dateTime={item.occurredAt}>{formatLocalTime(item.occurredAt)} · {sourceLabel}</time></div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function Dashboard({
  overview,
  generatedAt,
  mode,
  forceStale,
  refreshing,
  refresh,
  lifecycleFeature,
}: {
  overview: Overview;
  generatedAt: string;
  mode: 'mock' | 'local';
  forceStale: boolean;
  refreshing: boolean;
  refresh: () => void;
  lifecycleFeature?: HealthResponse['data']['features']['lifecycle'] | undefined;
}) {
  useTranslation();
  const { summary } = overview;
  const heroState = forceStale ? 'unknown' : summary.status.state;
  return (
    <div className="page-stack">
      {mode === 'mock' ? <MockBanner /> : null}
      <PageHeading
        eyebrow={i18n.t('monitor.overview')}
        title={i18n.t('nav.dashboard')}
        description={i18n.t('dashboard.timezone', { timezone: localTimezoneLabel() })}
        aside={
          <button className="button button--secondary" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? 'spin' : ''} />{i18n.t(refreshing ? 'dashboard.refreshing' : 'dashboard.refresh')}
          </button>
        }
      />
      <section className="server-hero">
        <div className="server-hero__identity">
          <span className="server-icon"><Server size={24} /></span>
          <div>
            <div className="server-hero__title"><h2>{summary.server.name}</h2><StatusBadge status={heroState} mock={mode === 'mock'} /></div>
            <p>{summary.server.type.toUpperCase()} {summary.server.minecraftVersion ?? i18n.t('servers.unknownVersion')} <span>·</span> Java {summary.server.java.requiredMajor ?? 'N/A'}</p>
            {forceStale ? <p className="status-explanation">{i18n.t('dashboard.previousState', { state: statusLabels[summary.status.state] })}</p> : statusDescription(summary.status.state) ? <p className="status-explanation">{statusDescription(summary.status.state)}</p> : null}
          </div>
        </div>
        <LifecycleControls summary={summary} mode={mode} feature={lifecycleFeature} stale={forceStale} />
      </section>
      {forceStale ? (
        <div className="stale-banner" role="status"><AlertTriangle size={17} />{i18n.t('dashboard.stale')}</div>
      ) : null}
      <MetricGrid overview={overview} forceStale={forceStale} />
      <div className="metric-notes" aria-label={i18n.t('dashboard.metricNotes')}>
        <span><Cpu size={15} />{i18n.t('dashboard.cpuNote')}</span>
        <span><MemoryStick size={15} />{i18n.t('dashboard.ramNote')}</span>
        <span><HardDrive size={15} />{i18n.t('dashboard.diskNote')}</span>
      </div>
      <div className="dashboard-lower">
        <ServerOverview overview={overview} />
        <ActivityList activity={overview.activity} mode={mode} />
      </div>
      {overview.alerts.length ? (
        <section className="alerts-panel" aria-label={i18n.t('dashboard.alerts')}>
          {overview.alerts.map((alert) => <p key={alert.code}><AlertTriangle size={16} />{alert.message}</p>)}
        </section>
      ) : null}
      <div className="snapshot-footer">{i18n.t('dashboard.snapshot')} <time dateTime={generatedAt}>{formatLocalTime(generatedAt)}</time>（{localTimezoneLabel()}）</div>
    </div>
  );
}
