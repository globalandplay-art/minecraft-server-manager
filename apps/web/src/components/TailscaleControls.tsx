import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AccessOperation, AccessMutationRequest } from '@mcsm/contracts';
import { api, errorMessage } from '../api';

type Request = { action: 'enable' | 'disable'; body: AccessMutationRequest; key: string };
export function TailscaleControls() {
  const query = useQuery({ queryKey: ['tailscale-control'], queryFn: ({ signal }) => api.tailscaleControl(signal), retry: false });
  const status = query.data?.data;
  const [confirmation, setConfirmation] = useState<Request | null>(null);
  const [uncertain, setUncertain] = useState<Request | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false); const active = useRef(false);
  const [operation, setOperation] = useState<AccessOperation | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const refresh = async () => { await query.refetch(); };
  const run = async (request: Request) => {
    if (active.current) return; active.current = true; setBusy(true); setMessage(null); setUncertain(request);
    try {
      const result = await api.tailscaleMutate(request.action, request.body, request.key);
      setOperation(result.data); setUncertain(null); setConfirmation(null); setChecked(false); await refresh();
    } catch (error) { setMessage(`操作结果尚需确认：${errorMessage(error)}`); }
    finally { active.current = false; setBusy(false); }
  };
  const choose = (action: Request['action']) => {
    if (!status?.revision || busy || uncertain) return;
    setChecked(false); setConfirmation({ action, body: { revision: status.revision, confirm: true }, key: crypto.randomUUID() });
  };
  const recover = async () => {
    const id = status?.recoveryOperationId; if (!id || !status?.revision || active.current) return;
    active.current = true; setBusy(true); setMessage(null);
    try {
      const result = await api.accessRecover(id, { revision: status.revision, confirm: true }); setOperation(result.data);
      if (result.data.id === id && result.data.resource.provider === 'tailscale' &&
        (!uncertain || result.data.action === uncertain.action) &&
        (result.data.state === 'succeeded' || result.data.state === 'failed')) {
        setUncertain(null); setConfirmation(null); setChecked(false);
      }
      await refresh();
    }
    catch (error) { setMessage(errorMessage(error)); }
    finally { active.current = false; setBusy(false); }
  };
  return <section aria-label="Tailscale controlled access">
    <h3>受控启停</h3>
    <p>请先通过“再次确认身份”验证管理员。停用远程入口后，本机管理仍可使用。</p>
    <p>控制状态：{busy ? '操作进行中，尚未确认' : status?.state ?? '未知'}</p>
    {status?.lastErrorCode ? <p role="status">{status.lastErrorCode}</p> : null}
    {!status?.enableAllowed && !status?.disableAllowed && !status?.recoveryOperationId ? <p>启停尚未开放；不会自动配置网络。</p> : null}
    {status?.enableAllowed ? <button className="button button--secondary" disabled={busy || Boolean(uncertain)} onClick={() => choose('enable')}>启用私有访问</button> : null}
    {status?.disableAllowed ? <button className="button button--secondary" disabled={busy || Boolean(uncertain)} onClick={() => choose('disable')}>停用私有访问</button> : null}
    <button className="button button--secondary" disabled={busy || query.isFetching} onClick={() => void refresh()}>查询控制状态</button>
    {uncertain ? <button className="button button--secondary" disabled={busy} onClick={() => void run(uncertain)}>按原请求确认结果</button> : null}
    {status?.recoveryOperationId ? <button className="button button--secondary" disabled={busy} onClick={() => void recover()}>显式核验恢复（不重试网络操作）</button> : null}
    {operation ? <p role="status">操作 {operation.id}：{operation.state}{operation.errorCode ? ` / ${operation.errorCode}` : ''}</p> : null}
    {query.error || message ? <p role="alert">{message ?? errorMessage(query.error)}</p> : null}
    {confirmation ? <section role="dialog" aria-modal="true" aria-label="确认私有访问操作">
      <p>{confirmation.action === 'enable' ? '启用' : '停用'} Manager 专属 HTTPS 443 根路由；不开放游戏或 RCON 端口。</p>
      <p>配置 revision：{confirmation.body.revision}。公网模式保持独立；此操作不代表远端验收通过。</p>
      <label><input type="checkbox" checked={checked} disabled={busy} onChange={(event) => setChecked(event.target.checked)} />我确认此操作及远程会话可能断开</label>
      <button className="button button--primary" disabled={!checked || busy} onClick={() => void run(confirmation)}>确认执行</button>
      <button className="button button--secondary" disabled={busy || Boolean(uncertain)} onClick={() => setConfirmation(null)}>取消</button>
    </section> : null}
  </section>;
}
