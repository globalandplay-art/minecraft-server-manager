import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import type { Metrics, ServerStatus } from '@mcsm/contracts';
import { formatLocalTime } from '../format';

/** Observations only: no inferred crash cause, thresholds or automatic actions. */
export function PerformanceNotices({ status, metrics, readFailed }: {
  status?: ServerStatus | undefined; metrics?: Metrics | undefined; readFailed: boolean;
}) {
  useTranslation();
  const missing = metrics ? Object.entries(metrics).filter(([, metric]) => metric.status === 'unavailable').map(([key]) => key.toUpperCase()) : [];
  const stale = metrics ? Object.entries(metrics).filter(([, metric]) => metric.status === 'stale').map(([key]) => key.toUpperCase()) : [];
  return <section className="settings-panel" aria-label={i18n.t('notices.heading')}>
    <h2>{i18n.t('notices.heading')}</h2>
    {status ? <>
      <p>{i18n.t('notices.snapshot', { time: formatLocalTime(status.observedAt) })}</p>
      {status.recoveryRequired ? <p role="alert">{i18n.t('notices.recovery')}</p> : null}
      {status.state === 'crashed' ? <p role="alert">{i18n.t('notices.crashed')}</p> : null}
      {status.state === 'unknown' ? <p>{i18n.t('notices.unknown')}</p> : null}
    </> : <p>{i18n.t('notices.noState')}</p>}
    {readFailed ? <p>{i18n.t('notices.failed')}</p> : null}
    {stale.length ? <p>{i18n.t('notices.stale', { metrics: stale.join(', ') })}</p> : null}
    {missing.length ? <p>{i18n.t('notices.missing', { metrics: missing.join(', ') })}</p> : null}
    {metrics?.tps.status === 'unavailable' || metrics?.mspt.status === 'unavailable' ?
      <p>{i18n.t('notices.tps')}</p> : null}
    {!metrics ? <p>{i18n.t('notices.noMetrics')}</p> : null}
    <p>{i18n.t('notices.scope')}</p>
  </section>;
}
