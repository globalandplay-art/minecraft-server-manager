import type { ServersResponse } from '@mcsm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authState } from '../authState';
beforeEach(() => authState.legacy(authState.checking()));
import { api } from '../api';
import { ConsolePage } from './Console';

type ServerSummary = ServersResponse['data']['items'][number];
const blocked = { allowed: false as const, reason: 'not-available' };
const server: ServerSummary = {
  server: {
    id: 'vanilla-local', name: 'Local Vanilla', type: 'vanilla', minecraftVersion: '26.3',
    java: { runtimeVersion: '25.0.1', requiredMajor: 25 },
    detection: { confidence: 'high', evidence: ['server.jar'], warnings: [] },
  },
  capabilities: { mods: false, plugins: false, rcon: false, console: true, backup: false, worlds: true, properties: true },
  status: { state: 'running', ownership: 'managed', source: 'process', observedAt: '2026-09-27T00:00:00.000Z', activeOperationId: null, recoveryRequired: false },
  readiness: {
    start: blocked, stop: { allowed: true, reason: null }, restart: { allowed: true, reason: null }, commands: { allowed: true, reason: null },
    backup: blocked, restore: blocked, worldChanges: blocked, addonChanges: blocked, propertiesChanges: blocked,
    commandTransport: 'stdin',
  },
};

class MockWebSocket {
  static latest: MockWebSocket;
  readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
  constructor(readonly url: string | URL) { MockWebSocket.latest = this; }
  addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {}
  message(payload: unknown) {
    for (const listener of this.listeners.get('message') ?? []) listener({ data: JSON.stringify(payload) });
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ConsolePage', () => {
  it('将日志作为纯文本呈现，并区分 stdin submitted 与真实输出', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.spyOn(api, 'command').mockResolvedValue({
      data: { status: 'submitted', transport: 'stdin', output: null },
      meta: { requestId: 'req-command', generatedAt: '2026-09-27T00:00:00.000Z', mode: 'local' },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><ConsolePage server={server} feature={{ implemented: true, phase: 2 }} /></QueryClientProvider>);

    act(() => {
      MockWebSocket.latest.message({ type: 'hello', streamId: 'stream-one', latestSequence: 1 });
      MockWebSocket.latest.message({
        type: 'snapshot', sequence: 1, status: server.status,
        logs: [{ id: 'log-1', cursor: 'cursor-1', timestamp: null, level: 'error', text: '<img src=x onerror=alert(1)>', source: 'latest.log' }],
      });
    });
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(document.querySelector('.log-text img')).toBeNull();

    await userEvent.type(screen.getByRole('textbox', { name: 'Minecraft 命令' }), 'list');
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByText('命令已发送至 stdin')).toBeVisible();
    expect(screen.getByText('后端仅确认提交，未提供命令执行输出。')).toBeVisible();
    expect(screen.queryByText('RCON 已执行')).not.toBeInTheDocument();
  });

  it('实例目录快照过期时禁用命令，避免按旧 readiness 写入', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><ConsolePage server={server} feature={{ implemented: true, phase: 2 }} stale /></QueryClientProvider>);

    expect(screen.getByRole('textbox', { name: 'Minecraft 命令' })).toBeDisabled();
    expect(screen.getByText(/实例状态已超过 15 秒未刷新/)).toBeVisible();
  });
});
