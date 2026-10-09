import type { AuthSessionResponse } from '@mcsm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiClientError } from '../api';
import { authState } from '../authState';
import { Authentication, AuthenticationControls } from './Authentication';

const session: AuthSessionResponse = { data: { authenticated: true, csrfToken: 'a'.repeat(43), expiresAt: '2026-10-09T01:30:00.000Z', recentReauthentication: true },
  meta: { mode: 'mock', generatedAt: '2026-10-09T01:00:00.000Z', requestId: 'test' } };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Authentication><AuthenticationControls /><div>PRIVATE MANAGEMENT VIEW</div></Authentication></QueryClientProvider>);
  return client;
}
beforeEach(() => authState.checking());
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('authentication root', () => {
  it('an older poll response cannot disable the monotonic expiry gate during later network failure', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    vi.spyOn(api, 'authStatus').mockResolvedValue({ data: { configured: true, authenticationRequired: true, auditReady: true } });
    const older = { ...session, meta: { ...session.meta, generatedAt: '2026-10-09T00:59:00.000Z' },
      data: { ...session.data, expiresAt: '2026-10-09T01:29:00.000Z' } };
    const read = vi.spyOn(api, 'authSession').mockResolvedValueOnce(session).mockResolvedValueOnce(older).mockRejectedValue(new Error('offline'));
    let client!: QueryClient;
    await act(async () => { client = mount(); });
    expect(screen.getByText('PRIVATE MANAGEMENT VIEW')).toBeInTheDocument();
    client.setQueryData(['secret'], 'private');
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(29 * 60_000));
    expect(authState.snapshot().phase).toBe('signed-out');
    expect(screen.queryByText('PRIVATE MANAGEMENT VIEW')).not.toBeInTheDocument();
    expect(client.getQueryData(['secret'])).toBeUndefined();
  });
  it('does not mount management views while status is unknown or failed', async () => {
    vi.spyOn(api, 'authStatus').mockRejectedValue(new Error('unavailable'));
    mount(); expect(screen.queryByText('PRIVATE MANAGEMENT VIEW')).not.toBeInTheDocument();
    await screen.findByText('暂时无法登录');
    expect(authState.snapshot().phase).toBe('unavailable');
  });
  it('only explicit legacy status mounts management without a session', async () => {
    vi.spyOn(api, 'authStatus').mockResolvedValue({ data: { configured: false, authenticationRequired: false, auditReady: false } });
    const read = vi.spyOn(api, 'authSession'); mount();
    await screen.findByText('PRIVATE MANAGEMENT VIEW'); expect(read).not.toHaveBeenCalled();
  });
  it('requires login, keeps passwords out of query cache, and clears sensitive cache on401', async () => {
    vi.spyOn(api, 'authStatus').mockResolvedValue({ data: { configured: true, authenticationRequired: true, auditReady: true } });
    vi.spyOn(api, 'authSession').mockRejectedValue(new ApiClientError('login required', 'http', 401));
    vi.spyOn(api, 'authLogin').mockResolvedValue(session);
    const client = mount(); await screen.findByRole('heading', { name: '登录管理器' });
    const user = userEvent.setup(); await user.type(screen.getByLabelText('账号'), 'admin');
    await user.type(screen.getByLabelText('密码'), 'private-password');
    await user.click(screen.getByRole('button', { name: '登录' }));
    await screen.findByText('PRIVATE MANAGEMENT VIEW');
    expect(client.getMutationCache().getAll()).toHaveLength(0);
    client.setQueryData(['secret'], { confidential: 'old data' });
    act(() => authState.signedOut(authState.snapshot().generation, 'expired'));
    expect(screen.queryByText('PRIVATE MANAGEMENT VIEW')).not.toBeInTheDocument();
    expect(client.getQueryData(['secret'])).toBeUndefined();
  });
  it('logout clears data immediately and never falsely confirms a failed server logout', async () => {
    vi.spyOn(api, 'authStatus').mockResolvedValue({ data: { configured: true, authenticationRequired: true, auditReady: true } });
    vi.spyOn(api, 'authSession').mockResolvedValue(session);
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const client = mount(); await screen.findByText('PRIVATE MANAGEMENT VIEW');
    client.setQueryData(['secret'], 'sensitive');
    await userEvent.click(screen.getByRole('button', { name: '退出登录' }));
    expect(screen.queryByText('PRIVATE MANAGEMENT VIEW')).not.toBeInTheDocument();
    expect(client.getQueryData(['secret'])).toBeUndefined();
    await act(async () => finish(new Response('{}', { status: 503 })));
    await waitFor(() => expect(authState.snapshot().phase).toBe('signed-out'));
    expect(screen.getByRole('alert')).toHaveTextContent('服务端退出尚未确认');
  });
});
