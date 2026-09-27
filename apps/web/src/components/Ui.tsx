import { AlertTriangle, CircleOff, CloudOff, Database, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatLocalTime, formatSource, statusLabels } from '../format';

export function StatusBadge({ status, mock = false }: { status: string; mock?: boolean }) {
  const tone = ['running', 'ok'].includes(status)
    ? 'success'
    : ['crashed'].includes(status)
      ? 'danger'
      : ['starting', 'stopping', 'unknown'].includes(status)
        ? 'warning'
        : 'neutral';
  return (
    <span className={`status-badge status-badge--${tone}`}>
      <span className={`status-dot status-dot--${tone}`} aria-hidden="true" />
      {statusLabels[status] ?? status}
      {mock ? <span className="badge-divider">Mock</span> : null}
    </span>
  );
}

export function MockBanner() {
  return (
    <div className="mock-banner" role="status">
      <Database size={17} aria-hidden="true" />
      <strong>MOCK DATA</strong>
      <span>Phase 1 演示数据，未连接真实 Minecraft 服务器</span>
    </div>
  );
}

export function ConnectionBanner({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="connection-banner" role="alert">
      <CloudOff size={19} aria-hidden="true" />
      <div><strong>管理器 API 连接异常</strong><span>{message} 已保留最近一次有效数据。</span></div>
      <button className="button button--secondary" onClick={retry}>
        <RefreshCw size={16} aria-hidden="true" />重试
      </button>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon = <CircleOff size={24} />,
  action,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="state-card state-card--empty">
      <span className="state-card__icon" aria-hidden="true">{icon}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  );
}

export function ErrorState({
  title = '暂时无法载入数据',
  description,
  retry,
  secondary,
}: {
  title?: string;
  description: string;
  retry?: () => void;
  secondary?: ReactNode;
}) {
  return (
    <section className="state-card state-card--error" role="alert">
      <span className="state-card__icon" aria-hidden="true"><AlertTriangle size={24} /></span>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="state-actions">
        {retry ? <button className="button button--primary" onClick={retry}><RefreshCw size={16} />重试</button> : null}
        {secondary}
      </div>
    </section>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  aside,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {aside ? <div className="page-heading__aside">{aside}</div> : null}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  unit,
  source,
  sampledAt,
  unavailableReason,
  staleReason,
  forceStale = false,
  tone,
  detail,
}: {
  label: string;
  value: ReactNode;
  unit?: string | undefined;
  source?: string | null | undefined;
  sampledAt?: string | null | undefined;
  unavailableReason?: string | undefined;
  staleReason?: string | undefined;
  forceStale?: boolean | undefined;
  tone?: 'success' | 'warning' | 'danger' | undefined;
  detail?: ReactNode | undefined;
}) {
  const stale = Boolean(staleReason || forceStale);
  return (
    <article className={`metric-card ${stale ? 'metric-card--stale' : ''}`}>
      <div className="metric-card__header">
        <span>{label}</span>
        {stale ? <span className="stale-label">旧数据</span> : null}
      </div>
      <div className={`metric-card__value ${tone ? `metric-card__value--${tone}` : ''}`}>
        {value}{unit ? <small>{unit}</small> : null}
      </div>
      {detail ? <div className="metric-card__detail">{detail}</div> : null}
      <div className="metric-card__meta">
        <span>{unavailableReason ?? (source ? formatSource(source) : '状态探测')}</span>
        {sampledAt ? <time dateTime={sampledAt}>{formatLocalTime(sampledAt)}</time> : null}
      </div>
      {staleReason ? <p className="metric-card__reason">{staleReason}</p> : null}
    </article>
  );
}

export function SkeletonMetrics() {
  return (
    <div className="metrics-grid" aria-label="正在载入服务器指标" aria-busy="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="metric-card metric-card--skeleton" key={index}>
          <span className="skeleton skeleton--label" />
          <span className="skeleton skeleton--value" />
          <span className="skeleton skeleton--meta" />
        </div>
      ))}
      <span className="sr-only">正在载入服务器指标</span>
    </div>
  );
}

export function PhaseNotice({
  phase,
  title,
  children,
}: {
  phase: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="phase-notice">
      <span className="phase-notice__number">Phase {phase}</span>
      <div><h2>{title}</h2><p>{children}</p></div>
    </section>
  );
}
