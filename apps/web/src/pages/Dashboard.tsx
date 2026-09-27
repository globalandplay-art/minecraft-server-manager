import type { OverviewResponse } from '@mcsm/contracts';
import { AlertTriangle, Clock3, Cpu, HardDrive, MemoryStick, RefreshCw, Server } from 'lucide-react';
import { formatBytes, formatLocalTime, formatSource, formatUptime, localTimezoneLabel, statusDescription, statusLabels } from '../format';
import { MetricCard, MockBanner, PageHeading, StatusBadge } from '../components/Ui';

type Overview = OverviewResponse['data'];
type Metric = Overview['metrics'][keyof Overview['metrics']];

const reasonLabels: Record<string, string> = {
  'not-collected': '未采集',
  'server-stopped': 'Minecraft 未运行',
  'not-supported': '当前服务端未提供',
  'probe-unavailable': '状态探测暂不可用',
  'mock-unavailable': 'Mock 场景未提供',
};

function reasonLabel(reason: string) {
  return reasonLabels[reason] ?? reason;
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
  return metric.status === 'unavailable' ? 'N/A' : `${metric.value.toFixed(metric.value % 1 ? 1 : 0)}${suffix}`;
}

function MetricGrid({ overview, forceStale }: { overview: Overview; forceStale: boolean }) {
  const { summary, metrics } = overview;
  const effectiveState = forceStale ? 'unknown' : summary.status.state;
  const previousStatus = forceStale ? `上次：${statusLabels[summary.status.state]}` : undefined;
  const players = metrics.players.status === 'unavailable'
    ? 'N/A'
    : `${metrics.players.value.online} / ${metrics.players.value.max}`;
  const ram = metrics.ram.status === 'unavailable' ? 'N/A' : formatBytes(metrics.ram.value.rssBytes);
  const disk = metrics.disk.status === 'unavailable'
    ? 'N/A'
    : formatBytes(metrics.disk.value.usedBytes);
  const diskDetail = metrics.disk.status === 'unavailable'
    ? undefined
    : `总容量 ${formatBytes(metrics.disk.value.totalBytes)}`;
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
      <MetricCard label="DISK" value={disk} unit={metrics.disk.status === 'unavailable' ? undefined : '已用'} detail={diskDetail} {...metricMeta(metrics.disk, forceStale)} />
      <MetricCard label="UPTIME" value={uptime} {...metricMeta(metrics.uptime, forceStale)} />
    </div>
  );
}

function ServerOverview({ overview }: { overview: Overview }) {
  const { server, capabilities, readiness } = overview.summary;
  const support = [
    capabilities.mods ? 'Mods' : null,
    capabilities.plugins ? 'Plugins' : null,
  ].filter(Boolean).join('、') || '原生服务端（无 Mods / Plugins）';
  return (
    <section className="panel overview-panel">
      <div className="panel__heading"><div><span className="eyebrow">INSTANCE</span><h2>服务器概览</h2></div><Server size={20} /></div>
      <dl className="detail-list">
        <div><dt>服务端类型</dt><dd>{server.type.toUpperCase()}</dd></div>
        <div><dt>Minecraft</dt><dd>{server.minecraftVersion ?? 'N/A'}</dd></div>
        <div><dt>Java Runtime</dt><dd>{server.java.runtimeVersion ?? 'N/A'}</dd></div>
        <div><dt>扩展能力</dt><dd>{support}</dd></div>
        <div><dt>命令通道</dt><dd>{readiness.commandTransport === 'unavailable' ? '不可用' : readiness.commandTransport.toUpperCase()}</dd></div>
        <div><dt>检测置信度</dt><dd>{server.detection.confidence}</dd></div>
      </dl>
      <p className="data-footnote">数据来自 {formatSource(overview.summary.status.source)}；不会展示服务端本地目录。</p>
      {server.detection.warnings.length ? (
        <div className="inline-warning"><AlertTriangle size={16} />{server.detection.warnings.join('；')}</div>
      ) : null}
    </section>
  );
}

