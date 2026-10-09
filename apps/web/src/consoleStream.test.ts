import type { LogEntry, ServerStatus, WsMessage } from '@mcsm/contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { api } from './api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authState } from './authState';
beforeEach(() => authState.legacy(authState.checking()));
import { applyWsMessage, emptyConsoleStream, parseWsMessage, useConsoleStream } from './consoleStream';

const status: ServerStatus = {
  state: 'running', ownership: 'managed', source: 'process', observedAt: '2026-09-27T00:00:00.000Z',
  activeOperationId: null, recoveryRequired: false,
};

function log(index: number): LogEntry {
  return { id: `log-${index}`, cursor: `cursor-${index}`, timestamp: null, level: 'info', text: `line ${index}`, source: 'latest.log' };
}

describe('Console WS 流状态', () => {
  it('按 sequence 去重、限制 2000 行，并在新 stream 上清空旧数据', () => {
    let state = applyWsMessage(emptyConsoleStream, { type: 'hello', streamId: 'stream-a', latestSequence: 0 });
    state = applyWsMessage(state, { type: 'snapshot', sequence: 1, status, logs: Array.from({ length: 2_000 }, (_, index) => log(index)) });
    state = applyWsMessage(state, { type: 'log', sequence: 2, entry: log(2_000) });
    state = applyWsMessage(state, { type: 'log', sequence: 2, entry: log(2_001) });

    expect(state.logs).toHaveLength(2_000);
    expect(state.logs[0]?.id).toBe('log-1');
    expect(state.logs.at(-1)?.id).toBe('log-2000');

    state = applyWsMessage(state, { type: 'hello', streamId: 'stream-b', latestSequence: 0 });
    expect(state.logs).toHaveLength(0);
    expect(state.lastSequence).toBe(0);
    expect(state.gap).toMatch(/日志流已更换/);
  });

  it('gap 后接受同 sequence 的完整 snapshot，并保留无法补发的公告', () => {
    let state = applyWsMessage(emptyConsoleStream, { type: 'hello', streamId: 'stream-a', latestSequence: 4 });
    state = applyWsMessage(state, { type: 'gap', sequence: 5, reason: 'replay-window-exceeded' });
    state = applyWsMessage(state, { type: 'snapshot', sequence: 5, status, logs: [log(5)] });

    expect(state.gap).toBe('replay-window-exceeded');
    expect(state.logs).toEqual([log(5)]);
    expect(state.lastSequence).toBe(5);
  });

  it('初始 sequence 为 0 时仍接受同 sequence 的 gap 公告', () => {
    let state = applyWsMessage(emptyConsoleStream, { type: 'hello', streamId: 'stream-a', latestSequence: 0 });
    state = applyWsMessage(state, { type: 'gap', sequence: 0, reason: 'initial-snapshot-truncated' });

    expect(state.gap).toBe('initial-snapshot-truncated');
    expect(state.lastSequence).toBe(0);
  });

  it('拒绝不符合共享 schema 的网络消息', () => {
    expect(parseWsMessage({ type: 'log', sequence: 1, entry: { text: '<script>' } })).toBeNull();
    expect(parseWsMessage({ type: 'hello', streamId: 'safe-stream', latestSequence: 1 } satisfies WsMessage)).not.toBeNull();
  });
});

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readonly listeners = new Map<string, Array<(event: { data?: unknown; code?: number }) => void>>();

  constructor(readonly url: string | URL, readonly protocols?: string[]) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data?: unknown; code?: number }) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close() {}

  emit(type: string, event: { data?: unknown; code?: number } = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

afterEach(() => {
  MockWebSocket.instances = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useConsoleStream 实例隔离', () => {
  it('authenticated socket uses one-use protocol ticket, never a URL secret;1008 clears state', async () => {
    authState.authenticated({ data: { authenticated: true, csrfToken: 'a'.repeat(43), expiresAt: '2026-10-09T01:30:00.000Z', recentReauthentication: true },
      meta: { mode: 'mock', generatedAt: '2026-10-09T01:00:00.000Z', requestId: 'test' } }, authState.snapshot().generation);
    const ticket = 'b'.repeat(43);
    const issue = vi.spyOn(api, 'authWsTicket').mockResolvedValue({ data: { ticket, expiresAt: '2026-10-09T01:00:30.000Z' }, meta: { mode: 'mock', generatedAt: '2026-10-09T01:00:00.000Z', requestId: 'test' } });
    vi.stubGlobal('WebSocket', MockWebSocket);
    const { result } = renderHook(() => useConsoleStream('server-one', true));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0]!;
    expect(socket.protocols).toEqual(['mcsm.events.v1', `ticket.${ticket}`]);
    expect(String(socket.url)).not.toContain(ticket);
    act(() => socket.emit('close', { code: 1008 }));
    expect(authState.snapshot().phase).toBe('signed-out');
    expect(result.current.connection).toBe('idle'); expect(result.current.retryInMs).toBeNull();
    expect(issue).toHaveBeenCalledTimes(1);
  });
  it('late ticket completion after logout cannot construct a socket', async () => {
    authState.authenticated({ data: { authenticated: true, csrfToken: 'a'.repeat(43), expiresAt: '2026-10-09T01:30:00.000Z', recentReauthentication: true },
      meta: { mode: 'mock', generatedAt: '2026-10-09T01:00:00.000Z', requestId: 'test' } }, authState.snapshot().generation);
    let finish!: (value: Awaited<ReturnType<typeof api.authWsTicket>>) => void;
    vi.spyOn(api, 'authWsTicket').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal('WebSocket', MockWebSocket); renderHook(() => useConsoleStream('server-one', true));
    act(() => authState.signedOut());
    await act(async () => finish({ data: { ticket: 'b'.repeat(43), expiresAt: '2026-10-09T01:00:30.000Z' }, meta: { mode: 'mock', generatedAt: '2026-10-09T01:00:00.000Z', requestId: 'test' } }));
    expect(MockWebSocket.instances).toHaveLength(0);
  });
  it('切换实例不携带旧 stream query，并忽略旧 socket 的晚到消息', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const { result, rerender } = renderHook(
      ({ serverId }) => useConsoleStream(serverId, true),
      { initialProps: { serverId: 'server-one' } },
    );
    const first = MockWebSocket.instances[0]!;
    act(() => {
      first.emit('message', { data: JSON.stringify({ type: 'hello', streamId: 'stream-one', latestSequence: 1 }) });
      first.emit('message', { data: JSON.stringify({ type: 'snapshot', sequence: 1, status, logs: [log(1)] }) });
    });
    expect(result.current.stream.logs).toHaveLength(1);

    rerender({ serverId: 'server-two' });
    const second = MockWebSocket.instances[1]!;
    expect(String(second.url)).not.toContain('streamId=stream-one');
    expect(result.current.stream.logs).toHaveLength(0);

    act(() => {
      first.emit('message', { data: JSON.stringify({ type: 'log', sequence: 2, entry: log(2) }) });
    });
    expect(result.current.stream.logs).toHaveLength(0);
  });
});
