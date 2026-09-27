import type { HealthResponse, ServersResponse } from '@mcsm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const blocked = { allowed: false as const, reason: 'mock-mode' };
const server: ServersResponse['data']['items'][number] = {
  server: {
    id: 'paper-demo', name: 'Survival · 示例', type: 'paper', minecraftVersion: '1.21.1',
    java: { runtimeVersion: '21.0.4', requiredMajor: 21 },
    detection: { confidence: 'high', evidence: ['mock-fixture'], warnings: [] },
  },
  capabilities: { mods: false, plugins: true, rcon: true, console: true, backup: true, worlds: true, properties: true },
  status: { state: 'running', ownership: 'none', source: 'mock', observedAt: '2026-09-27T00:00:00.000Z', activeOperationId: null, recoveryRequired: false },
  readiness: {
    start: blocked, stop: blocked, restart: blocked, commands: blocked, backup: blocked,
    restore: blocked, worldChanges: blocked, addonChanges: blocked, propertiesChanges: blocked,
    commandTransport: 'unavailable',
  },
};

const features: HealthResponse['data']['features'] = {
  dashboard: { implemented: true, phase: 1 },
  servers: { implemented: true, phase: 1 },
  lifecycle: { implemented: false, phase: 2 },
  console: { implemented: false, phase: 2 },
  worlds: { implemented: false, phase: 3 },
  backups: { implemented: false, phase: 3 },
  players: { implemented: false, phase: 4 },
  properties: { implemented: false, phase: 4 },
  addons: { implemented: false, phase: 5 },
  performance: { implemented: false, phase: 6 },
  crashAnalysis: { implemented: false, phase: 6 },
  remoteAccess: { implemented: false, phase: 7 },
};

const timestamp = '2026-09-27T00:00:00.000Z';
const health: HealthResponse = {
  data: { status: 'ok', apiVersion: '1', features },
  meta: { requestId: 'req-health', generatedAt: timestamp, mode: 'mock' },
};
const servers: ServersResponse = {
  data: { items: [server] },
  meta: { requestId: 'req-servers', generatedAt: timestamp, mode: 'mock' },
};

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('服务器列表查询时效', () => {
  it('缓存后的刷新持续 pending 超过 15 秒会降级，成功响应后立即恢复', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(timestamp));
    let serversRequestCount = 0;
    let resolvePending!: (response: Response) => void;

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/health')) return Promise.resolve(jsonResponse(health));
      if (url.endsWith('/servers')) {
        serversRequestCount += 1;
        if (serversRequestCount === 1) return Promise.resolve(jsonResponse(servers));
        return new Promise<Response>((resolve) => { resolvePending = resolve; });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    }));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/servers']}><App /></MemoryRouter>
      </QueryClientProvider>,
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByText('运行中')).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(15_999); });
    expect(screen.getByText(/状态已降级为未知/)).toBeInTheDocument();
    expect(screen.getByText('未知')).toBeInTheDocument();

    await act(async () => {
      resolvePending(jsonResponse(servers));
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.queryByText(/状态已降级为未知/)).not.toBeInTheDocument();
    expect(screen.getByText('运行中')).toBeInTheDocument();
    client.clear();
  });
});
