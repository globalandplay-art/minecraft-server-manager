import { useQuery } from '@tanstack/react-query';
import type { Operation, PropertiesResponse, PropertiesWriteRequest, ServersResponse } from '@mcsm/contracts';
import { useEffect, useRef, useState } from 'react';
import { api, ApiClientError, errorMessage } from '../api';
import { PropertiesFields } from '../components/PropertiesFields';
import { EmptyState, ErrorState, PageHeading } from '../components/Ui';

type Snapshot = PropertiesResponse['data'];
type Receipt = { body: PropertiesWriteRequest; revision: string; key: string; operationId?: string };
const valuesOf = (snapshot: Snapshot) => Object.fromEntries(Object.entries(snapshot.fields).map(([key, value]) => [key, value === null ? '' : String(value)]));

export function PropertiesPage({ server }: { server?: ServersResponse['data']['items'][number] | undefined }) {
  const id = server?.server.id;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [baseline, setBaseline] = useState<Snapshot>();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [offline, setOffline] = useState(false);
  const [receipt, setReceipt] = useState<Receipt>();
  const [sending, setSending] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const query = useQuery({ queryKey: ['properties', id], queryFn: ({ signal }) => api.properties(id!, signal),
    enabled: Boolean(id && server?.capabilities.properties), retry: false, refetchOnWindowFocus: false });
  useEffect(() => { if (query.data && !baseline) setBaseline(query.data.data); }, [query.data, baseline]);
  const op = useQuery({ queryKey: ['properties-operation', id, receipt?.operationId],
    queryFn: ({ signal }) => api.operation(receipt!.operationId!, signal), enabled: Boolean(receipt?.operationId), retry: false,
    refetchInterval: (q) => document.hidden || ['succeeded', 'failed', 'interrupted'].includes(q.state.data?.data.state ?? '') ? false : 1000 });
  const handled = useRef<string | undefined>(undefined);
  useEffect(() => {
    const result: Operation | undefined = op.data?.data;
    if (!result || !receipt?.operationId || result.id !== receipt.operationId || result.serverId !== id || result.kind !== 'properties-write') return;
    if (handled.current === result.id || !['succeeded', 'failed', 'interrupted'].includes(result.state)) return;
    handled.current = result.id;
    if (result.state === 'succeeded' && !result.error && result.result?.resourceId) {
      setMessage('配置已保存。需要重启服务器才能生效；请到 Servers 显式启动或重启。');
      setEdits({}); setConfirm(false); setOffline(false); setReceipt(undefined);
      void query.refetch().then((fresh) => { if (mounted.current && fresh.data && !fresh.isError) setBaseline(fresh.data.data); });
    } else {
      const blocked = result.state !== 'failed' || result.error?.code === 'RECOVERY_REQUIRED';
      setMessage(blocked ? '配置操作未安全确认，保留恢复门控。请核对操作记录，不能再次保存。' : '配置保存失败；草稿保留，请刷新并重新确认。');
      setUnknown(blocked);
      if (result.error?.code === 'PROPERTIES_REVISION_CONFLICT') setNeedsRefresh(true);
      if (!blocked) setReceipt(undefined);
      setConfirm(false);
    }
  }, [op.data, receipt, id, query]);
  const frozen = sending || Boolean(receipt);
  const observedAge = server ? now - Date.parse(server.status.observedAt) : Infinity;
  const ready = server?.status.state === 'stopped' && server.status.ownership === 'none' &&
    !server.status.recoveryRequired && !server.status.activeOperationId && observedAge >= 0 && observedAge <= 15_000 &&
    !needsRefresh && !query.isError && !query.isFetching;
  const baseValues = baseline ? valuesOf(baseline) : {};
  const values = { ...baseValues, ...edits };
  const changes = Object.fromEntries(Object.entries(edits).filter(([key, value]) => baseline?.fieldRules[key]?.editable && value !== baseValues[key]));
  async function refresh() {
    setConfirm(false); setOffline(false);
    const fresh = await query.refetch();
    if (mounted.current && fresh.data && !fresh.isError) {
      setEdits((old) => Object.fromEntries(Object.entries(old).filter(([key, value]) =>
        baseline?.fieldRules[key]?.editable && value !== baseValues[key] && fresh.data.data.fieldRules[key]?.editable)));
      setBaseline(fresh.data.data); setNeedsRefresh(false); setConfirm(false); setOffline(false);
    }
  }
  async function submit(existing?: Receipt) {
    if (!id || !baseline || sending || (!existing && (!ready || !confirm || !Object.keys(changes).length))) return;
    const next = existing ?? { body: { changes, confirmOfflineIdentity: offline }, revision: baseline.revision, key: crypto.randomUUID() };
    setReceipt(next); setSending(true); setMessage('正在提交；尚未确认配置已保存。'); setUnknown(false);
    try {
      const response = await api.saveProperties(id, next.body, next.revision, next.key);
      if (!mounted.current) return;
      if (response.data.operation.serverId !== id || response.data.operation.kind !== 'properties-write') throw new Error('配置操作响应不匹配');
      setReceipt({ ...next, operationId: response.data.operation.id }); setMessage('请求已受理，正在核验配置写入…');
    } catch (error) {
      if (!mounted.current) return;
      const definite = error instanceof ApiClientError && error.kind === 'http' && error.status !== undefined && error.status >= 400 && error.status < 500;
      setUnknown(!definite); setMessage(definite ? `${errorMessage(error)}。草稿保留，请刷新配置并重新确认。` : '响应不确定，不能认定成功或失败。禁止新请求；可明确使用原请求和原幂等键核对。');
      if (definite && error.code === 'RECOVERY_REQUIRED') {
        setMessage('配置需要人工恢复核验。保留请求与草稿，禁止再次保存。');
      } else if (definite) {
        setReceipt(undefined); setConfirm(false);
        if (error.code === 'PROPERTIES_REVISION_CONFLICT') setNeedsRefresh(true);
      }
    } finally { if (mounted.current) setSending(false); }
  }
  return <div className="page-stack properties-page">
    <PageHeading eyebrow="SERVER CONFIGURATION" title="Server Properties" description="只编辑允许字段；保存前保护备份，保存后由你明确启动或重启。" />
    <p>本地 API：127.0.0.1:8080。当前没有远程登录入口。</p>
    {!server ? <EmptyState title="请选择服务器" description="选择实例后查看配置。" /> : !server.capabilities.properties ?
      <EmptyState title="此实例未开放配置管理" description="由后端能力决定可用功能。" /> : query.isPending && !baseline ? <p role="status">正在读取配置…</p> :
      !baseline ? <ErrorState description={errorMessage(query.error)} retry={() => void refresh()} /> : <>
        {!ready ? <p role="status">需要已确认停止、无其他操作且没有恢复锁的实例才能保存。请在 Servers 操作后刷新状态。</p> : null}
        <PropertiesFields values={values} rules={baseline.fieldRules} disabled={frozen} onChange={(key, value) => {
          setEdits((old) => {
            const next = { ...old };
            if (value === baseValues[key]) delete next[key]; else next[key] = value;
            return next;
          }); setConfirm(false); setOffline(false); setMessage('');
        }} />
        {Object.keys(changes).length ? <section className="settings-panel" aria-label="配置变更确认">
          <h2>待保存变更</h2><ul>{Object.entries(changes).map(([key, value]) => <li key={key}>{key}：{baseValues[key] || '未提供'} → {value || '空值'}（需要重启）</li>)}</ul>
          {changes['online-mode'] === 'false' ? <label><input type="checkbox" disabled={frozen} checked={offline} onChange={(e) => setOffline(e.target.checked)} />我确认关闭在线验证会影响玩家身份验证，接受此设置风险。</label> : null}
          <label><input type="checkbox" disabled={frozen} checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />确认以上变更，创建保护备份后保存；不自动启动或重启。</label>
        </section> : null}
        <button className="button button--secondary" disabled={frozen || query.isFetching} onClick={() => void refresh()}>刷新当前配置，保留草稿</button>
        <button className="button" disabled={!ready || frozen || !confirm || !Object.keys(changes).length || (changes['online-mode'] === 'false' && !offline)} onClick={() => void submit()}>备份并保存配置</button>
        {unknown && receipt && !receipt.operationId ? <button className="button button--secondary" disabled={sending} onClick={() => void submit(receipt)}>使用原请求核对结果</button> : null}
        {receipt?.operationId ? <p>操作 ID：{receipt.operationId}。离开页面前请等待结果；不确定时先查操作记录，不要重复保存。</p> : null}
        {op.isError ? <ErrorState description="暂时无法读取操作结果；配置保存状态未确认。" retry={() => void op.refetch()} /> : null}
        {query.isError && baseline ? <p role="alert">配置刷新失败；保留草稿，尚未取得新的确认依据。</p> : null}
        {message ? <p role="status">{message}</p> : null}
      </>}
  </div>;
}
