import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Value } from '@sinclair/typebox/value';
import { worldCreateRequestSchema, type WorldCreateRequest } from '@mcsm/contracts';
import { api, ApiClientError, errorMessage, shouldRetry } from '../api';
type Submission = { key: string; savedAt: number; body: WorldCreateRequest; operationId?: string };

export function WorldCreatePlan({ serverId }: { serverId: string }) {
  const [name, setName] = useState('');
  const [seed, setSeed] = useState('');
  const [confirm, setConfirm] = useState('');
  const [approved, setApproved] = useState(false);
  const storageKey = `mcsm.pendingWorldCreate.${serverId}`;
  const [submission, setSubmission] = useState<Submission | null>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as Submission | null;
      if (saved && typeof saved.key === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(saved.key) &&
        Number.isFinite(saved.savedAt) && Date.now() >= saved.savedAt && Date.now() - saved.savedAt < 86400000 &&
        Value.Check(worldCreateRequestSchema, saved.body) && (saved.operationId === undefined || /^[0-9a-f-]{36}$/iu.test(saved.operationId))) return saved;
    } catch { /* UI state cannot authorize filesystem paths. */ }
    sessionStorage.removeItem(storageKey); return null;
  });
  const client = useQueryClient();
  const creation = useMutation({ mutationFn: (request: Submission) => api.createWorld(serverId, request.body, request.key),
    onSuccess: (response, request) => {
      const next = { ...request, operationId: response.data.operation.id };
      setSubmission(next); sessionStorage.setItem(storageKey, JSON.stringify(next));
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.kind === 'http' && error.status && error.status >= 400 && error.status < 500 && error.code !== 'OPERATION_CONFLICT') {
        sessionStorage.removeItem(storageKey); setSubmission(null);
      }
    }
  });
  const operation = useQuery({ queryKey: ['world-create-operation', submission?.operationId],
    queryFn: ({ signal }) => api.operation(submission!.operationId!, signal), enabled: Boolean(submission?.operationId), retry: shouldRetry,
    refetchInterval: (query) => ['succeeded', 'failed', 'interrupted'].includes(query.state.data?.data.state ?? '') ? false : 500 });
  const terminal = ['succeeded', 'failed', 'interrupted'].includes(operation.data?.data.state ?? '');
  useEffect(() => {
    if (terminal) {
      sessionStorage.removeItem(storageKey);
      void client.invalidateQueries({ queryKey: ['worlds', serverId] });
      void client.invalidateQueries({ queryKey: ['backups', serverId] });
      void client.invalidateQueries({ queryKey: ['servers'] });
    }
  }, [terminal, storageKey, client, serverId]);
  const mutation = useMutation({ mutationFn: () => api.worldCreatePlan(serverId, { name, seed }) });
  const plan = mutation.data?.data;
  const reset = () => mutation.reset();
  return <section className="resource-card page-stack">
    <div><span className="eyebrow">NEW WORLD PLAN</span><h2>规划新世界</h2></div>
    <p className="muted">先校验名称、Seed 和目标版本。执行时保留旧世界和保护备份；完成后保持停止，只有你明确启动才生成新世界。</p>
    <form className="page-stack" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
      <label className="field-label">新世界名称<input required maxLength={64} value={name} disabled={mutation.isPending || Boolean(submission)}
        onChange={(event) => { setName(event.target.value); reset(); }} /></label>
      <label className="field-label">Seed（留空为随机）<input maxLength={20} inputMode="text" value={seed} disabled={mutation.isPending || Boolean(submission)}
        onChange={(event) => { setSeed(event.target.value); reset(); }} /></label>
      <button className="button button--secondary" type="submit" disabled={mutation.isPending || !name || Boolean(submission)}>{mutation.isPending ? '正在校验…' : '校验新世界计划'}</button>
    </form>
    {mutation.isError ? <p className="inline-warning" role="alert">{errorMessage(mutation.error)}</p> : null}
    {plan ? <div className="page-stack" role="status">
      <p>计划已校验，尚未创建世界。</p>
      <dl className="resource-grid"><div><dt>目标世界</dt><dd>{plan.name}</dd></div><div><dt>目标版本</dt><dd>{plan.minecraftVersion}</dd></div>
        <div><dt>Seed</dt><dd>{plan.seed ?? '首次显式启动时随机生成'}</dd></div><div><dt>当前世界</dt><dd>{plan.currentWorldName}</dd></div></dl>
      <p className="muted">{plan.requiresStop ? '后续执行需要明确允许停服。' : '实例当前停止，后续执行默认保持停止。'}实际执行前将再次校验；新世界只在你明确启动后生成。</p>
    </div> : null}
    {plan?.executionAvailable && plan.worldRevision && !submission ? <div className="page-stack">
      <label className="field-label">输入当前世界名确认切换<input value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
      <label className="checkbox-line"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />我确认保留旧世界，并允许必要停服</label>
      <button className="button button--secondary" disabled={creation.isPending || !approved || confirm !== plan.currentWorldName} onClick={() => {
        const request: Submission = { key: crypto.randomUUID(), savedAt: Date.now(), body: { name: plan.name, seed,
          confirmWorldName: confirm, worldRevision: plan.worldRevision!, allowStop: approved } };
        setSubmission(request); sessionStorage.setItem(storageKey, JSON.stringify(request)); creation.mutate(request);
      }}>确认创建并保持停服</button>
    </div> : null}
    {submission && !submission.operationId && !terminal ? <><p className="muted">尚未确认请求结果：目标 {submission.body.name}，当前世界 {submission.body.confirmWorldName}。再次查询使用同一请求，不会自动重试。</p>
      <button className="button button--secondary" disabled={creation.isPending} onClick={() => creation.mutate(submission)}>确认未完成的新建请求</button></> : null}
    {creation.isError ? <p role="alert" className="inline-warning">{errorMessage(creation.error)}</p> : null}
    {operation.isError ? <p role="alert" className="inline-warning">{errorMessage(operation.error)}</p> : null}
    {operation.data ? <p role="status">{operation.data.data.state === 'succeeded' ? '配置已切换；旧世界和保护备份已保留。服务器保持停止，请明确启动生成新世界。' : `新建状态：${operation.data.data.state} / ${operation.data.data.step}`}</p> : null}
    {operation.data?.data.error ? <p role="alert" className="inline-warning">{operation.data.data.error.message}</p> : null}
    {terminal ? <button className="button button--secondary" onClick={() => { setSubmission(null); mutation.reset(); creation.reset(); setConfirm(''); setApproved(false); }}>查看新的世界计划</button> : null}
  </section>;
}
