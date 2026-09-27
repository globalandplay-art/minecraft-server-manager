import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Servers } from './Servers';

const blocked = { allowed: false as const, reason: 'mock-mode' };
const runningServer = {
  server: {
    id: 'paper-demo', name: 'Survival · 示例', type: 'paper' as const, minecraftVersion: '1.21.1',
    java: { runtimeVersion: '21.0.4', requiredMajor: 21 },
    detection: { confidence: 'high' as const, evidence: ['mock-fixture'], warnings: [] },
  },
  capabilities: { mods: false, plugins: true, rcon: true, console: true, backup: true, worlds: true, properties: true },
  status: { state: 'running' as const, ownership: 'none' as const, source: 'mock' as const, observedAt: '2026-09-27T00:00:00.000Z', activeOperationId: null, recoveryRequired: false },
  readiness: {
    start: blocked, stop: blocked, restart: blocked, commands: blocked, backup: blocked,
    restore: blocked, worldChanges: blocked, addonChanges: blocked, propertiesChanges: blocked,
    commandTransport: 'unavailable' as const,
  },
};

describe('Servers 只读页面', () => {
  it('空列表只显示接入说明，不伪造运行中的服务器', () => {
    render(<MemoryRouter><Servers items={[]} mode="mock" /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: '尚未接入服务器实例' })).toBeInTheDocument();
    expect(screen.getByText(/Phase 1 不提供实例注册/)).toBeInTheDocument();
    expect(screen.queryByText('运行中')).not.toBeInTheDocument();
  });

  it('断线过期时降级为未知，恢复后重新呈现当前状态', () => {
    const { rerender } = render(<MemoryRouter><Servers items={[runningServer]} mode="mock" stale /></MemoryRouter>);

    expect(screen.getByText('未知')).toBeInTheDocument();
    expect(screen.getByText(/上次状态/)).toBeInTheDocument();
    expect(screen.getByText(/状态已降级为未知/)).toBeInTheDocument();

    rerender(<MemoryRouter><Servers items={[runningServer]} mode="mock" stale={false} /></MemoryRouter>);
    expect(screen.queryByText(/状态已降级为未知/)).not.toBeInTheDocument();
    expect(screen.getByText('运行中')).toBeInTheDocument();
  });
});
