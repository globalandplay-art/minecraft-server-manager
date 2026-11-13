import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Value } from '@sinclair/typebox/value';
import { worldGenerationTargetSchema, type WorldGenerationTarget } from '@mcsm/contracts';
import { api, errorMessage, shouldRetry } from '../api';
import { FirstManagedWorld } from './FirstManagedWorld';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
type Pending = { version: 1; serverId: string; key: string; target: WorldGenerationTarget; operationId?: string };
function read(storageKey: string, serverId: string): { pending: Pending | null; blocked: boolean } {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (raw === null) return { pending: null, blocked: false };
    const value = JSON.parse(raw) as Pending;
    if (!value || value.version !== 1 || value.serverId !== serverId || typeof value.key !== 'string' || !uuid.test(value.key) ||
        !Value.Check(worldGenerationTargetSchema, value.target) ||
        value.operationId !== undefined && (typeof value.operationId !== 'string' || !uuid.test(value.operationId))) throw new Error('invalid');
    return { pending: value, blocked: false };
  } catch { return { pending: null, blocked: true }; }
}

export function WorldGeneration({ serverId }: { serverId: string }) {
  return <GenerationInstance key={serverId} serverId={serverId} />;
}

function GenerationInstance({ serverId }: { serverId: string }) {
  const { t } = useTranslation(), client = useQueryClient();
  const storageKey = `lt.pendingWorldGeneration.${serverId}`;
  const [initial] = useState(() => read(storageKey, serverId));
  const [pending, setPending] = useState(initial.pending), [blocked, setBlocked] = useState(initial.blocked);
  const [confirmed, setConfirmed] = useState(false);
  const mounted = useRef(true), sending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const target = useMutation({ retry: false, mutationFn: () => api.worldGenerationTarget(serverId) });
  const dispatch = useMutation({ retry: false, mutationFn: async (value: Pending) => {
    const result = await api.generateWorld(value.serverId, value.target, value.key);
    const operation = result.data.operation;
    if (operation.serverId !== value.serverId || operation.kind !== 'world-create' || !uuid.test(operation.id)) throw new Error(t('worldv2.generation.unknown'));
    return operation.id;
  }, onSuccess: (operationId, value) => {
    const next = { ...value, operationId };
    try {
      const saved = read(storageKey, serverId);
      if (saved.blocked || JSON.stringify(saved.pending) !== JSON.stringify(value)) throw new Error('changed');
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch { if (mounted.current) setBlocked(true); }
    if (mounted.current) setPending(next);
  }, onSettled: () => { sending.current = false; } });
  const send = () => {
    if (!confirmed || !target.data || pending || blocked || sending.current) return;
    const value: Pending = { version: 1, serverId, key: crypto.randomUUID(), target: target.data.data };
    try {
      const saved = read(storageKey, serverId);
      if (saved.blocked || saved.pending) throw new Error('existing');
      sessionStorage.setItem(storageKey, JSON.stringify(value));
      if (JSON.stringify(read(storageKey, serverId).pending) !== JSON.stringify(value)) throw new Error('readback');
    } catch { setBlocked(true); return; }
    sending.current = true; setPending(value); dispatch.mutate(value);
  };
  const observation = useQuery({ queryKey: ['world-generation-operation', serverId, pending?.operationId],
    queryFn: ({ signal }) => api.operation(pending!.operationId!, signal), enabled: Boolean(pending?.operationId), retry: shouldRetry,
    refetchInterval: query => ['succeeded', 'failed', 'interrupted'].includes(query.state.data?.data.state ?? '') ? false : 1000 });
  const observed = observation.data?.data;
  const bound = observed?.id === pending?.operationId && observed?.serverId === serverId && observed?.kind === 'world-create';
  const finalize = useMutation({ retry: false, mutationFn: async () => {
    if (!pending?.operationId || !bound) throw new Error(t('worldv2.generation.unknown'));
    const response = await api.finalizeWorldGeneration(serverId, pending.operationId);
    if (response.data.serverId !== serverId || response.data.operationId !== pending.operationId || response.data.worldId !== pending.target.worldId) throw new Error(t('worldv2.generation.unknown'));
    return response;
  }, onSuccess: () => { if (mounted.current) void client.invalidateQueries({ queryKey: ['world-library', serverId] }); } });
  let resumeManaged = false;
  try {
    resumeManaged = Boolean(pending?.operationId && sessionStorage.getItem(`lt.firstManagedWorld.${serverId}.${pending.operationId}`));
  } catch { /* A missing local record cannot enable a new start. */ }
  return <section className="resource-card page-stack">
    <h2>{t('worldv2.generation.title')}</h2>
    <p className="muted">{t('worldv2.generation.help')}</p>
    {blocked ? <p role="alert" className="inline-warning">{t('worldv2.generation.storageBlocked')}</p> : null}
    {!pending ? <>
      <button className="button button--secondary" disabled={blocked || target.isPending} onClick={() => { setConfirmed(false); target.mutate(); }}>{t('worldv2.generation.check')}</button>
      {target.data ? <><p>{target.data.data.worldId}</p>
        <label className="checkbox-line"><input type="checkbox" checked={confirmed} disabled={blocked} onChange={event => setConfirmed(event.target.checked)} />{t('worldv2.generation.confirm')}</label>
        <button className="button button--secondary" disabled={blocked || !confirmed || dispatch.isPending} onClick={send}>{t('worldv2.generation.start')}</button></> : null}
    </> : <>
      <p>{pending.target.worldId}</p>
      {!pending.operationId ? <p role="alert" className="inline-warning">{t('worldv2.generation.unknown')}</p> : null}
      {bound ? <p role="status">{t(`worldv2.state.${observed.state}`)} / {observed.step}</p> : null}
      {observed && !bound ? <p role="alert">{t('worldv2.generation.unknown')}</p> : null}
      {bound && ['succeeded', 'interrupted'].includes(observed.state) ? <button className="button button--secondary" disabled={blocked || finalize.isPending || finalize.isSuccess} onClick={() => finalize.mutate()}>{t('worldv2.generation.finalize')}</button> : null}
      {finalize.isSuccess ? <p role="status">{t('worldv2.generation.inspected')}</p> : null}
      {pending.operationId && (finalize.isSuccess || resumeManaged) ? <FirstManagedWorld
        key={`${serverId}:${pending.operationId}`} serverId={serverId} executionOperationId={pending.operationId}
        resumeOnly={!finalize.isSuccess} /> : null}
    </>}
    {[target.error, dispatch.error, observation.error, finalize.error].filter(Boolean).map((error, index) => <p key={index} role="alert" className="inline-warning">{errorMessage(error)}</p>)}
    {bound && observed.error ? <p role="alert" className="inline-warning">{observed.error.message}</p> : null}
  </section>;
}
