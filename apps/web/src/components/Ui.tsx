import { AlertTriangle, CircleOff, CloudOff, Database, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalTime, formatSource, statusLabels } from '../format';

export function StatusBadge({ status, mock = false }: { status: string; mock?: boolean }) {
  useTranslation();
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
  const { t } = useTranslation();
  return (
    <div className="mock-banner" role="status">
      <Database size={17} aria-hidden="true" />
      <strong>{t('monitor.mock')}</strong>
      <span>{t('ui.mockBanner')}</span>
    </div>
  );
}

export function ConnectionBanner({ message, retry }: { message: string; retry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="connection-banner" role="alert">
      <CloudOff size={19} aria-hidden="true" />
      <div><strong>{t('ui.apiError')}</strong><span>{message} {t('ui.lastValidData')}</span></div>
      <button className="button button--secondary" onClick={retry}>
        <RefreshCw size={16} aria-hidden="true" />{t('common.retry')}
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
  title,
  description,
  retry,
  secondary,
}: {
  title?: string;
  description: string;
  retry?: () => void;
  secondary?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className="state-card state-card--error" role="alert">
      <span className="state-card__icon" aria-hidden="true"><AlertTriangle size={24} /></span>
      <h2>{title ?? t('ui.loadError')}</h2>
      <p>{description}</p>
      <div className="state-actions">
        {retry ? <button className="button button--primary" onClick={retry}><RefreshCw size={16} />{t('common.retry')}</button> : null}
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
  const { t } = useTranslation();
  const stale = Boolean(staleReason || forceStale);
  return (
    <article className={`metric-card ${stale ? 'metric-card--stale' : ''}`}>
      <div className="metric-card__header">
        <span>{label}</span>
        {stale ? <span className="stale-label">{t('ui.stale')}</span> : null}
      </div>
      <div className={`metric-card__value ${tone ? `metric-card__value--${tone}` : ''}`}>
        {value}{unit ? <small>{unit}</small> : null}
      </div>
      {detail ? <div className="metric-card__detail">{detail}</div> : null}
      <div className="metric-card__meta">
        <span>{unavailableReason ?? (source ? formatSource(source) : t('ui.statusProbe'))}</span>
        {sampledAt ? <time dateTime={sampledAt}>{formatLocalTime(sampledAt)}</time> : null}
      </div>
      {staleReason ? <p className="metric-card__reason">{staleReason}</p> : null}
    </article>
  );
}

export function SkeletonMetrics() {
  const { t } = useTranslation();
  return (
    <div className="metrics-grid" aria-label={t('ui.loadingMetrics')} aria-busy="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="metric-card metric-card--skeleton" key={index}>
          <span className="skeleton skeleton--label" />
          <span className="skeleton skeleton--value" />
          <span className="skeleton skeleton--meta" />
        </div>
      ))}
      <span className="sr-only">{t('ui.loadingMetrics')}</span>
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
