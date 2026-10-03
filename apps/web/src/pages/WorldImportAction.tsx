import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Value } from '@sinclair/typebox/value';
import { worldImportRequestSchema, worldImportRecoveryRequestSchema, type WorldImportRequest, type WorldImportRecoveryRequest } from '@mcsm/contracts';
import { api, ApiClientError, errorMessage, shouldRetry } from '../api';

type Pending = { kind: 'import' | 'recovery'; key: string; savedAt: number; body: WorldImportRequest | WorldImportRecoveryRequest; operationId?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function readPending(key: string): Pending | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Pending | null;
    if (value && ['import', 'recovery'].includes(value.kind) && uuid.test(value.key) && Number.isFinite(value.savedAt) &&
      value.savedAt <= Date.now() && Date.now() - value.savedAt < 86_400_000 &&
      (value.operationId === undefined || uuid.test(value.operationId)) &&
      Value.Check(value.kind === 'import' ? worldImportRequestSchema : worldImportRecoveryRequestSchema, value.body)) return value;
  } catch { /* Stored UI state never authorizes paths or bypasses server validation. */ }
  sessionStorage.removeItem(key); return null;
}

export function WorldImportAction({ serverId, uploadId, onLifecycle }: { serverId: string; uploadId: string | null; onLifecycle?: () => void }) {
  const storageKey = `mcsm.pendingWorldImport.${serverId}`;
  const [pending, setPending] = useState<Pending | null>(() => readPending(storageKey));
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState('');
  const [approved, setApproved] = useState(false);
  const [recoveryOperationId, setRecoveryOperationId] = useState(() => {
    const saved = sessionStorage.getItem(`mcsm.failedWorldImport.${serverId}`);
    return saved && uuid.test(saved) ? saved : '';
  });
  const [recoveryConfirm, setRecoveryConfirm] = useState('');
  const [recoveryApproved, setRecoveryApproved] = useState(false);
  const client = useQueryClient();
  const submit = useMutation({ mutationFn: (request: Pending) => request.kind === 'import'
    ? api.importWorld(serverId, request.body as WorldImportRequest, request.key)
    : api.recoverWorldImport(serverId, request.body as WorldImportRecoveryRequest, request.key),
    onSuccess: (response, request) => {
      const next = { ...request, operationId: response.data.operation.id };
      setPending(next); sessionStorage.setItem(storageKey, JSON.stringify(next));
      onLifecycle?.();
    },
    onError: (error, request) => {
      // An explicit 4xx rejection can release UI pending state, but unknown
      // responses and conflicts retain the same request/key for manual retry.
      if (error instanceof ApiClientError && error.kind === 'http' && error.status && error.status >= 400 && error.status < 500 && error.code !== 'OPERATION_CONFLICT') {
        sessionStorage.removeItem(storageKey); setPending(null);
        if (request.kind === 'import') { planning.reset(); setConfirm(''); setApproved(false); }
        else { recovery.reset(); setRecoveryConfirm(''); setRecoveryApproved(false); }
      }
    }
  });
  const operation = useQuery({ queryKey: ['world-import-operation', pending?.operationId],
    queryFn: ({ signal }) => api.operation(pending!.operationId!, signal), enabled: Boolean(pending?.operationId), retry: shouldRetry,
    refetchInterval: (query) => ['succeeded', 'failed', 'interrupted'].includes(query.state.data?.data.state ?? '') ? false : 500 });
  const terminal = ['succeeded', 'failed', 'interrupted'].includes(operation.data?.data.state ?? '');
  useEffect(() => {
    if (!terminal) return;
    if (pending?.kind === 'import' && operation.data?.data.state !== 'succeeded' && pending.operationId) {
      sessionStorage.setItem(`mcsm.failedWorldImport.${serverId}`, pending.operationId);
      setRecoveryOperationId(pending.operationId);
    }
    if (pending?.kind === 'recovery' && operation.data?.data.state === 'succeeded') sessionStorage.removeItem(`mcsm.failedWorldImport.${serverId}`);
    sessionStorage.removeItem(storageKey);
    onLifecycle?.();
    for (const key of [['worlds', serverId], ['backups', serverId], ['servers']]) void client.invalidateQueries({ queryKey: key });
  }, [terminal, storageKey, client, serverId, pending, operation.data, onLifecycle]);
  const planning = useMutation({ mutationFn: () => api.worldImportPlan(serverId, { uploadId: uploadId!, name }) });
  const recovery = useMutation({ mutationFn: () => api.worldImportRecoveryPlan(serverId, { operationId: recoveryOperationId }) });
  // Late responses must not authorize a different upload/name or recovery ID.
  const plan = planning.data?.data.uploadId === uploadId && planning.data.data.name === name ? planning.data.data : undefined;
  const recoveryPlan = recovery.data?.data.operationId === recoveryOperationId ? recovery.data.data : undefined;
  const persist = (request: Pending) => { setPending(request); sessionStorage.setItem(storageKey, JSON.stringify(request)); submit.mutate(request); };
  const resetPlan = () => { planning.reset(); setConfirm(''); setApproved(false); };
  useEffect(() => { planning.reset(); setConfirm(''); setApproved(false); }, [uploadId]); // a plan is scoped to one upload

  return <section className="resource-card page-stack">
    <h2>导入世界与显式恢复</h2>
    <p className="muted">导入使用新的世界名称，保留旧世界及保护备份。完成后保持停服，不会自动启动或回滚。</p>
    {uploadId && !pending ? <form className="page-stack" onSubmit={(event) => { event.preventDefault(); resetPlan(); planning.mutate(); }}>
      <p style={{ overflowWrap: 'anywhere' }}>选中暂存：{uploadId}</p>
      <label className="field-label">导入后的世界名称<input required maxLength={64} value={name} disabled={planning.isPending}
        onChange={(event) => { setName(event.target.value); resetPlan(); }} /></label>
      <button className="button button--secondary" disabled={!name || planning.isPending}>校验导入计划</button>
    </form> : null}
    {plan && !pending ? <div className="page-stack" role="status">
      <p>计划已校验，尚未导入：{plan.name} · {plan.minecraftVersion} · {plan.fileCount} 个文件</p>
      <p>当前世界：{plan.currentWorldName}。{plan.requiresStop ? '执行需要明确允许停服。' : '服务器当前停止。'}</p>
      <label className="field-label">输入当前世界名确认导入<input value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
      <label className="checkbox-line"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />我确认保留旧世界和保护备份，并允许必要停服</label>
      <button className="button button--secondary" disabled={planning.isPending || !plan.executionAvailable || !approved || confirm !== plan.currentWorldName || submit.isPending}
        onClick={() => persist({ kind: 'import', key: crypto.randomUUID(), savedAt: Date.now(), body: { uploadId: plan.uploadId, name: plan.name,
          uploadRevision: plan.uploadRevision, worldRevision: plan.worldRevision, confirmWorldName: confirm, allowStop: approved } })}>确认导入并保持停服</button>
    </div> : null}
    {planning.isError ? <p role="alert" className="inline-warning">{errorMessage(planning.error)}</p> : null}
    {pending && !pending.operationId ? <><p className="inline-warning">请求结果尚未确认。只可用相同请求和 Idempotency-Key 确认，不会自动重试。</p>
      <button className="button button--secondary" disabled={submit.isPending || Date.now() - pending.savedAt >= 86_400_000} onClick={() => submit.mutate(pending)}>确认未完成的导入或恢复请求</button></> : null}
    {submit.isError ? <p role="alert" className="inline-warning">{errorMessage(submit.error)}</p> : null}
    {operation.isError ? <p role="alert" className="inline-warning">{errorMessage(operation.error)}</p> : null}
    {operation.data ? <div role="status"><p>{operation.data.data.state === 'succeeded'
      ? pending?.kind === 'recovery' ? '已显式恢复旧世界配置，所有世界树保留；服务器保持停止。' : '世界已导入，旧世界及保护备份保留；服务器保持停止，请另行明确启动。'
      : `操作状态：${operation.data.data.state} / ${operation.data.data.step}`}</p>
      {operation.data.data.error ? <p role="alert" className="inline-warning">{operation.data.data.error.message}</p> : null}
    </div> : null}
    {terminal ? <button className="button button--secondary" onClick={() => {
      if (pending?.kind === 'import' && pending.operationId && operation.data?.data.state !== 'succeeded') setRecoveryOperationId(pending.operationId);
      setPending(null); submit.reset(); resetPlan();
    }}>关闭操作结果并检查恢复</button> : null}
    {!pending ? <div className="page-stack">
      <h3>检查失败导入的恢复计划</h3>
      <label className="field-label">原导入操作 ID<input value={recoveryOperationId} maxLength={36} onChange={(event) => { setRecoveryOperationId(event.target.value); recovery.reset(); setRecoveryConfirm(''); setRecoveryApproved(false); }} /></label>
      <button className="button button--secondary" disabled={!uuid.test(recoveryOperationId) || recovery.isPending} onClick={() => { setRecoveryConfirm(''); setRecoveryApproved(false); recovery.mutate(); }}>校验显式恢复计划</button>
      {recovery.isError ? <p role="alert" className="inline-warning">{errorMessage(recovery.error)}</p> : null}
      {recoveryPlan ? <div className="page-stack"><p>恢复旧世界：{recoveryPlan.previousWorldName}；导入树与暂存都会保留。不会自动启动。</p>
        <label className="field-label">输入旧世界名确认恢复<input value={recoveryConfirm} onChange={(event) => setRecoveryConfirm(event.target.value)} /></label>
        <label className="checkbox-line"><input type="checkbox" checked={recoveryApproved} onChange={(event) => setRecoveryApproved(event.target.checked)} />我确认恢复原配置，保留所有世界树并保持停服</label>
        <button className="button button--secondary" disabled={recovery.isPending || !recoveryPlan.executionAvailable || !recoveryApproved || recoveryConfirm !== recoveryPlan.previousWorldName || submit.isPending}
          onClick={() => persist({ kind: 'recovery', key: crypto.randomUUID(), savedAt: Date.now(), body: { operationId: recoveryPlan.operationId, confirmWorldName: recoveryConfirm, recoveryRevision: recoveryPlan.recoveryRevision } })}>明确恢复旧世界并保持停服</button>
      </div> : null}
    </div> : null}
  </section>;
}
