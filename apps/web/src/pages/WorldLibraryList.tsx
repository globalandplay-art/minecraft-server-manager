import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errorMessage, shouldRetry } from '../api';

export function WorldLibraryList({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ['world-library', serverId], queryFn: ({ signal }) => api.worldLibrary(serverId, signal), retry: shouldRetry });
  return <section className="resource-card page-stack">
    <div className="resource-card__heading"><h2>{t('worldv2.listTitle')}</h2>
      <button className="button button--secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>{t('worldv2.refresh')}</button></div>
    <p className="muted">{t('worldv2.listHelp')}</p>
    {query.isPending ? <p>{t('worldv2.checking')}</p> : null}
    {query.isError ? <p className="inline-warning" role="alert">{errorMessage(query.error)}</p> : null}
    {query.data?.data.state === 'inspection-required' ? <p className="inline-warning">{t('worldv2.inspect')}</p> : null}
    {query.data?.data.items.map(world => <div className="resource-card__heading" key={world.worldId}>
      <div><strong>{world.levelName}</strong><p className="muted" style={{ overflowWrap: 'anywhere' }}><code>{world.worldId}</code></p></div>
      <span className="phase-badge">{t(world.state === 'retired' ? 'worldv2.retired' : world.worldId === query.data.data.activeWorldId ? 'worldv2.active' : 'worldv2.inactive')}</span>
    </div>)}
    <p className="muted">{t('worldv2.activationPending')}</p>
  </section>;
}
