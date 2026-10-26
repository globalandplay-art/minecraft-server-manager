import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api, ApiClientError } from '../api';
import { authState } from '../authState';
import { Authentication } from '../components/Authentication';
import { SettingsPage } from './PhasePage';

afterEach(() => { cleanup(); vi.restoreAllMocks(); authState.checking(); });
it('keeps demo settings accessible without a password or remote API requests', async () => {
  const status = vi.spyOn(api, 'authStatus').mockResolvedValue({ data: { configured: false, authenticationRequired: false, auditReady: false } });
  const session = vi.spyOn(api, 'authSession');
  const remote = vi.spyOn(api, 'tailscaleStatus').mockRejectedValue(new ApiClientError('Authentication required', 'http', 401, 'AUTH_REQUIRED'));
  const control = vi.spyOn(api, 'tailscaleControl').mockRejectedValue(new ApiClientError('Authentication required', 'http', 401, 'AUTH_REQUIRED'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><Authentication><SettingsPage /></Authentication></QueryClientProvider>);
  expect(await screen.findByRole('heading', { name: '设置' })).toBeVisible();
  expect(screen.getByRole('heading', { name: '外观设置' })).toBeVisible();
  expect(status).toHaveBeenCalledOnce(); expect(session).not.toHaveBeenCalled(); expect(remote).not.toHaveBeenCalled(); expect(control).not.toHaveBeenCalled();
  expect(authState.snapshot().phase).toBe('legacy');
  expect(screen.queryByRole('heading', { name: '登录管理器' })).not.toBeInTheDocument();
  client.clear();
});
