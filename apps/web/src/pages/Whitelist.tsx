import { useQuery } from '@tanstack/react-query';
import type { ServersResponse } from '@mcsm/contracts';
import { api, errorMessage } from '../api';
import { EmptyState, ErrorState, PageHeading } from '../components/Ui';
const flag = (value: boolean | null) => value === null ? '未提供' : value ? '启用' : '关闭';
const reasons: Record<string, string> = {
  'version-unsupported': '此服务端类型或版本尚未验证白名单读取规则。',
  'registration-unavailable': '尚未取得可信的注册目录身份。',
  'server-state-unavailable': '服务器当前状态无法安全核验。',
  'whitelist-file-missing': '没有已保存的白名单文件，不能据此认定名单为空。',
  'whitelist-read-unsafe': '白名单文件或目录无法安全读取。',
  'snapshot-changed': '读取期间配置发生变化，请重新刷新。',
  'recovery-required': '实例需要先完成恢复核验。', 'operation-active': '实例有其他操作正在进行。',
};
export function WhitelistPage({ server }: { server?: ServersResponse['data']['items'][number] | undefined }) {
  const id = server?.server.id;
  const query = useQuery({ queryKey: ['whitelist', id], queryFn: ({ signal }) => api.whitelist(id!, signal),
    enabled: Boolean(id), retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const data = query.data?.data;
  return <div className="page-stack">
    <PageHeading eyebrow="SAVED WHITELIST" title="白名单" description="查看此服务器已保存的配置和成员；配置值不代表运行时已经生效。" />
    {!id ? <EmptyState title="请选择服务器" description="选择一个实例查看白名单。" /> : <>
      {query.isPending ? <p role="status">正在读取白名单…</p> : null}
      {query.isError ? <ErrorState description={errorMessage(query.error)} retry={() => void query.refetch()} /> : null}
      {data ? <section className="settings-panel" aria-label="已保存的白名单">
        {query.isError ? <p role="alert">下面是旧快照，尚未取得更新结果。</p> : null}
        <p>配置中的白名单：{flag(data.configuredEnabled)} · 强制执行：{flag(data.configuredEnforced)}</p>
        <p>运行时是否生效：未核验</p>
        <p>数据时间：{new Date(data.sampledAt).toLocaleString()} · 只读快照</p>
        <p>成员 UUID 来自已保存名单，未经账号查询验证。</p>
        {data.availability === 'unavailable' ? <p role="status">{reasons[data.reason ?? ''] ?? '白名单暂不可用。'}</p> :
          data.items.length === 0 ? <p>已确认保存的名单为空。</p> :
          <ul>{data.items.map(member => <li key={member.uuid}><strong>{member.name}</strong> · <span style={{ overflowWrap: 'anywhere' }}>{member.uuid}</span></li>)}</ul>}
        <p>成员添加和删除尚未开放；当前不会改变成员名单。</p>
      </section> : null}
      <button className="button button--secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>刷新白名单</button>
    </>}
  </div>;
}
