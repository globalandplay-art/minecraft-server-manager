import { useQuery } from '@tanstack/react-query';
import type { ServersResponse } from '@mcsm/contracts';
import { api, errorMessage } from '../api';
import { EmptyState, ErrorState, PageHeading } from '../components/Ui';

export function CrashAnalysisPage({ server }: { server?: ServersResponse['data']['items'][number] | undefined }) {
  const id = server?.server.id;
  const query = useQuery({ queryKey: ['crash-analysis', id], queryFn: ({ signal }) => api.crashAnalysis(id!, signal),
    enabled: false, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const data = query.data?.data;
  return <div className="page-stack">
    <PageHeading eyebrow="LOCAL EVIDENCE" title="Crash Analysis" description="只读本地证据，手动读取；结果是可能原因，不自动修复或上传。" />
    {!id ? <EmptyState title="请选择服务器" description="从 Servers 选择实例。" /> : null}
    {id ? <button className="button button--secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>读取崩溃证据</button> : null}
    {query.isFetching ? <p role="status">正在安全读取…</p> : null}
    {query.isError ? <ErrorState description={errorMessage(query.error)} retry={() => void query.refetch()} /> : null}
    {data && !query.isError ? <section className="settings-panel" aria-label="崩溃分析结果">
      {data.status === 'unavailable' ? <EmptyState title="分析不可用" description="仅支持注册本地实例；Mock 不生成崩溃证据。" /> : <>
        <p>证据读取时间：{data.sampledAt ? new Date(data.sampledAt).toLocaleString() : 'N/A'}。5 秒内复用原快照；不是实时监测。</p>
        {data.incomplete ? <p role="status">证据不完整。超过64 KiB的来源仅显示覆盖信息，不分析、不输出片段。</p> : null}
        {data.conclusion === 'insufficient-evidence' ? <p>证据不足，无法给出可能原因。</p> : null}
        {data.conclusion === 'no-rule-match' ? <p>未匹配已知规则，不代表服务器健康；缺少日志也不能证明没有故障。</p> : null}
        <h2>证据覆盖</h2>
        {data.sources.length ? <ul>{data.sources.map((source) => <li key={source.id}>{source.id} · {source.source === 'latest-log' ? '最新日志' : '崩溃报告'} · {source.truncated ? '截断：未分析' : '完整来源'}</li>)}</ul> : <p>暂无可读取来源。</p>}
        {data.findings.map((finding) => <article key={finding.code}>
          <h2>{finding.title} · 可能</h2><p>{finding.guidance}</p>
          {finding.evidence.map((evidence, index) => <div key={`${evidence.sourceId}-${index}`}>
            <p>{evidence.sourceId} · 脱敏片段内第 {evidence.excerptLine} 行（不是完整文件行号）</p>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{evidence.snippet}</pre>
          </div>)}
        </article>)}
        <p>最多4个来源、每个64 KiB，固定规则分析；未知非结构化秘密不能保证全部识别。不要据此执行破坏性操作。</p>
      </>}
    </section> : null}
  </div>;
}
