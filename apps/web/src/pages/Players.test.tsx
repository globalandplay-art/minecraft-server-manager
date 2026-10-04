import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServersResponse } from '@mcsm/contracts';
import { api, ApiClientError } from '../api';
import { PlayersPage } from './Players';
vi.mock('../api', async (load) => ({ ...(await load<typeof import('../api')>()), api: { players: vi.fn() } }));
const server = { server: { id: 'test' } } as ServersResponse['data']['items'][number];
const meta = { mode: 'local' as const, requestId: 'test', generatedAt: '2026-10-04T10:00:00.000Z' };
function show() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PlayersPage server={server} /></QueryClientProvider>); }
beforeEach(() => { cleanup(); vi.clearAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(Date.parse(meta.generatedAt)); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe('Players truthful read-only UI', () => {
  it('shows unavailable without claiming an empty server', async () => {
    vi.mocked(api.players).mockResolvedValue({ meta, data: { availability: 'unavailable', completeness: 'unknown', items: [], sampledAt: null, reason: 'managed-rcon-unavailable' } });
    show(); expect(await screen.findByText('在线名单暂不可用')).toBeInTheDocument(); expect(screen.queryByText('当前没有在线玩家。')).not.toBeInTheDocument();
  });
  it('shows names without inventing UUIDs or action controls', async () => {
    vi.mocked(api.players).mockResolvedValue({ meta, data: { availability: 'available', completeness: 'full', sampledAt: meta.generatedAt, reason: null,
      items: [{ id: 'opaque', uuid: null, name: 'Steve', online: true }] } });
    show(); expect(await screen.findByText('Steve')).toBeInTheDocument(); expect(screen.getByText(/UUID 未验证/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /kick|ban|op/i })).not.toBeInTheDocument();
  });
  it('only claims zero when an available complete sample is returned', async () => {
    vi.mocked(api.players).mockResolvedValue({ meta, data: { availability: 'available', completeness: 'full', sampledAt: meta.generatedAt, reason: null, items: [] } });
    show(); expect(await screen.findByText('当前没有在线玩家。')).toBeInTheDocument();
  });
  it('marks an old zero-player sample stale and clears it only after a fresh success', async () => {
    const data = { availability: 'available' as const, completeness: 'full' as const, sampledAt: meta.generatedAt, reason: null, items: [] };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(['players', 'test'], { meta, data });
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.mocked(api.players).mockImplementation(() => new Promise(() => {}));
    render(<QueryClientProvider client={client}><PlayersPage server={server} /></QueryClientProvider>);
    expect(screen.getByText('当前没有在线玩家。')).toBeInTheDocument();
    const later = Date.parse(meta.generatedAt) + 16_000;
    vi.mocked(Date.now).mockReturnValue(later);
    await act(async () => { vi.advanceTimersByTime(16_000); });
    expect(screen.getByText('上次采样没有在线玩家。')).toBeInTheDocument();
    expect(screen.queryByText('当前没有在线玩家。')).not.toBeInTheDocument();
    await act(async () => { client.setQueryData(['players', 'test'], { meta, data: { ...data, sampledAt: new Date(later).toISOString() } }); });
    vi.useRealTimers();
    expect(await screen.findByText('当前没有在线玩家。')).toBeInTheDocument();
    expect(screen.queryByText('旧数据：在线状态尚未重新确认。')).not.toBeInTheDocument();
  });
  it('hides old data on a query failure and restores it after an explicit retry', async () => {
    const data = { availability: 'available' as const, completeness: 'full' as const, sampledAt: meta.generatedAt, reason: null, items: [] };
    vi.mocked(api.players).mockResolvedValue({ meta, data }); show();
    expect(await screen.findByText('当前没有在线玩家。')).toBeInTheDocument();
    vi.mocked(api.players).mockRejectedValue(new ApiClientError('测试连接失败', 'http', 403, 'LOCAL_REQUEST_REQUIRED'));
    fireEvent.click(screen.getByRole('button', { name: '刷新在线名单' }));
    expect(await screen.findByText('测试连接失败')).toBeInTheDocument(); expect(screen.queryByText('当前没有在线玩家。')).not.toBeInTheDocument();
    vi.mocked(api.players).mockResolvedValue({ meta, data });
    fireEvent.click(screen.getByRole('button', { name: '刷新在线名单' }));
    expect(await screen.findByText('当前没有在线玩家。')).toBeInTheDocument();
  });
});
