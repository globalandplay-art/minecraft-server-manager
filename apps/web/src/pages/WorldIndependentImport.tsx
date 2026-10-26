import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Value } from '@sinclair/typebox/value';
import { worldLibraryImportRequestSchema, type WorldLibraryImportRequest } from '@mcsm/contracts';
import { api, errorMessage, shouldRetry } from '../api';

type Pending = { serverId: string; key: string; body: WorldLibraryImportRequest; operationId?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function readPending(storageKey: string, serverId: string): Pending | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as Pending | null;
    return value?.serverId === serverId && typeof value.key === 'string' && uuid.test(value.key) && Value.Check(worldLibraryImportRequestSchema, value.body) &&
      (value.operationId === undefined || typeof value.operationId === 'string' && uuid.test(value.operationId)) ? value : null;
  } catch { return null; }
}

type Props = { serverId: string; uploadId: string | null; onLifecycle?: () => void };
/** Instance changes reset local UI; language changes preserve every draft/key. */
export function WorldIndependentImport(props: Props) {
  return <IndependentImportInstance key={props.serverId} {...props} />;
}
function IndependentImportInstance({ serverId, uploadId, onLifecycle }: {
  serverId: string; uploadId: string | null; onLifecycle?: () => void;
}) {
  const { t } = useTranslation(); const client = useQueryClient();
  const storageKey = `lt.pendingIndependentWorld.${serverId}`;
  const [name, setName] = useState('');
  const [pending, setPending] = useState<Pending | null>(() => readPending(storageKey, serverId));
  const [storageError, setStorageError] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const notified = useRef<string | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const planning = useMutation({ retry: false, mutationFn: () => {
    controller.current?.abort(); controller.current = new AbortController();
    return api.worldLibraryImportPlan(serverId, { name, uploadId: uploadId! }, controller.current.signal);
  } });
  const submission = useMutation({ retry: false, mutationFn: (request: Pending) => api.importIndependentWorld(request.serverId, request.body, request.key),
    onSuccess: (response, request) => {
      const next = { ...request, operationId: response.data.operation.id }; setPending(next);
      try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { setStorageError(true); }
      onLifecycle?.();
    } });
  const operation = useQuery({ queryKey: ['independent-world-operation', serverId, pending?.operationId],
    queryFn: ({ signal }) => api.operation(pending!.operationId!, signal), enabled: Boolean(pending?.operationId), retry: shouldRetry,
    refetchInterval: query => ['succeeded', 'failed', 'interrupted'].includes(query.state.data?.data.state ?? '') ? false : 1000 });
  const state = operation.data?.data.state;
  const terminal = state === 'succeeded' || state === 'failed' || state === 'interrupted';
  useEffect(() => {
    if (!terminal || !pending?.operationId || notified.current === pending.operationId) return;
    notified.current = pending.operationId; onLifecycle?.();
    void client.invalidateQueries({ queryKey: ['world-library', serverId] });
  }, [terminal, pending?.operationId, client, serverId, onLifecycle]);
  const verification = useQuery({ queryKey: ['independent-world-final-list', serverId, pending?.operationId],
    queryFn: ({ signal }) => api.worldLibrary(serverId, signal), enabled: state === 'succeeded', retry: shouldRetry });
  const verified = state === 'succeeded' && verification.data?.data.state === 'ready' &&
    verification.data.data.activeWorldId === pending?.body.currentWorldId && verification.data.data.items.some(item =>
      item.worldId === operation.data?.data.result?.resourceId && item.levelName === pending?.body.name && item.state === 'present');
  const plan = planning.data?.data.name === name && planning.data.data.uploadId === uploadId ? planning.data.data : undefined;
  const begin = () => {
    if (!plan || pending || !window.confirm(t('worldv2.confirm', { name: plan.name }))) return;
    const request: Pending = { serverId, key: crypto.randomUUID(), body: { mode: 'independent', name: plan.name, uploadId: plan.uploadId,
      uploadRevision: plan.uploadRevision, libraryRevision: plan.libraryRevision, currentWorldId: plan.currentWorldId, currentWorldRevision: plan.currentWorldRevision } };
    try { sessionStorage.setItem(storageKey, JSON.stringify(request)); } catch { setStorageError(true); return; }
    setPending(request); setStorageError(false); submission.mutate(request);
  };
  const message = planning.error ?? submission.error ?? operation.error ?? verification.error;
  return <section className="page-stack">
    <h3>{t('worldv2.independentTitle')}</h3><p className="muted">{t('worldv2.independentHelp')}</p>
    {!pending ? uploadId ? <form className="page-stack" onSubmit={event => { event.preventDefault(); planning.mutate(); }}>
      <label className="field-label">{t('worldv2.worldName')}<input value={name} maxLength={64} required disabled={planning.isPending}
        onChange={event => { controller.current?.abort(); setName(event.target.value); planning.reset(); }} /></label>
      <button className="button button--secondary" disabled={!name || planning.isPending}>{t(planning.isPending ? 'worldv2.checking' : 'worldv2.plan')}</button>
    </form> : <p className="muted">{t('worldv2.selectUpload')}</p> : null}
    {plan && !pending ? <div role="status" className="page-stack"><p>{t('worldv2.planReady')}</p>
      <button className="button button--primary" disabled={!plan.executionAvailable || submission.isPending} onClick={begin}>{t('worldv2.install')}</button></div> : null}
    {pending && !pending.operationId ? <div className="page-stack"><p role="status">{t(submission.isPending ? 'worldv2.submitting' : 'worldv2.unknown')}</p>
      {!submission.isPending ? <button className="button button--secondary" onClick={() => submission.mutate(pending)}>{t('worldv2.confirmOriginal')}</button> : null}</div> : null}
    {pending?.operationId ? <div className="page-stack"><p className="muted">{t('worldv2.operationId')}: <code>{pending.operationId}</code></p>
      {state ? <p role="status">{t(`worldv2.state.${state}`)}</p> : null}
      {state === 'interrupted' || state === 'failed' ? <p className="inline-warning">{t('worldv2.inspect')}</p> : null}
      {state === 'succeeded' && !verified ? <p>{verification.isError || verification.data ? t('worldv2.inspect') : t('worldv2.verifyList')}</p> : null}
      {verified ? <><p role="status">{t('worldv2.success')}</p><button className="button button--secondary" onClick={() => {
        try { sessionStorage.removeItem(storageKey); } catch { setStorageError(true); return; }
        setPending(null); planning.reset(); onLifecycle?.();
      }}>{t('worldv2.done')}</button></> : null}
      <button className="button button--secondary" onClick={() => { void operation.refetch(); if (state === 'succeeded') void verification.refetch(); }}>{t('worldv2.refresh')}</button>
    </div> : null}
    {storageError ? <p role="alert" className="inline-warning">{t('worldv2.storageError')}</p> : null}
    {message ? <p role="alert" className="inline-warning">{errorMessage(message)}</p> : null}
  </section>;
}
