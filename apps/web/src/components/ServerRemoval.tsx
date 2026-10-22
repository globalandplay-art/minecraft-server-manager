import { useEffect, useRef, useState } from 'react';
import { api, ApiClientError, errorMessage } from '../api';

export function ServerRemoval({ id, name, type, blocked = false, onRemoved }: {
  id: string; name: string; type: string; blocked?: boolean; onRemoved?: ((id: string, notice?: string) => void) | undefined;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false), [message, setMessage] = useState('');
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
      const notice = data.unloaded ? `已移除 ${name} 的 LT 登记，服务端文件完整保留。` : `已移除 ${name} 的登记，需重启 Manager 完成观察器收尾（${data.unloadErrorCode}）。服务端文件保留。`;
      setMessage(notice); setOpen(false); onRemoved?.(id, notice);
    } catch (error) {
      const definite = error instanceof ApiClientError && [400,401,403,404,409].includes(error.status ?? 0) && error.code !== 'REGISTRATION_RESULT_UNKNOWN';
      setUnknown(!definite); setMessage(`${errorMessage(error)}${definite ? '' : '。结果未确认，不会自动重试；请刷新列表核对登记状态。'}`);
    } finally { inFlight.current = false; setBusy(false); }
  };
  return <div className="registration-removal">
    <button type="button" className="button button--secondary" disabled={busy || blocked || unknown} onClick={() => { setOpen(true); setMessage(''); }}>移除服务器</button>
    {blocked ? <p>请先正常停止服务器并完成活动操作，再移除登记。</p> : null}
    {open ? <div className="dialog-backdrop"><section ref={dialog} role="dialog" aria-modal="true" aria-label={`移除 ${name}`} className="confirm-dialog">
      <h3>移除服务器：{name}</h3><p>{type.toUpperCase()} · {id}</p>
      <p>仅取消 LT 管理，不删除服务端目录、世界、玩家、模组、配置或备份。保留的历史状态不会被清理；重新登记建议使用新实例标识。</p>
      <button type="button" className="button button--secondary" disabled={busy} onClick={() => setOpen(false)}>取消</button>
      <button type="button" className="button button--primary" disabled={busy || unknown} onClick={() => void remove()}>{busy ? '正在移除…' : '确认移除'}</button>
    </section></div> : null}
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
