import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Metrics, PerformanceResponse, ServersResponse } from '@mcsm/contracts';
import { api } from '../api';
import { PerformancePage } from './Performance';
import { i18n } from '../i18n';
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
  it('renders one selected trend and never makes TPS/MSPT points from unavailable metrics', async () => {
    vi.mocked(api.performance).mockResolvedValue({ ...response, data: { ...response.data, samples: [{ collectedAt: response.meta.generatedAt, metrics: { ...metrics, cpu: { status: 'available', value: 25, source: 'process', sampledAt: response.meta.generatedAt } } }] } });
    show(); await screen.findByRole('cell', { name: 'CPU' });
    expect(document.querySelectorAll('.performance-trend')).toHaveLength(1);
    expect(document.querySelectorAll('.performance-trend circle')).toHaveLength(1);
    expect(document.querySelectorAll('.performance-trend polyline')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('趋势指标'), { target: { value: 'tps' } });
    expect(screen.getByText('暂无可信趋势数据')).toBeVisible();
    expect(document.querySelectorAll('.performance-trend svg')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('趋势指标'), { target: { value: 'mspt' } });
    expect(screen.getByText('暂无可信趋势数据')).toBeVisible();
    expect(api.performance).toHaveBeenCalledTimes(1);
  });
  it('limits displayed history to120 samples and reveals only12 rows at a time', async () => {
    const samples = Array.from({ length: 130 }, (_, index) => {
      const at = new Date(Date.parse(response.meta.generatedAt) + index * 5000).toISOString();
      return { collectedAt: at, metrics: { ...metrics, cpu: { status: 'available' as const, value: 25, source: 'mock' as const, sampledAt: at } } };
    });
    vi.mocked(api.performance).mockResolvedValue({ ...response, meta: { ...response.meta, mode: 'mock' }, data: { ...response.data, samples } });
    show(); await screen.findByText('120 / 120');
    expect(document.querySelectorAll('.performance-history tbody tr')).toHaveLength(12);
    expect(document.querySelectorAll('.performance-trend circle')).toHaveLength(120);
    fireEvent.click(screen.getByRole('button', { name: '查看更多（12 / 120）' }));
    expect(document.querySelectorAll('.performance-history tbody tr')).toHaveLength(24);
    expect(screen.getAllByText(/Mock/).length).toBeGreaterThan(0);
  });
  it('preserves paused state, range and selected metric across language changes without fetching', async () => {
    vi.mocked(api.performance).mockResolvedValue(response); show(); await screen.findByText('暂无采样记录');
    fireEvent.click(screen.getByRole('button', { name: '暂停自动刷新' }));
    fireEvent.change(screen.getByLabelText('趋势指标'), { target: { value: 'mspt' } });
    const range = screen.getByLabelText(i18n.t('performance.range'));
    fireEvent.change(range, { target: { value: 'minute' } });
    await act(async () => { await i18n.changeLanguage('ja'); });
    expect(screen.getByLabelText('グラフの指標')).toHaveValue('mspt'); expect(range).toHaveValue('minute');
    expect(screen.getByRole('button', { name: i18n.t('performance.resume') })).toBeVisible();
    expect(api.performance).toHaveBeenCalledTimes(1);
  });
  it('shows empty history without creating values', async () => {
    vi.mocked(api.performance).mockResolvedValue(response); show();
    expect(await screen.findByText('暂无采样记录')).toBeInTheDocument();
  });
  it('preserves N/A and stale evidence', async () => {
    vi.mocked(api.performance).mockResolvedValue({ ...response, data: { ...response.data,
      samples: [{ collectedAt: response.meta.generatedAt, metrics: { ...metrics,
        cpu: { status: 'stale', value: 10, source: 'process', sampledAt: '2026-10-07T00:00:00Z', reason: 'probe-unavailable' } } }] } });
    show(); expect(await screen.findByText('10 · 旧数据 (probe-unavailable)')).toBeInTheDocument();
    expect(within(screen.getByLabelText('性能采样')).getAllByText('N/A')).toHaveLength(5);
    expect(within(screen.getByLabelText('性能采样')).getAllByTitle('N/A · not-collected')).toHaveLength(5);
  });
  it('labels volume usage, total and free separately', async () => {
    vi.mocked(api.performance).mockResolvedValue({ ...response, data: { ...response.data,
      samples: [{ collectedAt: response.meta.generatedAt, metrics: { ...metrics,
        disk: { status: 'available', value: { usedBytes: 1024, totalBytes: 4096, freeBytes: 3072 },
          source: 'filesystem', sampledAt: response.meta.generatedAt } } }] } });
    show(); expect(await screen.findByText(/已用 .*总量 .*可用/)).toBeInTheDocument();
  });
  it('supports pausing, manual refresh and resuming without fabricated history', async () => {
    vi.mocked(api.performance).mockResolvedValue(response); show();
    await screen.findByText('暂无采样记录');
    fireEvent.click(screen.getByRole('button', { name: '暂停自动刷新' }));
    expect(screen.getByRole('status')).toHaveTextContent('自动刷新已暂停；可手动刷新采样。');
    fireEvent.click(screen.getByRole('button', { name: '刷新采样' }));
    await waitFor(() => expect(api.performance).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '恢复自动刷新' }));
    expect(screen.getByRole('button', { name: '暂停自动刷新' })).toBeInTheDocument();
  });
  it('labels retained readings when a refresh fails', async () => {
    vi.mocked(api.performance).mockResolvedValueOnce({ ...response, data: { ...response.data,
      samples: [{ collectedAt: response.meta.generatedAt, metrics }] } }).mockRejectedValue(new Error('offline'));
    show(); await screen.findByRole('cell', { name: 'CPU' });
    fireEvent.click(screen.getByRole('button', { name: '刷新采样' }));
    expect(await screen.findByText('以下为上次成功读取的旧快照，当前指标尚未确认。')).toBeInTheDocument();
    expect(within(screen.getByLabelText('性能采样')).getAllByText('N/A')).toHaveLength(6);
    expect(screen.getAllByText('暂无可信趋势数据')).toHaveLength(1);
    expect(document.querySelectorAll('.performance-trend svg')).toHaveLength(0);
  });
  it('suspends hidden-page requests and resumes observation when visible', async () => {
    vi.mocked(api.performance).mockResolvedValue(response);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    try {
      show();
      expect(api.performance).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: '刷新采样' })).toBeDisabled();
      hidden.mockReturnValue(false);
      fireEvent(document, new Event('visibilitychange'));
      await screen.findByText('暂无采样记录');
      expect(api.performance).toHaveBeenCalledTimes(1);
    } finally { hidden.mockRestore(); }
  });
});
