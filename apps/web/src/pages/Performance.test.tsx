import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Metrics, PerformanceResponse, ServersResponse } from '@mcsm/contracts';
import { api } from '../api';
import { PerformancePage } from './Performance';
vi.mock('../api', async (load) => ({ ...(await load<typeof import('../api')>()), api: { performance: vi.fn() } }));
const unavailable = { status: 'unavailable', value: null, source: null, sampledAt: null, reason: 'not-collected' } as const;
const metrics: Metrics = { cpu: unavailable, ram: unavailable, disk: unavailable, tps: unavailable,
  mspt: unavailable, players: unavailable, uptime: unavailable };
const response: PerformanceResponse = { meta: { mode: 'local', requestId: 'test', generatedAt: '2026-10-08T00:00:00Z' },
  data: { retention: 'manager-session', minimumIntervalMs: 5000, samples: [] } };
function show() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
  <PerformancePage server={{ server: { id: 'test' } } as ServersResponse['data']['items'][number]} /></QueryClientProvider>); }
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('Performance truthful display', () => {
  it('shows empty history without creating values', async () => {
    vi.mocked(api.performance).mockResolvedValue(response); show();
    expect(await screen.findByText('暂无采样记录')).toBeInTheDocument();
  });
  it('preserves N/A and stale evidence', async () => {
    vi.mocked(api.performance).mockResolvedValue({ ...response, data: { ...response.data,
      samples: [{ collectedAt: response.meta.generatedAt, metrics: { ...metrics,
        cpu: { status: 'stale', value: 10, source: 'process', sampledAt: '2026-10-07T00:00:00Z', reason: 'probe-unavailable' } } }] } });
    show(); expect(await screen.findByText('10 · 旧数据 (probe-unavailable)')).toBeInTheDocument();
    expect(screen.getAllByText('N/A · not-collected')).toHaveLength(6);
  });
  it('labels volume usage, total and free separately', async () => {
    vi.mocked(api.performance).mockResolvedValue({ ...response, data: { ...response.data,
      samples: [{ collectedAt: response.meta.generatedAt, metrics: { ...metrics,
        disk: { status: 'available', value: { usedBytes: 1024, totalBytes: 4096, freeBytes: 3072 },
          source: 'filesystem', sampledAt: response.meta.generatedAt } } }] } });
    show(); expect(await screen.findByText(/已用 .*总量 .*可用/)).toBeInTheDocument();
  });
});
