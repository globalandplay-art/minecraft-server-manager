import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Value } from '@sinclair/typebox/value';
import { worldArchiveRequestSchema, type WorldArchiveRequest, type WorldInfo } from '@mcsm/contracts';
import { api, ApiClientError, errorMessage, shouldRetry } from '../api';
type Submission = { key:string; savedAt:number; body:WorldArchiveRequest; operationId?:string };

export function WorldArchiveAction({ serverId, world, running, allowed }: { serverId:string; world:WorldInfo | undefined; running:boolean; allowed:boolean }) {
  const storageKey = `mcsm.pendingWorldArchive.${serverId}`;
  const [confirmation,setConfirmation] = useState('');
  const [approved,setApproved] = useState(false);
  const [failedMessage,setFailedMessage] = useState<string | null>(null);
  const [submission,setSubmission] = useState<Submission | null>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as Submission | null;
      if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(saved.key) &&
        Number.isFinite(saved.savedAt) && Date.now() >= saved.savedAt && Date.now() - saved.savedAt < 86400000 && Value.Check(worldArchiveRequestSchema,saved.body) &&
        (saved.operationId === undefined || /^[0-9a-f-]{36}$/iu.test(saved.operationId))) return saved;
    } catch { /* UI storage grants no filesystem authority. */ }
    sessionStorage.removeItem(storageKey); return null;
  });
  const client = useQueryClient();
  const mutation = useMutation({ mutationFn:(request:Submission) => api.archiveWorld(serverId,request.body,request.key),
    onSuccess:(response,request) => { const next = { ...request,operationId:response.data.operation.id }; setSubmission(next); sessionStorage.setItem(storageKey,JSON.stringify(next)); },
    onError:(error) => {
      if (error instanceof ApiClientError && error.kind === 'http' && error.status && error.status >= 400 && error.status < 500 && error.code !== 'OPERATION_CONFLICT') {
        sessionStorage.removeItem(storageKey); setSubmission(null); setConfirmation(''); setApproved(false);
        void client.invalidateQueries({ queryKey:['worlds',serverId] });
      }
    }
  });
  const operation = useQuery({ queryKey:['world-archive-operation',submission?.operationId],queryFn:({ signal }) => api.operation(submission!.operationId!,signal),
    enabled:Boolean(submission?.operationId),retry:shouldRetry,refetchInterval:(query) => ['succeeded','failed','interrupted'].includes(query.state.data?.data.state ?? '') ? false : 500 });
  const terminal = ['succeeded','failed','interrupted'].includes(operation.data?.data.state ?? '');
  const outcome = operation.data?.data;
  useEffect(() => {
    if (terminal && outcome) {
      const definiteFailure = outcome.state === 'failed' && outcome.error?.code !== 'RECOVERY_REQUIRED';
      if (outcome.state === 'succeeded' || definiteFailure) sessionStorage.removeItem(storageKey);
      if (definiteFailure) {
        setFailedMessage(outcome.error?.message ?? '归档未完成，请重新确认。');
        setSubmission(null); setConfirmation(''); setApproved(false);
      }
      for (const key of ['worlds','world-archives','backups','servers']) void client.invalidateQueries({ queryKey:key === 'servers' ? [key] : [key,serverId] });
    }
  },[terminal,outcome,storageKey,client,serverId]);
  useEffect(() => { setConfirmation(''); setApproved(false); },[world?.worldId,world?.worldRevision]);
  if (!world && !submission) return null;
  return <section className="resource-card page-stack">
    <h3>归档完整世界集</h3>
    <p className="muted">归档保留所有维度、玩家与 saved data，并建立固定保护备份。完成后没有活动世界，服务器保持停止；启动和重启会被拒绝。归档不自动回滚。</p>
    <p className="muted">世界：{world?.name.value ?? submission?.body.confirmWorldName} · 版本：{world?.minecraftVersion.value ?? '不可用'} · Revision：<span style={{ overflowWrap:'anywhere' }}>{world?.worldRevision ?? submission?.body.worldRevision ?? '不可用'}</span></p>
    {running ? <p className="inline-warning">此操作需要优雅停止当前受管实例并确认 Java 已退出。</p> : <p className="muted">实例已停止，归档后保持停止。</p>}
    {!submission && world ? <>
      <label className="field-label">输入世界名确认归档<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      <label className="checkbox-line"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />我确认归档完整世界集，并允许必要停服</label>
      <button className="button button--secondary" disabled={!allowed || mutation.isPending || !approved || confirmation !== world.name.value || !world.worldRevision} onClick={() => {
        const request:Submission = { key:crypto.randomUUID(),savedAt:Date.now(),body:{ worldId:world.worldId,confirmWorldName:confirmation,worldRevision:world.worldRevision!,intent:'archive-world-set',allowStop:approved } };
        setFailedMessage(null);
        setSubmission(request); sessionStorage.setItem(storageKey,JSON.stringify(request)); mutation.mutate(request);
      }}>确认归档并保持停服</button>
    </> : submission && !submission.operationId ? <><p className="muted">归档请求结果尚未确认，重试沿用同一请求。</p><button className="button button--secondary" disabled={mutation.isPending || Date.now() - submission.savedAt >= 86400000} onClick={() => mutation.mutate(submission)}>确认未完成的归档请求</button></> : null}
    {mutation.isError ? <p role="alert" className="inline-warning">{errorMessage(mutation.error)}</p> : null}
    {operation.isError ? <p role="alert" className="inline-warning">{errorMessage(operation.error)}</p> : null}
    {failedMessage ? <p role="alert" className="inline-warning">{failedMessage}</p> : null}
    {operation.data ? <p role="status">{operation.data.data.state === 'succeeded' ? '世界归档完成；当前没有活动世界，服务器保持停止。' : `归档状态：${operation.data.data.state} / ${operation.data.data.step}`}</p> : null}
    {operation.data?.data.error ? <p role="alert" className="inline-warning">{operation.data.data.error.message}</p> : null}
  </section>;
}

export function WorldArchiveList({ serverId }: { serverId:string }) {
  const query = useQuery({ queryKey:['world-archives',serverId],queryFn:({ signal }) => api.worldArchives(serverId,signal),retry:shouldRetry });
  return <section className="resource-card page-stack"><h2>世界归档</h2>
    {query.isPending ? <p className="muted">正在核验归档…</p> : query.isError ? <p role="alert" className="inline-warning">{errorMessage(query.error)}</p> : query.data?.data.items.length ? query.data.data.items.map((archive) => <div key={archive.id}>
      <h3>{archive.name}</h3><p>{archive.minecraftVersion} · {archive.fileCount} 个文件 · {(archive.sizeBytes / 1024 ** 2).toFixed(1)} MB</p>
      <p className="muted">完整世界集已核验，保护备份已固定。{new Date(archive.createdAt).toLocaleString()}</p>
    </div>) : <p className="muted">还没有已完成的世界归档。</p>}
  </section>;
}
