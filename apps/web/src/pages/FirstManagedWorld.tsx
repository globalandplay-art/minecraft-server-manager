import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errorMessage } from '../api';

type Pending = { phase: 'start-sent' | 'running' | 'stop-sent' | 'stopped'; key: string; startOperationId?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function FirstManagedWorld({ serverId, executionOperationId, resumeOnly = false }: {
  serverId: string; executionOperationId: string; resumeOnly?: boolean;
}) {
  const { t } = useTranslation();
  const storageKey = `lt.firstManagedWorld.${serverId}.${executionOperationId}`;
  const [blocked, setBlocked] = useState(false);
  const [pending, setPending] = useState<Pending | null>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return null;
      const value = JSON.parse(raw) as Pending;
      if (!value || !['start-sent', 'running', 'stop-sent', 'stopped'].includes(value.phase) || !uuid.test(value.key) ||
          value.phase !== 'start-sent' && (typeof value.startOperationId !== 'string' || !uuid.test(value.startOperationId))) {
        return { phase: 'start-sent', key: '' };
      }
      return value;
    } catch { return { phase: 'start-sent', key: '' }; }
  });
  const sending = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const save = (value: Pending) => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
      if (sessionStorage.getItem(storageKey) !== JSON.stringify(value)) throw new Error('readback');
      setPending(value);
      return true;
    } catch { setBlocked(true); return false; }
  };
  const action = useMutation({ retry: false, mutationFn: async (request: Pending) => {
    const starting = request.phase === 'start-sent';
    const response = starting
      ? await api.startFirstManagedWorld(serverId, executionOperationId, request.key)
      : await api.stopFirstManagedWorld(serverId, request.startOperationId!, request.key);
    const operation = response.data.operation;
    if (operation.serverId !== serverId || operation.kind !== (starting ? 'start' : 'stop') || !uuid.test(operation.id)) {
      throw new Error(t('worldv2.firstManaged.unknown'));
    }
    return { request, operation };
  }, onSuccess: ({ request, operation }) => {
    if (!mounted.current) return;
    save({ phase: request.phase === 'start-sent' ? 'running' : 'stopped', key: request.key,
      startOperationId: request.phase === 'start-sent' ? operation.id : request.startOperationId! });
  }, onSettled: () => { sending.current = false; } });
  const submit = (phase: 'start-sent' | 'stop-sent') => {
    if (sending.current || blocked || action.isPending) return;
    if (phase === 'start-sent' ? pending !== null : pending?.phase !== 'running') return;
    const next: Pending = { phase, key: crypto.randomUUID(),
      ...(phase === 'stop-sent' ? { startOperationId: pending!.startOperationId } : {}) };
    if (!save(next)) return;
    sending.current = true;
    action.mutate(next);
  };
  const unknown = pending?.phase === 'start-sent' || pending?.phase === 'stop-sent';
  return <div className="page-stack">
    <p className="muted">{t('worldv2.firstManaged.help')}</p>
    {!pending && !resumeOnly ? <button className="button button--secondary" disabled={blocked || action.isPending}
      onClick={() => submit('start-sent')}>{t('worldv2.firstManaged.start')}</button> : null}
    {pending?.phase === 'running' ? <>
      <p role="status">{t('worldv2.firstManaged.running')}</p>
      <button className="button button--secondary" disabled={blocked || action.isPending}
        onClick={() => submit('stop-sent')}>{t('worldv2.firstManaged.stop')}</button>
    </> : null}
    {pending?.phase === 'stopped' ? <p role="status">{t('worldv2.firstManaged.stopped')}</p> : null}
    {action.isPending ? <p role="status">{t('worldv2.checking')}</p> : null}
    {unknown && !action.isPending || blocked ? <p role="alert">{t('worldv2.firstManaged.unknown')}</p> : null}
    {action.error ? <p role="alert" className="inline-warning">{errorMessage(action.error)}</p> : null}
  </div>;
}
