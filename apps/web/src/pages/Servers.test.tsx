import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Servers } from './Servers';
import { api } from '../api';
import { i18n } from '../i18n';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
  it('retranslates a completed removal notice after its child has unmounted', async () => {
    const meta = { requestId: 'l1-test', generatedAt: new Date().toISOString(), mode: 'local' as const };
    vi.spyOn(api, 'registrationCatalog').mockResolvedValue({ data: { profiles: [], pending: [] }, meta });
    const remove = vi.spyOn(api, 'registrationRemove').mockResolvedValue({ data: { id: 'paper-demo', removed: true, filesPreserved: true, unloaded: true, restartRequired: false, unloadErrorCode: null }, meta });
    function Harness() {
      const [items, setItems] = useState([{ ...runningServer, status: { ...runningServer.status, state: 'stopped' as const } }]);
      return <Servers items={items} mode="local" onRemoved={() => setItems([])} />;
    }
    render(<MemoryRouter><Harness /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '移除服务器' }));
    fireEvent.click(screen.getByRole('button', { name: '确认移除' }));
    await waitFor(() => expect(screen.getByText('已移除 Survival · 示例 的 LT 登记，服务端文件完整保留。')).toBeVisible());
    await act(async () => { await i18n.changeLanguage('en'); });
    expect(screen.getByText('LT registration for Survival · 示例 was removed. All server files were retained.')).toBeVisible();
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it('空列表只显示接入说明，不伪造运行中的服务器', () => {
    render(<MemoryRouter><Servers items={[]} mode="mock" /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: '尚未接入服务器实例' })).toBeInTheDocument();
    expect(screen.getByText(/当前为 Mock 演示模式/)).toBeInTheDocument();
    expect(screen.getByText("$env:MCSM_MODE='local'; npm.cmd run dev")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '移除服务器' })).not.toBeInTheDocument();
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
