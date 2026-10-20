import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { Metrics, ServerStatus } from '@mcsm/contracts';
import { PerformanceNotices } from './PerformanceNotices';
afterEach(cleanup);
const missing = { status: 'unavailable', value: null, source: null, sampledAt: null, reason: 'not-collected' } as const;
const metrics: Metrics = { cpu: missing, ram: missing, disk: missing, players: missing, uptime: missing, tps: missing, mspt: missing };
const status: ServerStatus = { state: 'crashed', ownership: 'none', activeOperationId: null, recoveryRequired: true,
  source: 'process', observedAt: '2026-10-20T00:00:00Z' };
it('labels abnormal exit and recovery as historical observations without inventing a cause', () => {
  render(<PerformanceNotices status={status} metrics={metrics} readFailed={false} />);
  expect(screen.getAllByRole('alert')).toHaveLength(2);
  expect(screen.getByText(/不代表当前进程的实时确认/)).toBeInTheDocument();
  expect(screen.getByText(/不能仅凭此状态确定崩溃原因/)).toBeInTheDocument();
  expect(screen.getByText(/不会自动恢复或重启/)).toBeInTheDocument();
});
it('does not call missing data healthy or infer TPS from CPU', () => {
  render(<PerformanceNotices metrics={metrics} readFailed={false} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText(/N\/A 不等于零或健康/)).toBeInTheDocument();
  expect(screen.getByText(/不会根据 CPU、玩家数或日志猜测/)).toBeInTheDocument();
});
it('distinguishes stale readings and failed reads from live threshold alerts', () => {
  render(<PerformanceNotices status={{ ...status, state: 'running', recoveryRequired: false }} readFailed
    metrics={{ ...metrics, cpu: { status: 'stale', value: 100, source: 'process', sampledAt: status.observedAt, reason: 'probe-unavailable' } }} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText(/旧指标：CPU/)).toBeInTheDocument();
  expect(screen.getByText(/本次指标读取失败/)).toBeInTheDocument();
});
it('makes unknown and absent evidence explicit without generating values', () => {
  const view = render(<PerformanceNotices readFailed={false} />);
  expect(screen.getByText(/尚无指标样本/)).toBeInTheDocument();
  view.rerender(<PerformanceNotices status={{ ...status, state: 'unknown', recoveryRequired: false }} readFailed={false} />);
  expect(screen.getByText(/运行状态未知/)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
