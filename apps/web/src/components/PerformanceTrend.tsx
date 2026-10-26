import { useId } from 'react';
import type { PerformanceResponse } from '@mcsm/contracts';
import { performanceTrend, type TrendMetric } from '../performanceTrends';
import { formatBytes } from '../format';
import { useTranslation } from 'react-i18next';
import { currentLanguage, i18n, number } from '../i18n';

const timeLabel = (time: number) => Number.isFinite(time) ? new Date(time).toLocaleTimeString(currentLanguage()) : i18n.t('trend.noTime');
export function PerformanceTrend({ samples, metric, windowMs }: {
  samples: PerformanceResponse['data']['samples']; metric: TrendMetric; windowMs: number | null;
}) {
  const { t } = useTranslation();
  const id = useId(), trend = performanceTrend(samples, metric, windowMs);
  const x = (time: number) => trend.end === trend.start ? 320 : 20 + (time - trend.start) / (trend.end - trend.start) * 600;
  const y = (value: number) => 150 - value / trend.ceiling * 130;
  const ceiling = metric === 'ram' || metric === 'disk' ? formatBytes(trend.ceiling) : metric === 'cpu' ? `${number(trend.ceiling, { maximumFractionDigits: 0 })}%` : metric === 'players' ? t('trend.people', { count: trend.ceiling }) : `${number(trend.ceiling)} ${metric === 'mspt' ? 'ms' : 'TPS'}`;
  return <section className="panel performance-trend" aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`}>{t(`trend.${metric}`)}</h3>
    <p>{t('trend.points', { count: trend.count })}{trend.count === 1 ? ` · ${t('trend.single')}` : ''}</p>
    {!trend.count ? <p className="performance-trend-empty">{t('monitor.noTrend')}</p> : <>
      <div className="performance-trend__scale"><span>{t('trend.upper', { value: ceiling })}</span><span>{t('trend.lower')}</span></div>
      <svg viewBox="0 0 640 170" role="img" aria-labelledby={`${id}-title ${id}-description`}>
        <title id={`${id}-title`}>{t('trend.title', { metric: t(`trend.${metric}`) })}</title>
        <desc id={`${id}-description`}>{t('trend.description', { count: trend.count })}</desc>
        <path d="M20 20V150H620" fill="none" stroke="currentColor" opacity="0.25" />
        {trend.segments.map((segment, index) => <g key={index}>
          {segment.length > 1 ? <polyline points={segment.map(point => `${x(point.time)},${y(point.value)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" /> : null}
          {segment.map(point => <circle key={point.time} cx={x(point.time)} cy={y(point.value)} r="3" fill="currentColor">
            <title>{timeLabel(point.time)} · {metric === 'ram' || metric === 'disk' ? formatBytes(point.value) : number(point.value, { maximumFractionDigits: 20 })}{metric === 'cpu' ? '%' : ''}</title>
          </circle>)}
        </g>)}
      </svg>
      <div className="performance-trend__scale"><span>{timeLabel(trend.start)}</span><span>{timeLabel(trend.end)}</span></div>
    </>}
  </section>;
}
