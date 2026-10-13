import type { TailscaleControlResponse, AccessOperationResponse } from '@mcsm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { TailscaleControls } from './TailscaleControls';
const revision = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const response: TailscaleControlResponse = { data: { state: 'ready', revision, observedEnabled: false, recoveryOperationId: null,
  enableAllowed: true, disableAllowed: false, connectionUrl: null, remoteVerifiedAt: null, lastErrorCode: null },
meta: { mode: 'mock', requestId: 'test', generatedAt: '2026-10-13T00:00:00Z' } };
const operation: AccessOperationResponse = { data: { schemaVersion: 1, id, resource: { kind: 'manager-access', provider: 'tailscale' },
  action: 'enable', state: 'succeeded', errorCode: null, createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z' }, meta: response.meta };
function show() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><TailscaleControls /></QueryClientProvider>); }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('requires explicit preview and confirmation, then sends one fixed request and key', async () => {
  vi.spyOn(api, 'tailscaleControl').mockResolvedValue(response);
  let finish!: (value: AccessOperationResponse) => void;
  const mutate = vi.spyOn(api, 'tailscaleMutate').mockImplementation(() => new Promise((resolve) => { finish = resolve; })); show();
  await userEvent.click(await screen.findByRole('button', { name: '启用私有访问' }));
  expect(mutate).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: '确认执行' })).toBeDisabled();
  await userEvent.click(screen.getByRole('checkbox')); await userEvent.click(screen.getByRole('button', { name: '确认执行' }));
  expect(screen.getByRole('button', { name: '确认执行' })).toBeDisabled(); expect(mutate).toHaveBeenCalledTimes(1);
  expect(mutate.mock.calls[0]?.slice(0, 2)).toEqual(['enable', { revision, confirm: true }]);
  finish(operation); expect(await screen.findByText(/succeeded/)).toBeInTheDocument();
});
it('never automatically retries a lost response; explicit replay preserves the exact key and body', async () => {
  vi.spyOn(api, 'tailscaleControl').mockResolvedValue(response);
  const mutate = vi.spyOn(api, 'tailscaleMutate').mockRejectedValueOnce(new Error('connection lost')).mockResolvedValue(operation); show();
  await userEvent.click(await screen.findByRole('button', { name: '启用私有访问' }));
  await userEvent.click(screen.getByRole('checkbox')); await userEvent.click(screen.getByRole('button', { name: '确认执行' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('操作结果尚需确认'); expect(mutate).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: '按原请求确认结果' }));
  expect(await screen.findByText(/succeeded/)).toBeInTheDocument(); expect(mutate.mock.calls[1]).toEqual(mutate.mock.calls[0]);
});
it('recovery uses evidence endpoint only and never calls enable/disable', async () => {
  vi.spyOn(api, 'tailscaleControl').mockResolvedValue({ ...response, data: { ...response.data, state: 'recovery_required',
    enableAllowed: false, recoveryOperationId: id, observedEnabled: null } });
  const recover = vi.spyOn(api, 'accessRecover').mockResolvedValue(operation); const mutate = vi.spyOn(api, 'tailscaleMutate'); show();
  await userEvent.click(await screen.findByRole('button', { name: /显式核验恢复/ }));
  expect(await screen.findByText(/succeeded/)).toBeInTheDocument(); expect(recover).toHaveBeenCalledWith(id, { revision, confirm: true });
  expect(mutate).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: '启用私有访问' })).not.toBeInTheDocument();
});

it.each(['succeeded', 'failed', 'recovery_required', 'mismatched'] as const)('lost reply recovery %s preserves or clears only its matching terminal request', async (outcome) => {
  const pending = { ...response, data: { ...response.data, state: 'recovery_required' as const,
    enableAllowed: false, recoveryOperationId: id, observedEnabled: null } };
  let current = response;
  vi.spyOn(api, 'tailscaleControl').mockImplementation(async () => current);
  const mutate = vi.spyOn(api, 'tailscaleMutate').mockImplementation(async () => { current = pending; throw new Error('lost reply'); });
  const recover = vi.spyOn(api, 'accessRecover').mockImplementation(async () => {
    current = response;
    return { ...operation, data: { ...operation.data, id: outcome === 'mismatched' ? revision : id,
      state: outcome === 'mismatched' ? 'succeeded' : outcome } };
  });
  show();
  await userEvent.click(await screen.findByRole('button', { name: '启用私有访问' }));
  await userEvent.click(screen.getByRole('checkbox')); await userEvent.click(screen.getByRole('button', { name: '确认执行' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('操作结果尚需确认');
  await userEvent.click(screen.getByRole('button', { name: '查询控制状态' }));
  await userEvent.click(await screen.findByRole('button', { name: /显式核验恢复/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: '查询控制状态' })).toBeEnabled());
  const terminal = outcome === 'succeeded' || outcome === 'failed';
  if (terminal) {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '按原请求确认结果' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启用私有访问' })).toBeEnabled();
  } else {
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '按原请求确认结果' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启用私有访问' })).toBeDisabled();
  }
  expect(recover).toHaveBeenCalledTimes(1); expect(mutate).toHaveBeenCalledTimes(1);
});
