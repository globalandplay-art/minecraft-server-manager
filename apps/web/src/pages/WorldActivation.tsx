import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { worldActivationApprovalSchema, type WorldActivationApproval, type WorldLibraryResponse } from '@mcsm/contracts';
import { Value } from '@sinclair/typebox/value';
import { api, errorMessage, shouldRetry } from '../api';

type Pending = { version: 1; serverId: string; key: string; body: WorldActivationApproval; operationId?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function restore(key: string, serverId: string): { pending: Pending | null; blocked: boolean } {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return { pending: null, blocked: false };
    const value = JSON.parse(raw) as Pending;
    if (!value || value.version !== 1 || value.serverId !== serverId || typeof value.key !== 'string' || !uuid.test(value.key) ||
      !Value.Check(worldActivationApprovalSchema, value.body) ||
      (value.operationId !== undefined && (typeof value.operationId !== 'string' || !uuid.test(value.operationId)))) return { pending: null, blocked: true };
    return { pending: value, blocked: false };
  } catch { return { pending: null, blocked: true }; }
}

/** Instance remounts isolate drafts; language changes retain request identity. */
export function WorldActivation({ library }: { library: WorldLibraryResponse['data'] }) {
  return <ActivationPreparation key={library.serverId} library={library} />;
}
function ActivationPreparation({ library }: { library: WorldLibraryResponse['data'] }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const generationPending = library.state === 'inspection-required' && library.items.some(world => world.origin === 'generation');
  const storageKey = `lt.pendingWorldActivation.${library.serverId}`;
  const [initial] = useState(() => restore(storageKey, library.serverId));
  const [pending, setPending] = useState(initial.pending);
  const pendingRef = useRef(initial.pending);
  const [storageError, setStorageError] = useState(initial.blocked);
  const [confirmation, setConfirmation] = useState('');
  const [target, setTarget] = useState('');
  const mounted = useRef(true);
  const sending = useRef(false);
  const notified = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const plan = useMutation({ retry: false, mutationFn: async (worldId: string) => {
    controller.current?.abort();
    const current = ++epoch.current;
    const request = new AbortController(); controller.current = request;
    const response = await api.worldActivationPlan(library.serverId, worldId, request.signal);
    if (request.signal.aborted || current !== epoch.current) throw new Error(t('worldv2.activationDiscarded'));
    return response;
  } });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; controller.current?.abort(); }; }, []);
  const submission = useMutation({ retry: false, mutationFn: async (request: Pending) => {
    const response = await api.activateWorld(request.serverId, request.body, request.key);
    const operation = response.data.operation;
    if (operation.serverId !== request.serverId || operation.kind !== 'world-activate' || !uuid.test(operation.id)) {
      throw new Error(t('worldv2.inspect'));
    }
    return operation;
  }, onSuccess: (operation, request) => {
    const next = { ...request, operationId: operation.id };
    try {
      const saved = restore(storageKey, request.serverId);
      if (saved.blocked || saved.pending?.key !== request.key) throw new Error('pending-request-changed');
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch { if (mounted.current) setStorageError(true); }
    if (mounted.current) { pendingRef.current = next; setPending(next); }
  }, onSettled: () => { sending.current = false; } });
  const send = (request: Pending) => {
    if (sending.current || generationPending) return;
    sending.current = true; submission.mutate(request);
  };
  const operation = useQuery({ queryKey: ['world-activation-operation', library.serverId, pending?.operationId],
    queryFn: ({ signal }) => api.operation(pending!.operationId!, signal), enabled: Boolean(pending?.operationId), retry: shouldRetry,
    refetchOnMount: 'always', staleTime: 0,
    refetchInterval: query => ['succeeded', 'failed', 'interrupted'].includes(query.state.data?.data.state ?? '') ? false : 1000 });
  const observed = operation.data?.data;
  const bound = observed?.id === pending?.operationId && observed?.serverId === library.serverId && observed?.kind === 'world-activate';
  const freshOperation = operation.isSuccess && operation.isFetchedAfterMount && !operation.isFetching;
  useEffect(() => {
    if (!freshOperation || !bound || !observed || !['succeeded', 'failed', 'interrupted'].includes(observed.state) || notified.current === observed.id) return;
    notified.current = observed.id;
    void client.invalidateQueries({ queryKey: ['world-library', library.serverId] });
    void client.invalidateQueries({ queryKey: ['worlds', library.serverId] });
    void client.invalidateQueries({ queryKey: ['servers'] });
  }, [freshOperation, bound, observed, client, library.serverId]);
  const succeeded = freshOperation && bound && observed?.state === 'succeeded' && observed.result?.resourceId === pending?.body.worldId;
  const verification = useQuery({ queryKey: ['world-activation-final-list', library.serverId, pending?.operationId],
    queryFn: ({ signal }) => api.worldLibrary(library.serverId, signal), enabled: Boolean(succeeded), retry: shouldRetry,
    refetchOnMount: 'always', staleTime: 0 });
  const verified = succeeded && verification.isSuccess && verification.isFetchedAfterMount && !verification.isFetching && verification.data.data.serverId === library.serverId &&
    verification.data.data.state === 'ready' && verification.data.data.activeWorldId === pending?.body.worldId &&
    verification.data.data.items.some(item => item.worldId === pending?.body.worldId && item.state === 'present' && item.levelName === pending.body.confirmWorldName);
  const candidates = library.items.filter(item => item.state === 'present' && item.worldId !== library.activeWorldId);
  const available = library.state === 'ready' && library.activationAvailable === true;
  const data = plan.data?.data;
  const currentPlan = data?.worldId === target && data.serverId === library.serverId && data.libraryRevision === library.revision
    && data.currentWorldId === library.activeWorldId && candidates.some(item => item.worldId === target) ? data : undefined;
  const begin = () => {
    if (!available || !currentPlan?.executionAvailable || confirmation !== currentPlan.levelName || pendingRef.current || storageError || sending.current ||
      !window.confirm(t('worldv2.activationConfirm', { name: currentPlan.levelName }))) return;
    const request: Pending = { version: 1, serverId: library.serverId, key: crypto.randomUUID(), body: {
      worldId: currentPlan.worldId, libraryRevision: currentPlan.libraryRevision, currentWorldId: currentPlan.currentWorldId,
      currentWorldRevision: currentPlan.currentWorldRevision, targetWorldRevision: currentPlan.targetWorldRevision,
      currentContentRevision: currentPlan.currentContentRevision, targetContentRevision: currentPlan.targetContentRevision,
      propertiesRevision: currentPlan.propertiesRevision, confirmWorldName: confirmation } };
    try {
      if (sessionStorage.getItem(storageKey) !== null) throw new Error('pending-request-exists');
      sessionStorage.setItem(storageKey, JSON.stringify(request));
    } catch { setStorageError(true); return; }
    pendingRef.current = request; setPending(request); send(request);
  };
  const message = plan.error ?? submission.error ?? operation.error ?? verification.error;
  return <div className="page-stack">
    {!pending ? <>
    <label>{t('worldv2.activationTarget')}
      <select value={target} disabled={!available || storageError || plan.isPending} onChange={event => {
        epoch.current++; controller.current?.abort(); plan.reset(); setConfirmation(''); setTarget(event.target.value);
      }}>
        <option value="">{t('worldv2.activationSelect')}</option>
        {candidates.map(item => <option key={item.worldId} value={item.worldId}>{item.levelName}</option>)}
      </select>
    </label>
    <button className="button button--secondary" disabled={!available || storageError || !target || plan.isPending}
      onClick={() => plan.mutate(target)}>{t(plan.isPending ? 'worldv2.checking' : 'worldv2.activationCheck')}</button>
    {!available ? <p className="muted">{t('worldv2.activationPending')}</p> : null}
    {currentPlan ? <div role="status"><strong>{currentPlan.levelName}</strong>
      <p>{t('worldv2.activationPlanOnly')}</p>
      <p>{t('worldv2.activationFrom', { name: library.items.find(item => item.worldId === currentPlan.currentWorldId)?.levelName ?? currentPlan.currentWorldId })}</p>
      <label>{t('worldv2.activationName')}<input value={confirmation} maxLength={128} onChange={event => setConfirmation(event.target.value)} /></label>
      <button className="button button--primary" disabled={!available || !currentPlan.executionAvailable || confirmation !== currentPlan.levelName || storageError || submission.isPending}
        onClick={begin}>{t('worldv2.activationSubmit')}</button></div> : null}
    </> : <div className="page-stack">
      <p><strong>{pending.body.confirmWorldName}</strong></p>
      {!pending.operationId ? <><p role="status">{t(submission.isPending ? 'worldv2.submitting' : 'worldv2.unknown')}</p>
        <button className="button button--secondary" disabled={submission.isPending || generationPending} onClick={() => send(pending)}>{t('worldv2.confirmOriginal')}</button></> : <>
        <p>{t('worldv2.operationId')}: <code>{pending.operationId}</code></p>
        {freshOperation && bound && observed ? <p role="status">{t(`worldv2.state.${observed.state}`)}</p> : <p role="status">{t(operation.isError ? 'worldv2.inspect' : 'worldv2.checking')}</p>}
        {observed && (!bound || observed.state === 'failed' || observed.state === 'interrupted' || observed.state === 'succeeded' && !succeeded) ? <p role="alert">{t('worldv2.inspect')}</p> : null}
        {succeeded && !verified ? <p role="status">{t(verification.isError || verification.data && !verification.isFetching ? 'worldv2.inspect' : 'worldv2.verifyList')}</p> : null}
        {verified ? <><p role="status">{t('worldv2.activationSuccess')}</p><button className="button button--secondary" onClick={() => {
          try {
            if (restore(storageKey, library.serverId).pending?.key !== pending.key) throw new Error('pending-request-changed');
            sessionStorage.removeItem(storageKey);
          } catch { setStorageError(true); return; }
          pendingRef.current = null; setPending(null); setTarget(''); setConfirmation(''); plan.reset(); submission.reset();
          void client.invalidateQueries({ queryKey: ['world-library', library.serverId] });
        }}>{t('worldv2.done')}</button></> : null}
        <button className="button button--secondary" onClick={() => { void operation.refetch(); if (succeeded) void verification.refetch(); }}>{t('worldv2.refresh')}</button>
      </>}
    </div>}
    {storageError ? <p role="alert" className="inline-warning">{t('worldv2.activationStorage')}</p> : null}
    {message ? <p role="alert" className="inline-warning">{errorMessage(message)}</p> : null}
  </div>;
}
