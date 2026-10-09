import type { AuthSessionResponse } from '@mcsm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetch, authState } from './authState';
import { api } from './api';

function session(token = 'a'.repeat(43)): AuthSessionResponse {
  return { data: { authenticated: true, csrfToken: token, expiresAt: '2026-10-09T01:30:00.000Z', recentReauthentication: false },
    meta: { mode: 'mock', generatedAt: '2026-10-09T01:00:00.000Z', requestId: 'test' } };
}
beforeEach(() => authState.checking());
afterEach(() => vi.unstubAllGlobals());
describe('memory-only authentication boundary', () => {
  it('only unsafe requests receive CSRF; generation change aborts old requests', () => {
    const oldSignal = authState.signal();
    authState.authenticated(session(), authState.snapshot().generation);
    expect(oldSignal.aborted).toBe(true);
    expect(authState.headers('GET')).toEqual({});
    expect(authState.headers('POST')).toEqual({ 'X-CSRF-Token': 'a'.repeat(43) });
    authState.signedOut();
    expect(authState.headers('POST')).toEqual({});
  });
  it('invalidates current401 before reading any body', async () => {
    authState.authenticated(session(), authState.snapshot().generation);
    const json = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, json }));
    await authenticatedFetch('/api/v1/servers', { method: 'GET' });
    expect(authState.snapshot().phase).toBe('signed-out');
    expect(json).not.toHaveBeenCalled();
  });
  it('a late old-session401 cannot revoke a newer login', async () => {
    authState.authenticated(session(), authState.snapshot().generation);
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const request = authenticatedFetch('/api/v1/servers', { method: 'GET' });
    authState.authenticated(session('b'.repeat(43)), authState.snapshot().generation);
    finish(new Response('', { status: 401 }));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(authState.snapshot().phase).toBe('authenticated');
    expect(authState.headers('POST')['X-CSRF-Token']).toBe('b'.repeat(43));
  });
  it('uses same-origin cookies, overriding supplied CSRF with current memory state', async () => {
    authState.authenticated(session(), authState.snapshot().generation);
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await authenticatedFetch('/api/v1/action', { method: 'POST', headers: { 'X-CSRF-Token': 'forged' } });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.credentials).toBe('same-origin');
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('a'.repeat(43));
  });
  it('rejects stale success generation and invalid session deadlines', () => {
    const old = authState.snapshot().generation;
    authState.signedOut(old);
    expect(() => authState.assert(old)).toThrow('Authentication changed');
    const invalid = session(); invalid.data.expiresAt = invalid.meta.generatedAt;
    expect(() => authState.authenticated(invalid, authState.snapshot().generation)).toThrow('Invalid session deadline');
  });
  it('a success body parsed after a new login cannot return old credentials', async () => {
    authState.authenticated(session(), authState.snapshot().generation);
    let parsed!: (value: AuthSessionResponse) => void;
    let started!: () => void; const reading = new Promise<void>((resolve) => { started = resolve; });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, json: () => {
      started(); return new Promise<AuthSessionResponse>((resolve) => { parsed = resolve; });
    } }));
    const pending = api.authSession(); await reading;
    authState.authenticated(session('b'.repeat(43)), authState.snapshot().generation);
    parsed(session());
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(authState.headers('POST')['X-CSRF-Token']).toBe('b'.repeat(43));
  });
});
