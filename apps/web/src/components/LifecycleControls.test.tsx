import type { Operation, OverviewResponse } from '@mcsm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, api } from '../api';
import { LifecycleControls } from './LifecycleControls';

type Summary = OverviewResponse['data']['summary'];
const blocked = { allowed: false as const, reason: 'mock-mode' };
const allowed = { allowed: true as const, reason: null };

function summary(state: Summary['status']['state'], readiness: Partial<Summary['readiness']> = {}): Summary {
  return {
    server: {
      id: 'vanilla-local', name: 'Local Vanilla', type: 'vanilla', minecraftVersion: '26.3',
      java: { runtimeVersion: '25.0.1', requiredMajor: 25 },
      detection: { confidence: 'high', evidence: ['server.jar'], warnings: [] },
    },
    capabilities: { mods: false, plugins: false, rcon: false, console: true, backup: false, worlds: true, properties: true },
    status: { state, ownership: 'managed', source: 'process', observedAt: '2026-09-27T00:00:00.000Z', activeOperationId: null, recoveryRequired: false },
    readiness: {
      start: blocked, stop: blocked, restart: blocked, commands: blocked, backup: blocked,
      restore: blocked, worldChanges: blocked, addonChanges: blocked, propertiesChanges: blocked,
      commandTransport: 'stdin',
      ...readiness,
    },
  };
}

function renderControls(value: Summary, mode: 'mock' | 'local', implemented: boolean, stale = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><LifecycleControls summary={value} mode={mode} feature={{ implemented, phase: 2 }} stale={stale} /></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LifecycleControls', () => {
  it('Mock 模式保持三项操作禁用并常显阶段原因', () => {
    renderControls(summary('running'), 'mock', false);

    expect(screen.getByRole('button', { name: '启动' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '停止' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重启' })).toBeDisabled();
    expect(screen.getByText('Phase 2 接入本地服务器后启用')).toBeVisible();
  });

  it('202 只显示进行中 Operation，使用 UUID 幂等键且不宣告成功', async () => {
    const operation: Operation = {
      id: 'op-start-1', serverId: 'vanilla-local', kind: 'start', state: 'queued', step: '等待实例锁', progress: null,
      createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z', result: null, error: null,
    };
    const lifecycle = vi.spyOn(api, 'lifecycle').mockResolvedValue({ data: { operation }, meta: { requestId: 'req-1', generatedAt: '2026-09-27T00:00:00.000Z', mode: 'local' } });
    vi.spyOn(api, 'operation').mockReturnValue(new Promise(() => undefined));
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174000');
    renderControls(summary('stopped', { start: allowed }), 'local', true);

    await userEvent.click(screen.getByRole('button', { name: '启动' }));
    expect(await screen.findByText('操作进行中')).toBeVisible();
    expect(screen.queryByText('操作已完成')).not.toBeInTheDocument();
    expect(lifecycle).toHaveBeenCalledWith('vanilla-local', 'start', '123e4567-e89b-42d3-a456-426614174000');
  });

  it('重启是独立点击并先说明保存与断开玩家影响', async () => {
    renderControls(summary('running', { stop: allowed, restart: allowed }), 'local', true);

    await userEvent.click(screen.getByRole('button', { name: '重启' }));
    expect(screen.getByRole('dialog', { name: '确认重启服务器' })).toBeVisible();
    expect(screen.getByText(/保存世界、停止服务器并断开在线玩家/)).toBeVisible();
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
  });

  it('提交期间所有按钮禁用时 Tab 仍留在确认对话框', async () => {
    vi.spyOn(api, 'lifecycle').mockReturnValue(new Promise(() => undefined));
    renderControls(summary('running', { stop: allowed }), 'local', true);

    await userEvent.click(screen.getByRole('button', { name: '停止' }));
    await userEvent.click(screen.getByRole('button', { name: '确认停止' }));
    const dialog = screen.getByRole('dialog', { name: '确认停止服务器' });
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();

    await userEvent.tab();
    expect(dialog).toHaveFocus();
  });

  it('把后端状态原因显示为可读中文', () => {
    renderControls(summary('starting', {
      start: { allowed: false, reason: 'state-starting' },
      stop: { allowed: false, reason: 'transport-unavailable' },
      restart: { allowed: false, reason: 'server-state-unknown' },
    }), 'local', true);

    expect(screen.getByText(/服务器正在启动/)).toBeVisible();
    expect(screen.getByText(/当前没有可用的 RCON 或受管 stdin 通道/)).toBeVisible();
    expect(screen.getByText(/无法可靠确认服务器状态/)).toBeVisible();
  });

  it('快照过期时禁用生命周期操作且不会发出 mutation', async () => {
    const lifecycle = vi.spyOn(api, 'lifecycle');
    renderControls(summary('stopped', { start: allowed }), 'local', true, true);

    const start = screen.getByRole('button', { name: '启动' });
    expect(start).toBeDisabled();
    expect(screen.getByText(/请先刷新并取得最新状态/)).toBeVisible();
    await userEvent.click(start);
    expect(lifecycle).not.toHaveBeenCalled();
  });

  it('网络中断不自动重试写请求，只允许用户用相同幂等键确认', async () => {
    const lifecycle = vi.spyOn(api, 'lifecycle').mockRejectedValue(new ApiClientError('请求超时', 'network'));
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174000');
    renderControls(summary('stopped', { start: allowed }), 'local', true);

    await userEvent.click(screen.getByRole('button', { name: '启动' }));
    expect(await screen.findByText('操作提交结果未知')).toBeVisible();
    expect(lifecycle).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: '使用相同幂等键确认' }));
    expect(lifecycle).toHaveBeenCalledTimes(2);
    expect(lifecycle.mock.calls[1]).toEqual(lifecycle.mock.calls[0]);
  });
});
