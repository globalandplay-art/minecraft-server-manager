import type { PerformanceResponse } from '@mcsm/contracts';

export type TrendMetric = 'cpu' | 'ram' | 'disk' | 'players';
type Sample = PerformanceResponse['data']['samples'][number];
export type TrendPoint = Readonly<{ time: number; value: number }>;
/** At most120 API snapshots; metric timestamps, not collection time, locate points.
 * Missing/stale/invalid data and gaps over10s break lines. No zero filling. */
export function performanceTrend(samples: readonly Sample[], key: TrendMetric, windowMs: number | null) {
  const bounded = samples.slice(-120);
  const collectedTimes = bounded.map(sample => Date.parse(sample.collectedAt)).filter(Number.isFinite);
  const anchor = collectedTimes.length ? Math.max(...collectedTimes) : NaN;
  const cutoff = windowMs === null ? -Infinity : anchor - windowMs;
  const segments: TrendPoint[][] = [];
  let segment: TrendPoint[] = [], lastTime = -Infinity, count = 0, lastSource: string | null = null;
  const endSegment = () => { if (segment.length) segments.push(segment); segment = []; };
  for (const sample of bounded) {
    const collected = Date.parse(sample.collectedAt), metric = sample.metrics[key];
    if (!Number.isFinite(collected) || collected < cutoff || metric.status !== 'available') { endSegment(); continue; }
    const time = Date.parse(metric.sampledAt);
    const value = typeof metric.value === 'number' ? metric.value : 'rssBytes' in metric.value ? metric.value.rssBytes :
      'online' in metric.value ? metric.value.online : metric.value.freeBytes;
    if (!Number.isFinite(time) || time > collected || time < cutoff || !Number.isFinite(value) || value < 0 || (key === 'cpu' && value > 100)) {
      endSegment(); continue;
    }
    if (time <= lastTime) { if (time < lastTime) endSegment(); continue; }
    if (time - lastTime > 10_000 || metric.source !== lastSource) endSegment();
    segment.push({ time, value }); lastTime = time; lastSource = metric.source; count++;
  }
  endSegment();
  const points = segments.flat(), start = points[0]?.time ?? anchor, end = Number.isFinite(anchor) ? anchor : start;
  return { segments, count, start, end, ceiling: key === 'cpu' ? 100 : Math.max(1, ...points.map(point => point.value)) };
}
