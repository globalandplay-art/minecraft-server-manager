import { useCallback, useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError, errorMessage } from '../api';
import { authState } from '../authState';
import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import { resources } from '../i18n/resources';
import { LanguageSelector } from './LanguageSelector';

// Only application-owned auth notices are localized; backend errors stay raw.
function notice(text: string | null) {
  if (!text) return text;
  const key = Object.entries(resources['zh-CN'].translation).find(([key, value]) => key.startsWith('auth.notice.') && value === text)?.[0];
  return key ? i18n.t(key) : text;
}

export function Authentication({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(authState.subscribe, authState.snapshot);
  const client = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inspect = useCallback(async () => {
    const generation = authState.checking(); setMessage(null);
    try {
      const status = await api.authStatus(); authState.assert(generation);
      if (!status.data.authenticationRequired) { authState.legacy(generation); return; }
      if (!status.data.auditReady) { authState.unavailable(generation, '登录服务暂不可用，请在本机检查配置。'); return; }
      const session = await api.authSession(); authState.authenticated(session, generation);
    } catch (error) {
      if (authState.snapshot().generation !== generation) return;
      if (error instanceof ApiClientError && error.status === 401) authState.signedOut(generation);
      else authState.unavailable(generation, errorMessage(error));
    }
  }, []);
  useEffect(() => {
    let generation = authState.snapshot().generation;
    const unsubscribe = authState.subscribe(() => {
      if (generation !== authState.snapshot().generation) {
        generation = authState.snapshot().generation;
        void client.cancelQueries(); client.clear();
      }
    });
    void inspect(); return unsubscribe;
  }, [client, inspect]);
  useEffect(() => {
    if (state.phase !== 'authenticated') return;
    const generation = state.generation;
    const timer = window.setTimeout(() => {
      if (authState.remaining() <= 0) { authState.signedOut(generation, '会话需要重新确认，请登录。'); return; }
      void api.authSession().then((session) => authState.authenticated(session, generation)).catch((error) => {
        if (authState.snapshot().generation === generation && !(error instanceof ApiClientError && error.status === 401)) {
          authState.notice(generation, '暂时无法确认会话，请重新检查连接。');
        }
      });
    }, Math.max(1, Math.min(60_000, authState.remaining())));
    return () => window.clearTimeout(timer);
  }, [state.generation, state.phase, state.version]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setMessage(null); const generation = authState.snapshot().generation;
    try { const response = await api.authLogin({ username, password }); authState.authenticated(response, generation); }
    catch (error) {
      if (authState.snapshot().generation === generation) setMessage(error instanceof ApiClientError && error.kind === 'network'
        ? '登录结果尚未确认。请重新检查会话后再决定是否重试。' : errorMessage(error));
    } finally { setPassword(''); setBusy(false); }
  };
  if (state.phase === 'authenticated' || state.phase === 'legacy') return <>{children}</>;
  return <main className="auth-page"><section className="auth-card" aria-labelledby="auth-title">
    <div className="auth-brand">LT Manager</div>
    <LanguageSelector /><h1 id="auth-title">{t(state.phase === 'signed-out' ? 'auth.signInTitle' : state.phase === 'checking' ? 'auth.checking' : 'auth.unavailableTitle')}</h1>
    <p className="muted">{t('auth.description')}</p>
    {state.phase === 'signed-out' ? <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor="auth-username">{t('auth.username')}</label><input id="auth-username" name="username" autoComplete="username" maxLength={64} required value={username} onChange={(event) => setUsername(event.target.value)} disabled={busy} />
      <label htmlFor="auth-password">{t('auth.password')}</label><input id="auth-password" name="password" type="password" autoComplete="current-password" maxLength={256} required value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
      <button className="button button--primary" disabled={busy} type="submit">{t(busy ? 'auth.signingIn' : 'auth.signIn')}</button>
    </form> : null}
    {message || state.notice ? <p role="alert" className="inline-warning">{notice(message ?? state.notice)}</p> : null}
    {state.phase !== 'checking' ? <button className="button button--secondary" disabled={busy} onClick={() => void inspect()}>{t('auth.recheck')}</button> : null}
  </section></main>;
}

export function AuthenticationControls() {
  const { t } = useTranslation();
  const state = useSyncExternalStore(authState.subscribe, authState.snapshot);
  const [busy, setBusy] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const logout = async () => {
    if (busy) return; setBusy(true);
    const pending = api.authLogout(); const generation = authState.snapshot().generation;
    let confirmed = false;
    try { await pending; confirmed = true; }
    catch { /* Local data must still clear when logout cannot be confirmed. */ }
    finally { authState.signedOut(generation, confirmed ? '已退出登录。' : '本页面数据已清除，服务端退出尚未确认；请重新检查会话。'); setBusy(false); }
  };
  const confirm = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setMessage(null); const generation = state.generation;
    try { authState.authenticated(await api.authReauthenticate({ username, password }), generation); setReauth(false); }
    catch (error) { if (authState.snapshot().generation === generation) setMessage(errorMessage(error)); }
    finally { setPassword(''); setBusy(false); }
  };
  if (state.phase !== 'authenticated') return null;
  return <div className="auth-controls">
    <span className="topbar-chip">{t('auth.signedIn')}</span>
    <button className="button button--secondary" disabled={busy} onClick={() => setReauth(true)}>{t('auth.reauthenticate')}</button>
    <button className="button button--secondary" disabled={busy} onClick={() => void logout()}>{t('auth.signOut')}</button>
    {state.notice ? <span role="alert" className="inline-warning">{notice(state.notice)}</span> : null}
    {reauth ? <div className="auth-dialog-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="reauth-title" className="auth-card">
      <h2 id="reauth-title">{t('auth.reauthenticate')}</h2><p className="muted">{t('auth.reauthDescription')}</p>
      <form className="auth-form" onSubmit={(event) => void confirm(event)}>
        <label htmlFor="reauth-username">{t('auth.username')}</label><input id="reauth-username" autoComplete="username" maxLength={64} required value={username} onChange={(event) => setUsername(event.target.value)} disabled={busy} />
        <label htmlFor="reauth-password">{t('auth.password')}</label><input id="reauth-password" type="password" autoComplete="current-password" maxLength={256} required value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
        <button className="button button--primary" disabled={busy}>{t('auth.confirmIdentity')}</button><button type="button" className="button button--secondary" disabled={busy} onClick={() => { setPassword(''); setReauth(false); }}>{t('common.cancel')}</button>
      </form>{message ? <p className="inline-warning" role="alert">{message}</p> : null}
    </section></div> : null}
  </div>;
}
