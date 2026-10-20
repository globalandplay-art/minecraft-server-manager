import { useId } from 'react';
import type { PerformanceResponse } from '@mcsm/contracts';
import { performanceTrend, type TrendMetric } from '../performanceTrends';
import { formatBytes } from '../format';

const labels: Record<TrendMetric, string> = { cpu: 'CPU 使用率', ram: '进程内存', disk: '磁盘可用空间', players: '在线玩家数' };
const timeLabel = (time: number) => Number.isFinite(time) ? new Date(time).toLocaleTimeString() : '暂无时间';
export function PerformanceTrend({ samples, metric, windowMs }: {
  samples: PerformanceResponse['data']['samples']; metric: TrendMetric; windowMs: number | null;
}) {
  const id = useId(), trend = performanceTrend(samples, metric, windowMs);
  const x = (time: number) => trend.end === trend.start ? 320 : 20 + (time - trend.start) / (trend.end - trend.start) * 600;
  const y = (value: number) => 150 - value / trend.ceiling * 130;
  const ceiling = metric === 'ram' || metric === 'disk' ? formatBytes(trend.ceiling) : `${trend.ceiling.toFixed(0)}${metric === 'cpu' ? '%' : ' 人'}`;
  return <section className="panel performance-trend" aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`}>{labels[metric]}</h3>
    <p>{trend.count} 个可信采样点{trend.count === 1 ? ' · 只有一个点，暂不连线' : ''}</p>
    {!trend.count ? <p>此范围内没有可绘制的可信数据。</p> : <>
      <div className="performance-trend__scale"><span>上界 {ceiling}</span><span>下界 0</span></div>
      <svg viewBox="0 0 640 170" role="img" aria-labelledby={`${id}-title ${id}-description`}>
        <title id={`${id}-title`}>{labels[metric]}历史趋势</title>
        <desc id={`${id}-description`}>{trend.count} 个有效点。缺失、旧数据和超过10秒的间隔不连接；不会补零或推算指标。</desc>
        <path d="M20 20V150H620" fill="none" stroke="currentColor" opacity="0.25" />
        {trend.segments.map((segment, index) => <g key={index}>
          {segment.length > 1 ? <polyline points={segment.map(point => `${x(point.time)},${y(point.value)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" /> : null}
          {segment.map(point => <circle key={point.time} cx={x(point.time)} cy={y(point.value)} r="3" fill="currentColor">
            <title>{timeLabel(point.time)} · {metric === 'ram' || metric === 'disk' ? formatBytes(point.value) : point.value}{metric === 'cpu' ? '%' : ''}</title>
          </circle>)}
        </g>)}
      </svg>
      <div className="performance-trend__scale"><span>{timeLabel(trend.start)}</span><span>{timeLabel(trend.end)}</span></div>
    </>}
  </section>;
}
