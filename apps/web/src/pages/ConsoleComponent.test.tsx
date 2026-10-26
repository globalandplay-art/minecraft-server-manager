import type { ServersResponse } from '@mcsm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authState } from '../authState';
beforeEach(() => authState.legacy(authState.checking()));
import { api } from '../api';
import { ConsolePage } from './Console';
import { i18n } from '../i18n';

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
  it('switches language without losing drafts, rewriting raw output or reconnecting', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const command = vi.spyOn(api, 'command').mockResolvedValue({ data: { status: 'executed', transport: 'rcon', output: '原始 RCON / RAW <output>' }, meta: { requestId: 'locale', generatedAt: new Date().toISOString(), mode: 'local' } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><ConsolePage server={server} feature={{ implemented: true, phase: 2 }} /></QueryClientProvider>);
    const socket = MockWebSocket.latest;
    act(() => {
      socket.message({ type: 'hello', streamId: 'locale', latestSequence: 1 });
      socket.message({ type: 'snapshot', sequence: 1, status: server.status, logs: [{ id: 'raw', cursor: 'raw', timestamp: null, level: 'error', text: '原始日志 <log> / RAW', source: 'latest.log' }] });
    });
    const input = screen.getByRole('textbox', { name: 'Minecraft 命令' });
    fireEvent.change(input, { target: { value: 'say 未保存 draft' } });
    await act(async () => { await i18n.changeLanguage('en'); });
    expect(screen.getByRole('textbox', { name: 'Minecraft command' })).toBe(input);
    expect(input).toHaveValue('say 未保存 draft');
    expect(MockWebSocket.latest).toBe(socket);
    expect(screen.getByText('原始日志 <log> / RAW')).toBeVisible();
    expect(command).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('原始 RCON / RAW <output>')).toBeVisible();
    await act(async () => { await i18n.changeLanguage('ja'); });
    expect(screen.getByText('RCON 実行済み')).toBeVisible();
    expect(screen.getByText('原始 RCON / RAW <output>')).toBeVisible();
    expect(command).toHaveBeenCalledExactlyOnceWith(server.server.id, 'say 未保存 draft');
    expect(MockWebSocket.latest).toBe(socket);
  });

  it('updates an existing validation message without clearing or sending the invalid command', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const send = vi.spyOn(api, 'command');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ConsolePage server={server} feature={{ implemented: true, phase: 2 }} /></QueryClientProvider>);
    const input = screen.getByRole('textbox', { name: 'Minecraft 命令' });
    fireEvent.change(input, { target: { value: 'x'.repeat(1025) } });
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(screen.getByRole('alert')).toHaveTextContent('命令不能超过 1024');
    await act(async () => { await i18n.changeLanguage('en'); });
    expect(screen.getByRole('alert')).toHaveTextContent('Commands cannot exceed 1024 UTF-8 bytes.');
    expect(input).toHaveValue('x'.repeat(1025)); expect(send).not.toHaveBeenCalled();
  });
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
