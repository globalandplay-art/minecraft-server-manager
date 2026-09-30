import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, api } from '../api';
import { BackupsPage, WorldsPage } from './WorldsBackups';

vi.mock('../api', async (load) => ({ ...(await load<typeof import('../api')>()), api: {
  worlds: vi.fn(), backups: vi.fn(), createBackup: vi.fn(), operation: vi.fn(),
} }));

const server = {
  server: { id: 'vanilla-local', name: 'Local Vanilla', type: 'vanilla' as const, minecraftVersion: '26.3', java: { runtimeVersion: '25', requiredMajor: 25 }, detection: { confidence: 'high' as const, evidence: ['version.json'], warnings: [] } },
  capabilities: { mods: false, plugins: false, rcon: true, console: true, backup: true, worlds: true, properties: true },
  status: { state: 'stopped' as const, ownership: 'none' as const, source: 'process' as const, observedAt: '2026-09-30T00:00:00.000Z', activeOperationId: null, recoveryRequired: false },
  readiness: { backup: { allowed: true, reason: null } } as never,
};
const meta = { requestId: 'test', generatedAt: '2026-09-30T00:00:00.000Z', mode: 'local' as const };
const world = { worldId: 'world', active: true, dimensions: [{ id: 'minecraft:overworld', kind: 'overworld' as const }], name: { status: 'available' as const, value: 'world', source: 'filesystem' as const, sampledAt: meta.generatedAt }, seed: { status: 'unavailable' as const, value: null, source: null, sampledAt: null, reason: 'not-readable' }, minecraftVersion: { status: 'available' as const, value: '26.3', source: 'level-dat' as const, sampledAt: meta.generatedAt }, sizeBytes: { status: 'available' as const, value: 1048576, source: 'filesystem' as const, sampledAt: meta.generatedAt }, difficulty: { status: 'unavailable' as const, value: null, source: null, sampledAt: null, reason: 'not-readable' }, gameMode: { status: 'unavailable' as const, value: null, source: null, sampledAt: null, reason: 'not-readable' }, hardcore: { status: 'unavailable' as const, value: null, source: null, sampledAt: null, reason: 'not-readable' }, pvp: { status: 'unavailable' as const, value: null, source: null, sampledAt: null, reason: 'not-readable' }, viewDistance: { status: 'unavailable' as const, value: null, source: null, sampledAt: null, reason: 'not-readable' }, simulationDistance: { status: 'unavailable' as const, value: null, source: null, sampledAt: null, reason: 'not-readable' }, fieldSources: {} as never };
function renderWithQuery(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe('Worlds 与备份初版页面', () => {
  beforeEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks(); });
  it('只显示后端确认的世界元数据和不可用值', async () => {
    vi.mocked(api.worlds).mockResolvedValue({ data: { items: [world] }, meta } as never);
    renderWithQuery(<WorldsPage server={server as never} />);
    expect(await screen.findByRole('heading', { name: 'world' })).toBeInTheDocument();
    expect(screen.getAllByText('不可用', { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText('1.0 MB')).toBeInTheDocument();
  });

  it('停止中的实例可以提交明确的 world-set 手动备份', async () => {
    vi.mocked(api.backups).mockResolvedValue({ data: { items: [], nextCursor: null }, meta } as never);
    vi.mocked(api.createBackup).mockResolvedValue({ data: { operation: { id: 'op-1', state: 'queued' } }, meta } as never);
    renderWithQuery(<BackupsPage server={server as never} />);
    fireEvent.change(await screen.findByLabelText('备份备注'), { target: { value: 'Before changes' } });
    fireEvent.click(screen.getByRole('button', { name: '创建备份' }));
    await waitFor(() => expect(api.createBackup).toHaveBeenCalledWith('vanilla-local', { scope: 'world-set', allowStop: false, label: 'Before changes' }, expect.any(String)));
    expect(screen.getByText(/服务端快照.*恢复目前未在页面开放/)).toBeInTheDocument();
  });

  it('响应不确定时保留 payload 与幂等键并使用相同请求重试', async () => {
    vi.mocked(api.backups).mockResolvedValue({ data: { items: [], nextCursor: null }, meta } as never);
    vi.mocked(api.createBackup).mockRejectedValueOnce(new Error('network failure'))
      .mockResolvedValueOnce({ data: { operation: { id: 'op-2', state: 'queued' } }, meta } as never);
    vi.mocked(api.operation).mockResolvedValue({ data: { state: 'succeeded' } } as never);
    const firstRender = renderWithQuery(<BackupsPage server={server as never} />);
    fireEvent.change(await screen.findByLabelText('备份备注'), { target: { value: 'Same request' } });
    fireEvent.click(screen.getByRole('button', { name: '创建备份' }));
    await waitFor(() => expect(api.createBackup).toHaveBeenCalledTimes(1));
    const first = vi.mocked(api.createBackup).mock.calls[0]!;
    expect(sessionStorage.getItem('mcsm.pendingBackup.vanilla-local')).toContain(first[2]);
    firstRender.unmount();
    renderWithQuery(<BackupsPage server={server as never} />);
    fireEvent.click(await screen.findByRole('button', { name: '用相同请求确认备份状态' }));
    await waitFor(() => expect(api.createBackup).toHaveBeenCalledTimes(2));
    const second = vi.mocked(api.createBackup).mock.calls[1]!;
    expect(second[1]).toEqual(first[1]);
    expect(second[2]).toBe(first[2]);
  });

  it('过期请求不再被当成状态查询，并要求创建新请求', async () => {
    const stale = { key: '123e4567-e89b-42d3-a456-426614174000', serverId: 'vanilla-local',
      savedAt: Date.now() - 25 * 60 * 60 * 1_000, body: { scope: 'world-set', allowStop: true } };
    sessionStorage.setItem('mcsm.pendingBackup.vanilla-local', JSON.stringify(stale));
    vi.mocked(api.backups).mockResolvedValue({ data: { items: [], nextCursor: null }, meta } as never);
    vi.mocked(api.createBackup).mockResolvedValue({ data: { operation: { id: 'op-3', state: 'queued' } }, meta } as never);
    vi.mocked(api.operation).mockResolvedValue({ data: { state: 'succeeded' } } as never);
    renderWithQuery(<BackupsPage server={server as never} />);
    expect(await screen.findByText(/超过 24 小时有效期/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建备份' }));
    await waitFor(() => expect(api.createBackup).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createBackup).mock.calls[0]![2]).not.toBe(stale.key);
  });

  it('明确的 API 拒绝会释放 pending 请求以便修正后重发', async () => {
    vi.mocked(api.backups).mockResolvedValue({ data: { items: [], nextCursor: null }, meta } as never);
    vi.mocked(api.createBackup).mockRejectedValueOnce(new ApiClientError('当前实例不允许停服', 'http', 409, 'SERVER_MUST_BE_STOPPED'));
    renderWithQuery(<BackupsPage server={server as never} />);
    fireEvent.click(await screen.findByRole('button', { name: '创建备份' }));
    await waitFor(() => expect(sessionStorage.getItem('mcsm.pendingBackup.vanilla-local')).toBeNull());
    expect(screen.getByLabelText('备份备注')).not.toBeDisabled();
  });
});
