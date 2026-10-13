import type { TailscaleStatusResponse } from '@mcsm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { TailscaleAccess } from './TailscaleAccess';

const response: TailscaleStatusResponse = { data: { state: 'disabled', desiredEnabled: false, observedEnabled: null,
  observedServeMode: 'unknown', managementMode: 'external', dependency: 'unknown', tailnet: 'unknown', https: 'unknown',
  target: 'unconfigured', lastCheckedAt: null, lastErrorCode: null, connectionUrl: null, remoteVerifiedAt: null,
  capabilities: { preflight: true, enable: false, disable: false } }, meta: { mode: 'mock', requestId: 'test', generatedAt: '2026-10-13T00:00:00Z' } };
function show() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><TailscaleAccess /></QueryClientProvider>); }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { vi.spyOn(api, 'tailscaleControl').mockResolvedValue({ data: { state: 'unavailable', revision: null,
  observedEnabled: null, recoveryOperationId: null, enableAllowed: false, disableAllowed: false, connectionUrl: null,
  remoteVerifiedAt: null, lastErrorCode: 'TAILSCALE_ATOMIC_CONTROL_UNAVAILABLE' }, meta: response.meta }); });
it('displays off without running a preflight or inventing URL', async () => {
  vi.spyOn(api, 'tailscaleStatus').mockResolvedValue(response); const probe = vi.spyOn(api, 'tailscalePreflight'); show();
  expect(await screen.findByText('disabled')).toBeInTheDocument(); expect(probe).not.toHaveBeenCalled();
  expect(screen.getByText('未验证；没有可连接 URL')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Enable$/ })).not.toBeInTheDocument();
});
it('keeps pending distinct from success and prevents duplicate preflight', async () => {
  vi.spyOn(api, 'tailscaleStatus').mockResolvedValue(response);
  let finish!: (response: TailscaleStatusResponse) => void;
  const probe = vi.spyOn(api, 'tailscalePreflight').mockImplementation(() => new Promise((resolve) => { finish = resolve; })); show();
  const button = await screen.findByRole('button', { name: /只读预检/ });
  await screen.findByText('disabled'); await userEvent.click(button);
  expect(await screen.findByText('checking')).toBeInTheDocument(); expect(button).toBeDisabled(); expect(probe).toHaveBeenCalledTimes(1);
  finish({ ...response, data: { ...response.data, state: 'conflict', lastErrorCode: 'TAILSCALE_EXTERNAL_CONFIG' } });
  expect(await screen.findByText('TAILSCALE_EXTERNAL_CONFIG')).toBeInTheDocument(); expect(screen.getByText('关闭')).toBeInTheDocument();
});
it('shows authentication/read failure without offering remote actions', async () => {
  vi.spyOn(api, 'tailscaleStatus').mockRejectedValue(new Error('read failed')); show();
  expect(await screen.findByRole('alert')).toBeInTheDocument(); expect(screen.getByRole('button', { name: /只读预检/ })).toBeDisabled();
});
