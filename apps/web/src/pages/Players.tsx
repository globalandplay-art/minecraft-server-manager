import { useQuery } from '@tanstack/react-query';
import type { ServersResponse } from '@mcsm/contracts';
import { useEffect, useState } from 'react';
import { api, errorMessage, shouldRetry } from '../api';
import { EmptyState, ErrorState, PageHeading } from '../components/Ui';
import { useTranslation } from 'react-i18next';
import { formatLocalTime } from '../format';

export function PlayersPage({ server }: { server?: ServersResponse['data']['items'][number] | undefined }) {
  const { t } = useTranslation();
  const id = server?.server.id;
  const query = useQuery({ queryKey: ['players', id], queryFn: ({ signal }) => api.players(id!, signal),
    enabled: Boolean(id), retry: shouldRetry, refetchInterval: () => document.hidden ? false : 10_000,
    refetchIntervalInBackground: false });
  const data = query.data?.data;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const sampledTime = data?.sampledAt ? Date.parse(data.sampledAt) : NaN;
  const stale = Boolean(data && (now - query.dataUpdatedAt > 15_000 ||
    (Number.isFinite(sampledTime) && now - sampledTime > 15_000) || query.isPaused));
  return <div className="page-stack">
    <PageHeading eyebrow="ONLINE PLAYERS" title={t('nav.players')} description={t('players.description')} />
    {!server ? <EmptyState title={t('players.choose')} description={t('players.chooseDescription')} /> :
      query.isPending ? <p role="status">{t('players.loading')}</p> :
      query.isError ? <ErrorState description={errorMessage(query.error)} retry={() => void query.refetch()} /> :
      data?.availability === 'unavailable' ? <EmptyState title={t('players.unavailable')} description={t('players.unavailableReason', { reason: data.reason })} /> :
      data ? <section className="settings-panel" aria-label={t('players.list')}>
        {stale ? <p role="status">{t('players.stale')}</p> : null}
        <p>{t('players.count', { count: data.items.length })} · {t(stale ? 'players.previousComplete' : 'players.complete')}</p>
        <p>{t('players.sampledAt', { time: formatLocalTime(data.sampledAt) })}</p>
        {data.items.length === 0 ? <p>{t(stale ? 'players.previousEmpty' : 'players.empty')}</p> : <ul>{data.items.map((player) =>
          <li key={player.id}><strong>{player.name}</strong> · {t(stale ? 'players.previouslyOnline' : 'players.online')} · {t('players.uuidUnverified')}</li>)}</ul>}
      </section> : null}
    {server ? <button className="button button--secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>{t('players.refresh')}</button> : null}
  </div>;
}
