import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RestoreRequest, RollbackRequest } from '@mcsm/contracts';
import { useEffect, useState } from 'react';
import { ApiClientError, api, errorMessage, shouldRetry } from '../api';

type Pending = { key: string; body: RestoreRequest | RollbackRequest; savedAt: number; operationId?: string };
const TTL = 24 * 60 * 60 * 1000;
function readPending(storageKey: string, rollback: boolean): Pending | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as Pending | null;
    if (!p || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(p.key) ||
      !Number.isFinite(p.savedAt) || p.savedAt > Date.now() || Date.now() - p.savedAt >= TTL || !p.body ||
      typeof p.body.confirmWorldName !== 'string' || p.body.confirmWorldName.length < 1 || p.body.confirmWorldName.length > 128 ||
      !/^[0-9a-f]{64}$/u.test(p.body.worldRevision) ||
      Object.keys(p.body).some((key) => !(rollback ? ['confirmWorldName', 'worldRevision', 'startAfterRollback'] : ['confirmWorldName', 'worldRevision', 'allowStop', 'restoreScope', 'startAfterRestore']).includes(key)) ||
      (rollback ? !('startAfterRollback' in p.body) || typeof p.body.startAfterRollback !== 'boolean' :
        !('restoreScope' in p.body) || p.body.restoreScope !== 'world-set' || p.body.allowStop !== true || typeof p.body.startAfterRestore !== 'boolean') ||
      (p.operationId !== undefined && !/^[0-9a-f-]{36}$/u.test(p.operationId))) return null;
    return p;
  } catch { return null; }
}

