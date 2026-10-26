import { useEffect, useRef, useState } from 'react';
import { api, ApiClientError, errorMessage } from '../api';
import { useTranslation } from 'react-i18next';
import { renderMessage, type UiMessage } from '../i18n/message';

export function ServerRemoval({ id, name, type, blocked = false, onRemoved }: {
  id: string; name: string; type: string; blocked?: boolean; onRemoved?: ((id: string, notice?: UiMessage) => void) | undefined;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false), [message, setMessage] = useState<UiMessage>('');
  const inFlight = useRef(false);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !inFlight.current) setOpen(false);
      if (event.key !== 'Tab') return;
      const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      if (!buttons.length) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [open]);
  const remove = async () => {
    if (inFlight.current || blocked || unknown) return;
    inFlight.current = true; setBusy(true); setMessage('');
    try {
      const { data } = await api.registrationRemove(id);
      const notice: UiMessage = data.unloaded ? { key: 'removal.success', values: { name } } : { key: 'removal.pending', values: { name, code: data.unloadErrorCode ?? '' } };
      setMessage(notice); setOpen(false); onRemoved?.(id, notice);
    } catch (error) {
      const definite = error instanceof ApiClientError && [400,401,403,404,409].includes(error.status ?? 0) && error.code !== 'REGISTRATION_RESULT_UNKNOWN';
      setUnknown(!definite); setMessage(definite ? errorMessage(error) : { key: 'removal.failureUnknown', values: { error: errorMessage(error) } });
    } finally { inFlight.current = false; setBusy(false); }
  };
  return <div className="registration-removal">
    <button type="button" className="button button--secondary" disabled={busy || blocked || unknown} onClick={() => { setOpen(true); setMessage(''); }}>{t('removal.button')}</button>
    {blocked ? <p>{t('removal.blocked')}</p> : null}
    {open ? <div className="dialog-backdrop"><section ref={dialog} role="dialog" aria-modal="true" aria-label={t('removal.label', { name })} className="confirm-dialog">
      <h3>{t('removal.title', { name })}</h3><p>{type.toUpperCase()} · {id}</p>
      <p>{t('removal.description')}</p>
      <button type="button" className="button button--secondary" disabled={busy} onClick={() => setOpen(false)}>{t('common.cancel')}</button>
      <button type="button" className="button button--primary" disabled={busy || unknown} onClick={() => void remove()}>{t(busy ? 'removal.busy' : 'removal.confirm')}</button>
    </section></div> : null}
    {message ? <p role="status">{renderMessage(message)}</p> : null}
  </div>;
}
