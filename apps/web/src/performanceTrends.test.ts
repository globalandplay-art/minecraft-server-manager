import { expect, it } from 'vitest';
import type { Metrics, PerformanceResponse } from '@mcsm/contracts';
import { performanceTrend } from './performanceTrends';
const missing = { status: 'unavailable', value: null, source: null, sampledAt: null, reason: 'not-collected' } as const;
const metrics: Metrics = { cpu: missing, ram: missing, disk: missing, players: missing, tps: missing, mspt: missing, uptime: missing };
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 20, 0, 0, seconds)).toISOString();
type Sample = PerformanceResponse['data']['samples'][number];
function sample(second: number, cpu: Metrics['cpu'] = { status: 'available', value: second, sampledAt: at(second), source: 'process' }): Sample {
  return { collectedAt: at(second), metrics: { ...metrics, cpu } };
}
it('keeps genuine zero values and breaks lines at missing, stale and long gaps', () => {
  const rows = [sample(0), sample(5), sample(10, missing), sample(15),
    sample(20, { status: 'stale', value: 10, sampledAt: at(15), source: 'process', reason: 'probe-unavailable' }), sample(25), sample(50)];
  const trend = performanceTrend(rows, 'cpu', null);
  expect(trend.count).toBe(5); expect(trend.segments.map(segment => segment.length)).toEqual([2, 1, 1, 1]);
  expect(trend.segments[0]![0]!.value).toBe(0); expect(trend.ceiling).toBe(100);
});
it('places metric observations at their source timestamp and does not duplicate cached readings', () => {
  const old = { status: 'available', value: 12, source: 'process', sampledAt: at(0) } as const;
  const trend = performanceTrend([sample(1, old), sample(5, old), sample(10)], 'cpu', null);
  expect(trend.count).toBe(2); expect(trend.segments[0]!.map(point => point.time)).toEqual([Date.parse(at(0)), Date.parse(at(10))]);
});
it('filters by the selected actual time window, not index or interpolation', () => {
  const trend = performanceTrend([sample(0), sample(5), sample(65), sample(70)], 'cpu', 60_000);
  expect(trend.count).toBe(2); expect(trend.segments[0]!.map(point => point.value)).toEqual([65, 70]);
});
it('rejects nonfinite, future, backward and out-of-range CPU readings', () => {
  const cpu = (value: number, second: number): Metrics['cpu'] => ({ status: 'available', value, sampledAt: at(second), source: 'process' });
  const trend = performanceTrend([sample(0), sample(5, cpu(NaN, 5)), sample(10, cpu(101, 10)),
    sample(15, cpu(5, 20)), sample(20, cpu(4, -5)), sample(25)], 'cpu', null);
  expect(trend.count).toBe(2); expect(trend.segments.map(segment => segment.length)).toEqual([1, 1]);
});
it('limits work to120 snapshots and breaks provenance changes', () => {
  const rows = Array.from({ length: 130 }, (_, index) => sample(index * 5, { status: 'available', value: 10,
    sampledAt: at(index * 5), source: index < 129 ? 'process' : 'mock' }));
  const trend = performanceTrend(rows, 'cpu', null);
  expect(trend.count).toBe(120); expect(trend.segments.map(segment => segment.length)).toEqual([119, 1]);
});
it('uses RSS bytes, free-volume bytes and actual online players without inferring TPS', () => {
  const row = sample(5); row.metrics = { ...metrics,
    ram: { status: 'available', value: { rssBytes: 4096 }, sampledAt: at(5), source: 'process' },
    disk: { status: 'available', value: { totalBytes: 8192, freeBytes: 3072, usedBytes: 5120 }, sampledAt: at(5), source: 'filesystem' },
    players: { status: 'available', value: { online: 3, max: 20 }, sampledAt: at(5), source: 'status-query' } };
  expect(performanceTrend([row], 'ram', null).segments[0]![0]!.value).toBe(4096);
  expect(performanceTrend([row], 'disk', null).segments[0]![0]!.value).toBe(3072);
  expect(performanceTrend([row], 'players', null).segments[0]![0]!.value).toBe(3);
  expect(row.metrics.tps).toEqual(missing);
});
it('does not produce points from empty or unavailable history', () => {
  expect(performanceTrend([], 'cpu', null).count).toBe(0);
  expect(performanceTrend([sample(5, missing)], 'cpu', null).segments).toEqual([]);
});
