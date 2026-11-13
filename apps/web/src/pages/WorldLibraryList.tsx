import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errorMessage, shouldRetry } from '../api';
import { WorldActivation } from './WorldActivation';

function StoppedRevisionInspection({ serverId, worldId }: { serverId: string; worldId: string }) {
  const { t } = useTranslation();
  const inspection = useMutation({ retry: false, mutationFn: async () => {
    const result = await api.inspectStoppedWorldRevision(serverId);
    if (result.data.serverId !== serverId || result.data.worldId !== worldId) throw new Error(t('worldv2.inspect'));
    return result;
  } });
  const confirmation = useMutation({ retry: false, mutationFn: async (stopOperationId: string) => {
    const result = await api.inspectStoppedWorldRevision(serverId, stopOperationId);
    if (result.data.serverId !== serverId || result.data.worldId !== worldId || result.data.operationId !== stopOperationId ||
        !result.data.confirmationRecorded) {
      throw new Error(t('worldv2.inspect'));
    }
    return result;
  } });
  const busy = inspection.isPending || confirmation.isPending;
  const recorded = confirmation.isSuccess || inspection.data?.data.confirmationRecorded === true;
  return <div className="page-stack">
    <button className="button button--secondary" disabled={busy} onClick={() => { confirmation.reset(); inspection.mutate(); }}>
      {t(inspection.isPending ? 'worldv2.checking' : 'worldv2.inspectStoppedRevision')}
    </button>
    {inspection.isSuccess && !recorded ? <>
      <p role="status">{t('worldv2.stoppedRevisionChecked')}</p>
      <button className="button button--secondary" disabled={busy} onClick={() => confirmation.mutate(inspection.data.data.operationId)}>
        {t(confirmation.isPending ? 'worldv2.checking' : 'worldv2.confirmStoppedRevision')}
      </button>
    </> : null}
    {recorded ? <p role="status">{t('worldv2.stoppedRevisionConfirmed')}</p> : null}
    {confirmation.isError ? <p role="alert" className="inline-warning">{errorMessage(confirmation.error)}</p> : null}
    {inspection.isError ? <p role="alert" className="inline-warning">{errorMessage(inspection.error)}</p> : null}
  </div>;
}

export function WorldLibraryList({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ['world-library', serverId], queryFn: ({ signal }) => api.worldLibrary(serverId, signal), retry: shouldRetry });
  const stoppedWorldId = query.data?.data.stoppedRevisionInspectionWorldId ?? query.data?.data.activeWorldId;
  return <section className="resource-card page-stack">
    <div className="resource-card__heading"><h2>{t('worldv2.listTitle')}</h2>
      <button className="button button--secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>{t('worldv2.refresh')}</button></div>
    <p className="muted">{t('worldv2.listHelp')}</p>
    {query.isPending ? <p>{t('worldv2.checking')}</p> : null}
    {query.isError ? <p className="inline-warning" role="alert">{errorMessage(query.error)}</p> : null}
    {query.data?.data.state === 'inspection-required' ? <p className="inline-warning">{t('worldv2.inspect')}</p> : null}
    {query.data?.data.items.map(world => <div className="resource-card__heading" key={world.worldId}>
      <div><strong>{world.levelName}</strong><p className="muted" style={{ overflowWrap: 'anywhere' }}><code>{world.worldId}</code></p></div>
      <span className="phase-badge">{t(world.origin === 'generation' && query.data.data.state === 'inspection-required' ? 'worldv2.generationPending' : world.state === 'retired' ? 'worldv2.retired' : world.worldId === query.data.data.activeWorldId ? 'worldv2.active' : 'worldv2.inactive')}</span>
    </div>)}
    {query.data?.data.serverId === serverId && query.data.data.stoppedRevisionInspectionAvailable && stoppedWorldId
      ? <StoppedRevisionInspection key={`${serverId}:${query.data.data.revision}:${stoppedWorldId}`} serverId={serverId} worldId={stoppedWorldId} /> : null}
    {query.data ? <WorldActivation library={query.data.data} /> : null}
  </section>;
}
