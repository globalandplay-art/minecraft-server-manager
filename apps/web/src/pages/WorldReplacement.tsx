import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Value } from '@sinclair/typebox/value';
import { worldReplacementApprovalSchema, type WorldReplacementApproval } from '@mcsm/contracts';
import { api, errorMessage, shouldRetry } from '../api';

type Pending = { version: 1; serverId: string; key: string; body: WorldReplacementApproval; operationId?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function read(key: string, serverId: string): { pending: Pending | null; blocked: boolean } {
  try {
    const raw = sessionStorage.getItem(key); if (raw === null) return { pending: null, blocked: false };
    const value = JSON.parse(raw) as Pending;
    if (!value || value.version !== 1 || value.serverId !== serverId || typeof value.key !== 'string' || !uuid.test(value.key) ||
        !Value.Check(worldReplacementApprovalSchema, value.body) ||
        (value.operationId !== undefined && (typeof value.operationId !== 'string' || !uuid.test(value.operationId)))) return { pending: null, blocked: true };
    return { pending: value, blocked: false };
  } catch { return { pending: null, blocked: true }; }
}
type Props = { serverId: string; uploadId: string | null; onLifecycle?: () => void };
export function WorldReplacement(props: Props) { return <ReplacementInstance key={props.serverId} {...props} />; }
function ReplacementInstance({ serverId, uploadId, onLifecycle }: Props) {
  const { t } = useTranslation(), client = useQueryClient(), storageKey = `lt.pendingWorldReplacement.${serverId}`;
  const [initial] = useState(() => read(storageKey, serverId));
  const [pending, setPending] = useState(initial.pending), [blocked, setBlocked] = useState(initial.blocked);
  const [confirmation, setConfirmation] = useState('');
  const mounted = useRef(true), sending = useRef(false), verifying = useRef(false), notified = useRef<string | null>(null), epoch = useRef(0), request = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; request.current?.abort(); }; }, []);
  const plan = useMutation({ retry: false, mutationFn: async (id: string) => {
    request.current?.abort(); const abort = new AbortController(); request.current = abort; const current = ++epoch.current;
    const result = await api.worldReplacementPlan(serverId, id, abort.signal);
    if (abort.signal.aborted || epoch.current !== current) throw new Error(t('worldv2.activationDiscarded'));
    return result;
  } });
  useEffect(() => { epoch.current++; request.current?.abort(); setConfirmation(''); plan.reset(); }, [uploadId, plan.reset]);
  const submit = useMutation({ retry: false, mutationFn: async (value: Pending) => {
    const response = await api.replaceWorld(value.serverId, value.body, value.key), operation = response.data.operation;
    if (operation.serverId !== value.serverId || operation.kind !== 'world-replace' || !uuid.test(operation.id)) throw new Error(t('worldv2.inspect'));
    return operation;
  }, onSuccess: (operation, value) => {
    const next = { ...value, operationId: operation.id };
    try {
      const saved = read(storageKey, value.serverId);
      if (saved.blocked || saved.pending?.key !== value.key || JSON.stringify(saved.pending.body) !== JSON.stringify(value.body) ||
          saved.pending.operationId !== undefined && saved.pending.operationId !== operation.id) throw new Error('pending-request-changed');
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch { if (mounted.current) setBlocked(true); }
    if (mounted.current) { setPending(next); onLifecycle?.(); }
  }, onSettled: () => { sending.current = false; } });
  const send = (value: Pending) => { if (!sending.current) { sending.current = true; submit.mutate(value); } };
  const operation = useQuery({ queryKey: ['replacement-operation', serverId, pending?.operationId],
    queryFn: ({ signal }) => api.operation(pending!.operationId!, signal), enabled: Boolean(pending?.operationId), retry: shouldRetry,
    staleTime: 0, refetchOnMount: 'always',
    refetchInterval: query => ['succeeded', 'failed', 'interrupted'].includes(query.state.data?.data.state ?? '') ? false : 1000 });
  const observed = operation.data?.data;
  const bound = observed?.id === pending?.operationId && observed?.serverId === serverId && observed?.kind === 'world-replace';
  const fresh = operation.isSuccess && operation.isFetchedAfterMount && !operation.isFetching;
  useEffect(() => {
    if (!fresh || !bound || !observed || !['succeeded', 'failed', 'interrupted'].includes(observed.state) || notified.current === observed.id) return;
    notified.current = observed.id; onLifecycle?.();
  }, [fresh, bound, observed, onLifecycle]);
  const verify = useMutation({ retry: false, mutationFn: (id: string) => api.verifyWorldReplacement(serverId, id),
    onSettled: () => { verifying.current = false; } });
  const receipt = verify.data?.data;
  const proofBound = verify.isSuccess && receipt?.id === pending?.operationId && receipt?.serverId === serverId && receipt?.kind === 'world-replace' &&
    receipt.state === 'succeeded' && receipt.result?.resourceId?.startsWith('worldv2-') && receipt.result.resourceId !== pending?.body.currentWorldId;
  const final = useQuery({ queryKey: ['replacement-final-list', serverId, pending?.operationId, verify.submittedAt],
    queryFn: ({ signal }) => api.worldLibrary(serverId, signal), enabled: Boolean(proofBound), retry: shouldRetry, staleTime: 0, refetchOnMount: 'always' });
  const verified = proofBound && final.isSuccess && final.isFetchedAfterMount && !final.isFetching && final.data.data.serverId === serverId &&
    final.data.data.state === 'ready' && final.data.data.activeWorldId === receipt.result?.resourceId &&
    final.data.data.items.some(item => item.worldId === receipt.result?.resourceId && item.state === 'present' && item.levelName === pending?.body.confirmWorldName) &&
    final.data.data.items.some(item => item.worldId === pending?.body.currentWorldId && item.state === 'retired');
  const current = plan.data?.data.uploadId === uploadId ? plan.data.data : undefined;
  const begin = () => {
    if (!current?.executionAvailable || current.unavailableReason !== null || pending || blocked || confirmation !== current.currentWorldName ||
        !window.confirm(t('worldv2.replacement.confirm', { name: current.currentWorldName }))) return;
    const value: Pending = { version: 1, serverId, key: crypto.randomUUID(), body: {
      uploadId: current.uploadId, uploadRevision: current.uploadRevision, libraryRevision: current.libraryRevision,
      currentWorldId: current.currentWorldId, currentWorldRevision: current.currentWorldRevision, currentContentRevision: current.currentContentRevision,
      propertiesRevision: current.propertiesRevision, confirmWorldName: confirmation } };
    try {
      if (sessionStorage.getItem(storageKey) !== null) throw new Error('pending-request-exists');
      sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch { setBlocked(true); return; }
    setPending(value); send(value);
  };
  const error = plan.error ?? submit.error ?? operation.error ?? verify.error ?? final.error;
  return <details open={pending ? true : undefined} className="page-stack">
    <summary>{t('worldv2.replacement.title')}</summary><p>{t('worldv2.replacement.help')}</p>
    {!pending ? <>
      <button className="button button--secondary" disabled={!uploadId || blocked || plan.isPending} onClick={() => plan.mutate(uploadId!)}>{t('worldv2.replacement.check')}</button>
      {current ? <div role="status"><p>{t('worldv2.activationFrom', { name: current.currentWorldName })}</p>
        {!current.executionAvailable ? <p>{t('worldv2.replacement.unavailable')}</p> : <>
          <label>{t('worldv2.replacement.name')}<input value={confirmation} maxLength={128} onChange={event => setConfirmation(event.target.value)} /></label>
          <button className="button button--danger" disabled={blocked || confirmation !== current.currentWorldName || submit.isPending} onClick={begin}>{t('worldv2.replacement.submit')}</button>
        </>}
      </div> : null}
    </> : <div className="page-stack"><strong>{pending.body.confirmWorldName}</strong>
      {!pending.operationId ? <><p role="status">{t(submit.isPending ? 'worldv2.submitting' : 'worldv2.unknown')}</p>
        <button className="button button--secondary" disabled={blocked || submit.isPending} onClick={() => send(pending)}>{t('worldv2.confirmOriginal')}</button></> : <>
        <p style={{ overflowWrap: 'anywhere' }}>{t('worldv2.operationId')}: <code>{pending.operationId}</code></p>
        {!verified ? <p role="status">{t('worldv2.replacement.awaitVerification')}</p> : null}
        {fresh && bound && ['succeeded', 'interrupted'].includes(observed!.state) && !verified ?
          <button className="button button--secondary" disabled={blocked || verify.isPending} onClick={() => {
            if (!verifying.current) { verifying.current = true; verify.mutate(pending.operationId!); }
          }}>{t(verify.isPending ? 'worldv2.checking' : 'worldv2.replacement.verify')}</button> : null}
        {fresh && (!bound || observed?.state === 'failed') ? <p role="alert">{t('worldv2.inspect')}</p> : null}
        {verified ? <><p role="status">{t('worldv2.replacement.success')}</p><button className="button button--secondary" onClick={() => {
          try {
            const saved = read(storageKey, serverId);
            if (saved.blocked || saved.pending?.key !== pending.key || JSON.stringify(saved.pending.body) !== JSON.stringify(pending.body) ||
                saved.pending.operationId !== pending.operationId) throw new Error('pending-request-changed');
            sessionStorage.removeItem(storageKey);
          } catch { setBlocked(true); return; }
          setPending(null); setConfirmation(''); plan.reset(); submit.reset(); verify.reset(); onLifecycle?.();
          for (const key of [['world-library', serverId], ['worlds', serverId], ['servers']]) void client.invalidateQueries({ queryKey: key });
        }}>{t('worldv2.done')}</button></> : null}
      </>}
    </div>}
    {blocked ? <p role="alert">{t('worldv2.activationStorage')}</p> : null}
    {verify.isSuccess && !proofBound || final.isSuccess && !final.isFetching && !verified ? <p role="alert">{t('worldv2.inspect')}</p> : null}
    {error ? <p role="alert">{errorMessage(error)}</p> : null}
  </details>;
}
