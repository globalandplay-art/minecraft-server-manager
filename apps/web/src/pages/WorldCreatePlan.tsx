import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Value } from '@sinclair/typebox/value';
import { worldCreateRequestSchema, type WorldCreateRequest } from '@mcsm/contracts';
import { api, ApiClientError, errorMessage, shouldRetry } from '../api';
import { useTranslation } from 'react-i18next';
type Submission = { key: string; savedAt: number; body: WorldCreateRequest; operationId?: string };

export function WorldCreatePlan({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
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
      // Authorization can expire after an intent was persisted. A generic4xx
      // does not establish that preparation never began; keep its request key.
      if (error instanceof ApiClientError && error.kind === 'http' && (
        error.status === 400 && error.code === 'VALIDATION_ERROR' ||
        error.status === 409 && (error.code === 'WORLD_REVISION_CONFLICT' || error.code === 'WORLD_NAME_CONFLICT')
      )) {
        sessionStorage.removeItem(storageKey); setSubmission(null);
      }
    }
  });
  const operation = useQuery({ queryKey: ['world-create-operation', submission?.operationId],
    queryFn: ({ signal }) => api.operation(submission!.operationId!, signal), enabled: Boolean(submission?.operationId), retry: shouldRetry,
    refetchInterval: (query) => ['succeeded', 'failed', 'interrupted'].includes(query.state.data?.data.state ?? '') ? false : 500 });
  const state = operation.data?.data.state;
  const terminal = state === 'succeeded' || state === 'failed' || state === 'interrupted';
  const canReset = state === 'succeeded' || state === 'failed';
  useEffect(() => {
    if (terminal) {
      if (canReset) sessionStorage.removeItem(storageKey);
      void client.invalidateQueries({ queryKey: ['worlds', serverId] });
      void client.invalidateQueries({ queryKey: ['backups', serverId] });
      void client.invalidateQueries({ queryKey: ['servers'] });
    }
  }, [terminal, canReset, storageKey, client, serverId]);
  const mutation = useMutation({ mutationFn: () => api.worldCreatePlan(serverId, { name, seed }) });
  const plan = mutation.data?.data;
  const reset = () => mutation.reset();
  return <section className="resource-card page-stack">
    <div><span className="eyebrow">{t('worldv2.create.eyebrow')}</span><h2>{t('worldv2.create.title')}</h2></div>
    <p className="muted">{t('worldv2.create.help')}</p>
    <form className="page-stack" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
      <label className="field-label">{t('worldv2.create.name')}<input required maxLength={64} value={name} disabled={mutation.isPending || Boolean(submission)}
        onChange={(event) => { setName(event.target.value); reset(); }} /></label>
      <label className="field-label">{t('worldv2.create.seed')}<input maxLength={20} inputMode="text" value={seed} disabled={mutation.isPending || Boolean(submission)}
        onChange={(event) => { setSeed(event.target.value); reset(); }} /></label>
      <button className="button button--secondary" type="submit" disabled={mutation.isPending || !name || Boolean(submission)}>{t(mutation.isPending ? 'worldv2.checking' : 'worldv2.create.check')}</button>
    </form>
    {mutation.isError ? <p className="inline-warning" role="alert">{errorMessage(mutation.error)}</p> : null}
    {plan ? <div className="page-stack" role="status">
      <p>{t('worldv2.create.checked')}</p>
      <dl className="resource-grid"><div><dt>{t('worldv2.create.target')}</dt><dd>{plan.name}</dd></div><div><dt>{t('worldv2.create.version')}</dt><dd>{plan.minecraftVersion}</dd></div>
        <div><dt>Seed</dt><dd>{plan.seed ?? t('worldv2.create.random')}</dd></div><div><dt>{t('worldv2.create.current')}</dt><dd>{plan.currentWorldName}</dd></div></dl>
      <p className="muted">{t(plan.requiresStop ? 'worldv2.create.needsStop' : 'worldv2.create.stopped')} {t('worldv2.create.recheck')}</p>
    </div> : null}
    {plan?.executionAvailable && plan.worldRevision && !submission ? <div className="page-stack">
      <label className="field-label">{t('worldv2.create.confirmName')}<input value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
      <label className="checkbox-line"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />{t('worldv2.create.approve')}</label>
      <button className="button button--secondary" disabled={creation.isPending || !approved || confirm !== plan.currentWorldName} onClick={() => {
        const request: Submission = { key: crypto.randomUUID(), savedAt: Date.now(), body: { name: plan.name, seed,
          confirmWorldName: confirm, worldRevision: plan.worldRevision!, allowStop: approved } };
        setSubmission(request); sessionStorage.setItem(storageKey, JSON.stringify(request)); creation.mutate(request);
      }}>{t('worldv2.create.submit')}</button>
    </div> : null}
    {submission && !submission.operationId && !terminal ? <><p className="muted">{t('worldv2.create.unknown', { name: submission.body.name, current: submission.body.confirmWorldName })}</p>
      <button className="button button--secondary" disabled={creation.isPending} onClick={() => creation.mutate(submission)}>{t('worldv2.create.retry')}</button></> : null}
    {creation.isError ? <p role="alert" className="inline-warning">{errorMessage(creation.error)}</p> : null}
    {operation.isError ? <p role="alert" className="inline-warning">{errorMessage(operation.error)}</p> : null}
    {operation.data ? <p role="status">{operation.data.data.state === 'succeeded' ? t('worldv2.create.prepared') : t('worldv2.create.status', { state: t(`worldv2.state.${operation.data.data.state}`), step: operation.data.data.step })}</p> : null}
    {operation.data?.data.error ? <p role="alert" className="inline-warning">{operation.data.data.error.message}</p> : null}
    {canReset ? <button className="button button--secondary" onClick={() => { setSubmission(null); mutation.reset(); creation.reset(); setConfirm(''); setApproved(false); }}>{t('worldv2.create.next')}</button> : null}
  </section>;
}
