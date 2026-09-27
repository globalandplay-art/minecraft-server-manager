import type { OverviewResponse } from '@mcsm/contracts';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { InvalidSelection } from './App';
import { Dashboard } from './pages/Dashboard';

const unavailable = {
  status: 'unavailable' as const,
  value: null,
  source: null,
  sampledAt: null,
  reason: 'not-collected',
};

const blocked = { allowed: false as const, reason: 'mock-mode' };
const overview: OverviewResponse['data'] = {
  summary: {
    server: {
      id: 'paper-demo',
      name: 'Survival · 示例',
      type: 'paper',
      minecraftVersion: '1.21.1',
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
  },
  metrics: {
    players: { status: 'available', value: { online: 4, max: 20 }, source: 'mock', sampledAt: '2026-09-27T00:00:00.000Z' },
    tps: unavailable,
    mspt: unavailable,
    cpu: { status: 'available', value: 12, source: 'mock', sampledAt: '2026-09-27T00:00:00.000Z' },
    ram: { status: 'available', value: { rssBytes: 1_932_735_283 }, source: 'mock', sampledAt: '2026-09-27T00:00:00.000Z' },
    disk: { status: 'available', value: { totalBytes: 500_000_000_000, freeBytes: 320_000_000_000, usedBytes: 180_000_000_000 }, source: 'mock', sampledAt: '2026-09-27T00:00:00.000Z' },
    uptime: { status: 'available', value: 7_200, source: 'mock', sampledAt: '2026-09-27T00:00:00.000Z' },
  },
  activity: [],
  alerts: [],
};

describe('Dashboard 边界状态', () => {
  it('无效 server query 不会悄悄切换到其他实例', () => {
    render(<MemoryRouter><InvalidSelection /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: '实例不存在 / 已移除' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回 Servers' })).toHaveAttribute('href', '/servers');
  });

  it('快照过期时 Hero 与指标状态同时降级，并保留上次状态', () => {
    render(<Dashboard overview={overview} generatedAt="2026-09-27T00:00:00.000Z" mode="mock" forceStale refreshing={false} refresh={() => undefined} />);

    expect(screen.getAllByText('未知').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('旧数据')).toHaveLength(8);
    expect(screen.getByText(/上次状态：运行中/)).toBeInTheDocument();
    expect(screen.getByText(/不能作为实时状态判断/)).toBeInTheDocument();
  });
});
