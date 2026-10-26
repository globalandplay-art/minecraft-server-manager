import { useTranslation } from 'react-i18next';
import { renderMessage, type UiMessage } from '../i18n/message';
import { useEffect, useRef, useState } from 'react';
import { ServerRemoval } from './ServerRemoval';
import type { RegistrationCatalogResponse, RegistrationDraft, RegistrationPreviewResponse } from '@mcsm/contracts';
import { api, ApiClientError, errorMessage } from '../api';

export function ServerRegistration({ onLoaded, onRemoved }: { onLoaded?: (() => void) | undefined; onRemoved?: ((id: string, notice?: UiMessage) => void) | undefined } = {}) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<RegistrationCatalogResponse['data']>();
  const [draft, setDraft] = useState<RegistrationDraft>({ id: '', name: '', root: '', jarFile: 'server.jar', javaProfileId: '' });
  const [preview, setPreview] = useState<RegistrationPreviewResponse['data']>();
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false);
  const [message, setMessage] = useState<UiMessage>('');
  const inFlight = useRef(false), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    void api.registrationCatalog(controller.signal).then(response => {
      if (controller.signal.aborted) return;
      setCatalog(response.data); setDraft(current => ({ ...current, javaProfileId: current.javaProfileId || response.data.profiles[0]?.id || '' }));
    }).catch(error => { if (!controller.signal.aborted) setMessage(errorMessage(error)); });
    return () => { mounted.current = false; controller.abort(); };
  }, []);
  const edit = (key: keyof RegistrationDraft, value: string) => {
    setDraft(current => ({ ...current, [key]: value })); setPreview(undefined); setConfirmed(false);
  };
  const check = async () => {
    if (inFlight.current || unknown) return;
    inFlight.current = true; setBusy(true); setMessage(''); setPreview(undefined); setConfirmed(false);
    try { const result = await api.registrationPreview(draft); if (mounted.current) setPreview(result.data); }
    catch (error) { if (mounted.current) setMessage(errorMessage(error)); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const save = async () => {
    if (inFlight.current || !preview || !confirmed || unknown) return;
    inFlight.current = true; setBusy(true); setMessage('');
    try {
      const response = await api.registrationSave(preview.token);
      if (!mounted.current) return;
      const loaded = response.data.loaded === true;
      setMessage(loaded ? { key: 'registration.loaded', values: { name: response.data.name } }
        : { key: 'registration.savedPending', values: { name: response.data.name, code: response.data.loadErrorCode ? '（' + response.data.loadErrorCode + '）' : '' } });
      if (loaded) onLoaded?.();
      setCatalog(current => current ? {
        profiles: loaded ? [...current.profiles.filter(row => row.id !== response.data.id), { id: response.data.id, name: response.data.name }] : current.profiles,
        pending: loaded ? current.pending.filter(row => row.id !== response.data.id)
          : [...current.pending.filter(row => row.id !== response.data.id), { id: response.data.id, name: response.data.name }]
      } : current);
      setPreview(undefined); setConfirmed(false);
    } catch (error) {
      if (mounted.current) {
        const rejected = error instanceof ApiClientError && [400,401,403,409].includes(error.status ?? 0) && error.code !== 'REGISTRATION_RESULT_UNKNOWN';
        setUnknown(!rejected); setPreview(undefined); setConfirmed(false);
        setMessage({ key: rejected ? 'registration.rejected' : 'registration.unknown', values: { error: errorMessage(error) } });
      }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  return <section className="settings-panel registration-panel" aria-label={t('registration.title')}>
    <h2>{t('registration.title')}</h2>
    <p>{t('registration.description')}</p>
    <p>{t('registration.pendingDescription')}</p>
    {catalog?.pending.length ? <div><h3>{t('registration.pending')}</h3><ul>{catalog.pending.map(row => <li key={row.id}>{row.name}（{row.id}）<ServerRemoval id={row.id} name={row.name} type={t('registration.pendingType')} onRemoved={onRemoved} /></li>)}</ul></div> : null}
    {!catalog ? <p role="status">{t('registration.loading')}</p> : null}
    {catalog && !catalog.profiles.length ? <p role="status">{t('registration.noJava')}</p> : null}
    <form onSubmit={event => { event.preventDefault(); void check(); }}>
      <fieldset disabled={busy || unknown || !catalog?.profiles.length}>
        <legend>{t('registration.existing')}</legend>
        <label className="field-label">{t('registration.id')}<input required pattern="[a-z0-9][a-z0-9-]{0,62}" maxLength={63} value={draft.id} onChange={event => edit('id', event.target.value)} placeholder="survival-2" /></label>
        <label className="field-label">{t('registration.name')}<input required maxLength={128} value={draft.name} onChange={event => edit('name', event.target.value)} /></label>
        <label className="field-label">{t('registration.root')}<input required maxLength={4096} value={draft.root} onChange={event => edit('root', event.target.value)} placeholder="C:\Minecraft\survival" /></label>
        <label className="field-label">{t('registration.launchFile')}<input required maxLength={128} value={draft.jarFile} onChange={event => edit('jarFile', event.target.value)} /></label>
        <label className="field-label">{t('registration.java')}<select value={draft.javaProfileId} onChange={event => edit('javaProfileId', event.target.value)}>
          {catalog?.profiles.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select></label>
        <button type="submit" className="button button--secondary">{t(busy ? 'registration.busy' : 'registration.check')}</button>
      </fieldset>
    </form>
    {preview ? <div className="registration-preview">
      <h3>{t('registration.preview', { name: preview.server.name })}</h3>
      <p>{preview.server.type.toUpperCase()} · Minecraft {preview.server.minecraftVersion ?? t('servers.unknownVersion')} · Java {preview.server.java.runtimeVersion ?? t('common.unknown')}</p>
      <p>{t(preview.lifecycleSupported ? 'registration.supported' : 'registration.unsupported')}</p>
      {!preview.eulaAccepted ? <p>{t('registration.eula')}</p> : null}
      {preview.server.detection.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
      <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />{t(preview.restartRequired ? 'registration.confirmPending' : 'registration.confirmImmediate')}</label>
      <button className="button button--primary" disabled={busy || !confirmed || unknown} onClick={() => void save()}>{t('registration.save')}</button>
    </div> : null}
    {message ? <p role="status">{renderMessage(message)}</p> : null}
  </section>;
}