export function RestoreAction({ serverId, resourceId, rollback = false }: { serverId: string; resourceId: string; rollback?: boolean }) {
  const storageKey = `mcsm.restore.${serverId}.${rollback ? 'rollback' : 'restore'}.${resourceId}`;
  const [pending, setPending] = useState<Pending | null>(() => readPending(storageKey, rollback));
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [consent, setConsent] = useState(false);
  const [startAfter, setStartAfter] = useState(false);
  const [previousResult, setPreviousResult] = useState<string | null>(null);
  const client = useQueryClient();
  const plan = useQuery({ queryKey: ['restore-plan', serverId, resourceId, rollback], enabled: open && !pending,
    queryFn: ({ signal }) => rollback ? api.rollbackPlan(serverId, resourceId, signal) : api.restorePlan(serverId, resourceId, signal), retry: shouldRetry });
  const mutation = useMutation({ mutationFn: (p: Pending) => rollback
    ? api.rollback(serverId, resourceId, p.body as RollbackRequest, p.key) : api.restore(serverId, resourceId, p.body as RestoreRequest, p.key),
    onSuccess: (response, p) => {
      const saved = { ...p, operationId: response.data.operation.id };
      sessionStorage.setItem(storageKey, JSON.stringify(saved)); setPending(saved);
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.kind === 'http' && error.status && error.status < 500 && error.code !== 'OPERATION_CONFLICT') {
        sessionStorage.removeItem(storageKey); setPending(null);
      }
    }
  });
  const operationId = pending?.operationId;
  const operation = useQuery({ queryKey: ['restore-operation', operationId], enabled: Boolean(operationId),
    queryFn: ({ signal }) => api.operation(operationId!, signal), retry: shouldRetry,
    refetchInterval: (query) => ['succeeded', 'failed', 'interrupted'].includes(query.state.data?.data.state ?? '') ? false : 500 });
  const state = operation.data?.data.state;
  const terminal = ['succeeded', 'failed', 'interrupted'].includes(state ?? '');
  const resultText = `${rollback ? '回滚' : '恢复'}状态：${state ?? '正在查询'} · ${operation.data?.data.step ?? '已提交'}${operation.data?.data.error ? `；${operation.data.data.error.message}` : ''}`;
  useEffect(() => {
    if (terminal) {
      sessionStorage.removeItem(storageKey);
      void client.invalidateQueries({ queryKey: ['restore-history', serverId] });
      void client.invalidateQueries({ queryKey: ['backups', serverId] });
      void client.invalidateQueries({ queryKey: ['worlds', serverId] });
      void client.invalidateQueries({ queryKey: ['servers'] });
    }
  }, [terminal, client, storageKey, serverId]);
  const submit = () => {
    if (pending) { mutation.mutate(pending); return; }
    if (!plan.data || plan.isFetching || confirmation !== plan.data.data.worldName || !consent) return;
    const body = { confirmWorldName: confirmation, worldRevision: plan.data.data.worldRevision,
      ...(rollback ? { startAfterRollback: startAfter } : { restoreScope: 'world-set' as const, allowStop: true as const, startAfterRestore: startAfter }) };
    const p = { key: crypto.randomUUID(), body, savedAt: Date.now() };
    sessionStorage.setItem(storageKey, JSON.stringify(p)); setPending(p); mutation.mutate(p);
  };
  return <div className="page-stack">
    {!open && !pending ? <button className="button button--secondary" onClick={() => setOpen(true)}>{rollback ? '显式回滚' : '恢复世界'}</button> : null}
    {open && !pending ? <section className="resource-card" role="dialog" aria-label={rollback ? '回滚确认' : '恢复确认'}>
      <h3>{rollback ? '回滚到恢复前的世界' : '仅恢复世界存档'}</h3>
      <p>停服 → 保护当前世界 → 切换世界 → 按你的选择启动并检查。失败保留现场，必须显式回滚。</p>
      {plan.isPending ? <p>正在验证备份和世界…</p> : plan.isError ? <p role="alert">{errorMessage(plan.error)}</p> : plan.data ? <>
        <p>世界：{plan.data.data.worldName} · 版本：{plan.data.data.minecraftVersion} · {(plan.data.data.sizeBytes / 1024 ** 2).toFixed(1)} MB</p>
        <label className="field-label">输入世界名确认覆盖<input autoFocus value={confirmation} maxLength={128} onChange={(event) => setConfirmation(event.target.value)} /></label>
        <label className="checkbox-line"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />我确认覆盖此世界，并允许必要的停服</label>
        <label className="checkbox-line"><input type="checkbox" checked={startAfter} onChange={(event) => setStartAfter(event.target.checked)} />{rollback ? '回滚后启动服务器' : '恢复后启动服务器'}（默认保持停止）</label>
        <button className="button button--primary" disabled={mutation.isPending || plan.isFetching || !consent || confirmation !== plan.data.data.worldName} onClick={submit}>确认{rollback ? '回滚' : '恢复'}</button>
      </> : null}
      <button className="button button--secondary" onClick={() => void plan.refetch()}>刷新确认信息</button>
      <button className="button button--secondary" onClick={() => setOpen(false)}>取消</button>
    </section> : null}
    {pending && !operationId ? <><p role="status">请求可能已被接受。使用同一请求确认，不会重复切换世界。</p><button className="button button--secondary" disabled={mutation.isPending} onClick={submit}>用相同请求确认状态</button></> : null}
    {previousResult ? <p>{previousResult}</p> : null}
    {operationId ? <p role="status">{resultText}</p> : null}
    {terminal ? <button className="button button--secondary" onClick={() => {
      setPreviousResult(resultText); sessionStorage.removeItem(storageKey); setPending(null);
      setConfirmation(''); setConsent(false); setStartAfter(false); mutation.reset(); setOpen(true);
      void plan.refetch();
    }}>重新确认{rollback ? '回滚' : '恢复'}</button> : null}
    {mutation.isError ? <p role="alert">{errorMessage(mutation.error)}</p> : null}
    {operation.isError ? <><p role="alert">{errorMessage(operation.error)}</p><button className="button button--secondary" onClick={() => void operation.refetch()}>重新查询进度</button></> : null}
  </div>;
}

export function RestoreHistory({ serverId }: { serverId: string }) {
  const history = useQuery({ queryKey: ['restore-history', serverId], queryFn: ({ signal }) => api.restoreHistory(serverId, signal), retry: shouldRetry });
  return <section className="resource-card page-stack"><h2>恢复与回滚记录</h2>
    <button className="button button--secondary" onClick={() => void history.refetch()}>刷新恢复记录</button>
    {history.isError ? <p role="alert">{errorMessage(history.error)}</p> : null}
    {history.data?.data.items.map((item) => <div key={item.operationId} className="page-stack"><p>恢复操作 {item.operationId} · {item.state}</p>
      {item.rollbackAvailable ? <RestoreAction serverId={serverId} resourceId={item.operationId} rollback /> : <p className="muted">{item.state === 'rolled-back' ? '已回滚' : '当前没有可安全执行的回滚；请检查操作或保留现场。'}</p>}
    </div>)}
  </section>;
}
