import type { AuthSessionResponse } from '@mcsm/contracts';

type AuthPhase = 'checking' | 'legacy' | 'signed-out' | 'authenticated' | 'unavailable';
export type AuthSnapshot = Readonly<{ phase: AuthPhase; generation: number; version: number; recentReauthentication: boolean; notice: string | null }>;
/** Bearer cookies remain browser-managed. Only CSRF and a monotonic deadline live in this instance. */
class AuthenticationState {
  #snapshot: AuthSnapshot = Object.freeze({ phase: 'checking', generation: 0, version: 0, recentReauthentication: false, notice: null });
  #listeners = new Set<() => void>();
  #csrf: string | undefined;
  #deadline = 0;
  #generatedAt = 0;
  #requests = new AbortController();
  snapshot = () => this.#snapshot;
  subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
  signal(): AbortSignal { return this.#requests.signal; }
  assert(generation: number): void {
    if (generation !== this.#snapshot.generation) throw new DOMException('Authentication changed', 'AbortError');
  }
  #publish(phase: AuthPhase, rotate: boolean, notice: string | null = null, recent = false): void {
    if (rotate) { this.#requests.abort(); this.#requests = new AbortController(); }
    this.#snapshot = Object.freeze({ phase, generation: this.#snapshot.generation + Number(rotate), version: this.#snapshot.version + 1, recentReauthentication: recent, notice });
    for (const listener of this.#listeners) listener();
  }
  checking(): number { this.#csrf = undefined; this.#deadline = 0; this.#generatedAt = 0; this.#publish('checking', true); return this.#snapshot.generation; }
  legacy(generation: number): void { this.assert(generation); this.#csrf = undefined; this.#publish('legacy', true); }
  signedOut(generation = this.#snapshot.generation, notice: string | null = null): void {
    if (generation !== this.#snapshot.generation) return;
    this.#csrf = undefined; this.#deadline = 0; this.#generatedAt = 0;
    this.#publish('signed-out', this.#snapshot.phase !== 'signed-out', notice);
  }
  unavailable(generation: number, notice: string): void {
    this.assert(generation); this.#csrf = undefined; this.#publish('unavailable', true, notice);
  }
  authenticated(response: AuthSessionResponse, generation: number): void {
    this.assert(generation);
    const generatedAt = Date.parse(response.meta.generatedAt); const expiresAt = Date.parse(response.data.expiresAt);
    const remaining = expiresAt - generatedAt;
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 8 * 60 * 60_000) throw new Error('Invalid session deadline');
    if (this.#snapshot.phase === 'authenticated' && generatedAt < this.#generatedAt) {
      // Ignore out-of-order/wall-clock-regressed data, but re-arm the local deadline check.
      this.#publish('authenticated', false, this.#snapshot.notice, this.#snapshot.recentReauthentication);
      return;
    }
    const rotate = this.#snapshot.phase !== 'authenticated' || this.#csrf !== response.data.csrfToken;
    this.#csrf = response.data.csrfToken; this.#deadline = performance.now() + remaining; this.#generatedAt = generatedAt;
    this.#publish('authenticated', rotate, null, response.data.recentReauthentication);
  }
  notice(generation: number, notice: string): void {
    if (generation === this.#snapshot.generation) this.#publish(this.#snapshot.phase, false, notice, this.#snapshot.recentReauthentication);
  }
  remaining(): number { return Math.max(0, this.#deadline - performance.now()); }
  headers(method: string): Record<string, string> {
    return method !== 'GET' && method !== 'HEAD' && this.#csrf ? { 'X-CSRF-Token': this.#csrf } : {};
  }
}
export const authState = new AuthenticationState();

/** Every fetch uses the same generation, cookie and CSRF boundary, including raw uploads. */
export async function authenticatedFetch(url: string, init: RequestInit): Promise<Response> {
  const generation = authState.snapshot().generation;
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(authState.headers(init.method ?? 'GET'))) headers.set(name, value);
  const response = await fetch(url, { ...init, credentials: 'same-origin', headers,
    signal: init.signal ? AbortSignal.any([init.signal, authState.signal()]) : authState.signal() });
  authState.assert(generation);
  // Invalidate before reading an untrusted/empty response body; stale401 never affects a new login.
  if (response.status === 401) authState.signedOut(generation, '会话已失效，请重新登录。');
  return response;
}