function ActivityList({ activity }: { activity: Overview['activity'] }) {
  return (
    <section className="panel activity-panel">
      <div className="panel__heading"><div><span className="eyebrow">MOCK FIXTURE</span><h2>最近活动</h2></div><Clock3 size={20} /></div>
      {activity.length === 0 ? (
        <div className="compact-empty">当前数据源暂无活动记录。</div>
      ) : (
        <ol className="activity-list">
          {activity.slice(0, 5).map((item) => (
            <li key={item.id}>
              <span className={`activity-marker activity-marker--${item.kind}`} aria-hidden="true" />
              <div><p>{item.message}</p><time dateTime={item.occurredAt}>{formatLocalTime(item.occurredAt)} · Mock 示例</time></div>
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
}: {
  overview: Overview;
  generatedAt: string;
  mode: 'mock' | 'local';
  forceStale: boolean;
  refreshing: boolean;
  refresh: () => void;
}) {
  const { summary } = overview;
  const heroState = forceStale ? 'unknown' : summary.status.state;
  return (
    <div className="page-stack">
      {mode === 'mock' ? <MockBanner /> : null}
      <PageHeading
        eyebrow="OVERVIEW"
        title="Dashboard"
        description={`快照时间按 ${localTimezoneLabel()} 显示；每个指标保留自身采样来源。`}
        aside={
          <button className="button button--secondary" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? 'spin' : ''} />{refreshing ? '刷新中' : '刷新数据'}
          </button>
        }
      />
      <section className="server-hero">
        <div className="server-hero__identity">
          <span className="server-icon"><Server size={24} /></span>
          <div>
            <div className="server-hero__title"><h2>{summary.server.name}</h2><StatusBadge status={heroState} mock={mode === 'mock'} /></div>
            <p>{summary.server.type.toUpperCase()} {summary.server.minecraftVersion ?? '版本未知'} <span>·</span> Java {summary.server.java.requiredMajor ?? 'N/A'}</p>
            {forceStale ? <p className="status-explanation">上次状态：{statusLabels[summary.status.state]} · 当前快照已过期</p> : statusDescription(summary.status.state) ? <p className="status-explanation">{statusDescription(summary.status.state)}</p> : null}
          </div>
        </div>
        <div className="server-actions" aria-label="生命周期操作暂不可用">
          <div>
            <button className="button button--disabled" disabled>启动</button>
            <button className="button button--disabled" disabled>停止</button>
            <button className="button button--disabled" disabled>重启</button>
          </div>
          <p>Phase 2 接入本地服务器后启用</p>
        </div>
      </section>
      {forceStale ? (
        <div className="stale-banner" role="status"><AlertTriangle size={17} />超过 15 秒未获得成功快照，以下数据仅供回看，不能作为实时状态判断。</div>
      ) : null}
      <MetricGrid overview={overview} forceStale={forceStale} />
      <div className="metric-notes" aria-label="指标口径说明">
        <span><Cpu size={15} />CPU：MC 进程，按整机逻辑核心容量归一化</span>
        <span><MemoryStick size={15} />RAM：MC 进程 RSS</span>
        <span><HardDrive size={15} />Disk：服务端目录所在卷</span>
      </div>
      <div className="dashboard-lower">
        <ServerOverview overview={overview} />
        <ActivityList activity={overview.activity} />
      </div>
      {overview.alerts.length ? (
        <section className="alerts-panel" aria-label="服务器告警">
          {overview.alerts.map((alert) => <p key={alert.code}><AlertTriangle size={16} />{alert.message}</p>)}
        </section>
      ) : null}
      <div className="snapshot-footer">API 快照生成于 <time dateTime={generatedAt}>{formatLocalTime(generatedAt)}</time>（{localTimezoneLabel()}）</div>
    </div>
  );
}
