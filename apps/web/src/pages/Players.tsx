import { useQuery } from '@tanstack/react-query';
import type { ServersResponse } from '@mcsm/contracts';
import { useEffect, useState } from 'react';
import { api, errorMessage, shouldRetry } from '../api';
import { EmptyState, ErrorState, PageHeading } from '../components/Ui';

export function PlayersPage({ server }: { server?: ServersResponse['data']['items'][number] | undefined }) {
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
    <PageHeading eyebrow="ONLINE PLAYERS" title="Players" description="只读在线名单；来源为受管服务端 RCON。身份未验证时不推断 UUID。" />
    {!server ? <EmptyState title="请选择服务器" description="从 Servers 选择实例后查看在线玩家。" /> :
      query.isPending ? <p role="status">正在查询在线玩家…</p> :
      query.isError ? <ErrorState description={errorMessage(query.error)} retry={() => void query.refetch()} /> :
      data?.availability === 'unavailable' ? <EmptyState title="在线名单暂不可用" description={`不能据此判断无人在线。原因：${data.reason}`} /> :
      data ? <section className="settings-panel" aria-label="在线玩家名单">
        {stale ? <p role="status">旧数据：在线状态尚未重新确认。</p> : null}
        <p>{data.items.length} 位 · {stale ? '上次完整名单' : '完整名单'}</p>
        <p>采样时间：{new Date(data.sampledAt).toLocaleString()}</p>
        {data.items.length === 0 ? <p>{stale ? '上次采样没有在线玩家。' : '当前没有在线玩家。'}</p> : <ul>{data.items.map((player) =>
          <li key={player.id}><strong>{player.name}</strong> · {stale ? '上次采样在线' : '在线'} · UUID 未验证</li>)}</ul>}
      </section> : null}
    {server ? <button className="button button--secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>刷新在线名单</button> : null}
  </div>;
}
