import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, api } from '../api';
import { BackupsPage, WorldsPage } from './WorldsBackups';

vi.mock('../api', async (load) => ({ ...(await load<typeof import('../api')>()), api: {
  worlds: vi.fn(), backups: vi.fn(), createBackup: vi.fn(), operation: vi.fn(), createBackupExport: vi.fn(), backupExport: vi.fn(),
  backupDownloadUrl: (serverId: string, backupId: string) => `/api/v1/servers/${serverId}/backups/${backupId}/download`,
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
  const backup = { id: '123e4567-e89b-42d3-a456-426614174000', serverId: 'vanilla-local', scope: 'world-set',
    kind: 'manual', label: 'World backup', createdAt: meta.generatedAt, minecraftVersion: '26.3', fileCount: 2, sizeBytes: 100 };
  it('世界备份导出成功后提供浏览器下载链接，私有快照没有导出按钮', async () => {
    vi.mocked(api.backups).mockResolvedValue({ data: { items: [backup, { ...backup, id: 'snapshot', scope: 'server-snapshot', kind: 'snapshot' }], nextCursor: null }, meta } as never);
    vi.mocked(api.createBackupExport).mockResolvedValue({ data: { operation: { id: 'export-1', state: 'queued' } }, meta } as never);
    vi.mocked(api.operation).mockResolvedValue({ data: { id: 'export-1', state: 'succeeded', step: 'completed', error: null }, meta } as never);
    vi.mocked(api.backupExport).mockResolvedValue({ data: { backupId: backup.id, state: 'ready', sizeBytes: 200, checksumSha256: '0'.repeat(64) }, meta } as never);
    renderWithQuery(<BackupsPage server={server as never} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download World Set' }));
    const link = await screen.findByRole('link', { name: '下载世界备份' });
    expect(link).toHaveAttribute('href', `/api/v1/servers/vanilla-local/backups/${backup.id}/download`);
    expect(api.createBackupExport).toHaveBeenCalledWith('vanilla-local', backup.id, expect.any(String));
    expect(screen.getByText('私有服务端快照禁止下载')).toBeInTheDocument();
  });
  it('Ready 后重新校验使用新请求，并显示缓存安全错误', async () => {
    vi.mocked(api.backups).mockResolvedValue({ data: { items: [backup], nextCursor: null }, meta } as never);
    vi.mocked(api.createBackupExport)
      .mockResolvedValueOnce({ data: { operation: { id: 'ready-export', state: 'queued' } }, meta } as never)
      .mockResolvedValueOnce({ data: { operation: { id: 'recheck-export', state: 'queued' } }, meta } as never);
    vi.mocked(api.operation).mockImplementation(async (id) => ({ data: id === 'ready-export'
      ? { id, state: 'succeeded', step: 'completed', error: null }
      : { id, state: 'failed', error: { code: 'EXPORT_LAYOUT_UNSAFE', message: '此备份无法安全导出，请检查备份完整性与世界文件布局。' } }, meta }) as never);
    vi.mocked(api.backupExport).mockResolvedValue({ data: { backupId: backup.id, state: 'ready', sizeBytes: 200, checksumSha256: '0'.repeat(64) }, meta } as never);
    renderWithQuery(<BackupsPage server={server as never} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download World Set' }));
    const retry = await screen.findByRole('button', { name: '重新校验并下载' });
    expect(screen.getByText(/页面无法确认传输结果/)).toBeInTheDocument();
    const firstKey = vi.mocked(api.createBackupExport).mock.calls[0]![2];
    fireEvent.click(retry);
    expect(await screen.findByRole('alert')).toHaveTextContent('此备份无法安全导出');
    expect(vi.mocked(api.createBackupExport).mock.calls[1]![2]).not.toBe(firstKey);
    expect(screen.queryByRole('link', { name: '下载世界备份' })).not.toBeInTheDocument();
  });
  it('秘密扫描失败显示原因，且不显示下载链接', async () => {
    vi.mocked(api.backups).mockResolvedValue({ data: { items: [backup], nextCursor: null }, meta } as never);
    vi.mocked(api.createBackupExport).mockResolvedValue({ data: { operation: { id: 'export-fail', state: 'queued' } }, meta } as never);
    vi.mocked(api.operation).mockResolvedValue({ data: { state: 'failed', error: { code: 'SENSITIVE_ARCHIVE', message: '导出被阻止：检测到敏感信息。' } }, meta } as never);
    renderWithQuery(<BackupsPage server={server as never} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download World Set' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('检测到敏感信息');
    expect(screen.queryByRole('link', { name: '下载世界备份' })).not.toBeInTheDocument();
  });
  it('导出提交断线后复用同一幂等键', async () => {
    vi.mocked(api.backups).mockResolvedValue({ data: { items: [backup], nextCursor: null }, meta } as never);
    vi.mocked(api.createBackupExport).mockRejectedValue(new ApiClientError('网络断开', 'network'));
    renderWithQuery(<BackupsPage server={server as never} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download World Set' }));
    await screen.findByRole('alert');
    const firstKey = vi.mocked(api.createBackupExport).mock.calls[0]![2];
    fireEvent.click(screen.getByRole('button', { name: '用相同请求确认导出' }));
    await waitFor(() => expect(api.createBackupExport).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.createBackupExport).mock.calls[1]![2]).toBe(firstKey);
  });
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
