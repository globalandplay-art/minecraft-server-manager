import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ServersResponse, WhitelistMemberRequest } from '@mcsm/contracts';
import { api, ApiClientError, errorMessage } from '../api';
import { EmptyState, ErrorState, PageHeading } from '../components/Ui';
import { LocalWhitelistPanel } from '../components/LocalWhitelistPanel';
import type { WhitelistCandidatesResponse } from '@mcsm/contracts';
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
type Props = { server?: ServersResponse['data']['items'][number] | undefined };
export function WhitelistPage(props: Props) {
  return <WhitelistPanel key={props.server?.server.id ?? 'none'} {...props} />;
}
function WhitelistPanel({ server }: Props) {
  const id = server?.server.id;
  const [name, setName] = useState('');
  const [pending, setPending] = useState<{ body: WhitelistMemberRequest; key: string } | null>(null);
  const [sending, setSending] = useState(false), [unknown, setUnknown] = useState(false), [error, setError] = useState<string | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [recoverPending, setRecoverPending] = useState(false);
  const dialog = useRef<HTMLElement>(null), refreshed = useRef<string | null>(null), inFlight = useRef(false);
  const pollCount = useRef(0);
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden');
  const lastCandidates = useRef<WhitelistCandidatesResponse | undefined>(undefined);
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', changed); return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  const query = useQuery({ queryKey: ['whitelist', id], queryFn: async ({ signal }) => {
    const response = await api.whitelist(id!, signal);
    let candidateReadFailed = false;
    if (response.data.executionMode === 'direct-rcon') {
      try { lastCandidates.current = await api.whitelistCandidates(id!, signal); }
      catch { candidateReadFailed = true; }
    }
    return { ...response, candidates: lastCandidates.current, candidateReadFailed };
  }, enabled: Boolean(id), retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
  refetchInterval: visible ? 5000 : false, refetchIntervalInBackground: false });
  const data = query.data?.data;
  const operation = useQuery({ queryKey: ['whitelist-operation', id, operationId],
    queryFn: async ({ signal }) => {
      pollCount.current++;
      const response = await api.operation(operationId!, signal);
      if (response.data.id !== operationId || response.data.serverId !== id || response.data.kind !== 'whitelist-change') throw new Error('操作绑定无法确认');
      return response;
    }, enabled: Boolean(operationId), retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
    refetchInterval: current => current.state.status === 'error' || current.state.dataUpdateCount >= 30 ||
      ['succeeded', 'failed', 'interrupted'].includes(current.state.data?.data.state ?? '') ? false : 1000 });
  const op = operation.data?.data;
  const active = operationId !== null && (!op || ['queued', 'running'].includes(op.state));
  const blocked = sending || unknown || active || op?.state === 'interrupted';
  const writable = data?.membershipWritable === true && !query.isError && !query.isFetching && !blocked;
  useEffect(() => { if (pending || recoverPending) dialog.current?.focus(); }, [pending, recoverPending]);
  useEffect(() => {
    if (op && ['succeeded', 'failed', 'interrupted'].includes(op.state) && refreshed.current !== op.id) {
      refreshed.current = op.id; void query.refetch();
    }
  }, [op, query.refetch]);
  const confirm = (action: 'add' | 'remove', player: string) => {
    if (!writable || !data?.membershipWritable || !/^[A-Za-z0-9_]{3,16}$/u.test(player)) return;
    setError(null); setPending({ body: { action, name: player, revision: data.revision, confirm: true }, key: crypto.randomUUID() });
  };
  const submit = async () => {
    if (!id || !pending || !writable || inFlight.current) return;
    inFlight.current = true; setSending(true);
    try {
      const response = await api.changeWhitelistMember(id, pending.body, pending.key);
      if (response.data.operation.serverId !== id || response.data.operation.kind !== 'whitelist-change') throw new Error('操作绑定无法确认');
      pollCount.current = 0; setOperationId(response.data.operation.id); setPending(null); setName('');
    } catch (failure) {
      // A missing response is not a failed command. Never auto-submit another key.
      const rejectedBeforeAdmission = failure instanceof ApiClientError && ['AUTH_REQUIRED', 'AUTH_REAUTH_REQUIRED',
        'CSRF_REJECTED', 'ORIGIN_REJECTED', 'VALIDATION_ERROR', 'PRECONDITION_REQUIRED', 'MEMBER_RULE_UNAVAILABLE'].includes(failure.code ?? '');
      setError(errorMessage(failure)); setUnknown(!rejectedBeforeAdmission); setPending(null);
      if (rejectedBeforeAdmission) void query.refetch();
    } finally { inFlight.current = false; setSending(false); }
  };
  const recover = async () => {
    if (!id || !op || op.state !== 'interrupted' || inFlight.current) return;
    inFlight.current = true; setSending(true);
    try {
      const response = await api.recoverWhitelist(id, op.id);
      if (response.data.operation.id !== op.id || response.data.operation.serverId !== id || response.data.operation.kind !== 'whitelist-change') throw new Error('恢复操作绑定无法确认');
      setError(null); setUnknown(false); await Promise.all([operation.refetch(), query.refetch()]);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { inFlight.current = false; setSending(false); setRecoverPending(false); }
  };
  const trap = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !sending) { event.preventDefault(); setPending(null); setRecoverPending(false); }
    if (event.key === 'Tab') {
      const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      if (!buttons?.length) return;
      const first = buttons[0]!, last = buttons[buttons.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    }
  };
  if (data?.executionMode === 'direct-rcon' && id) return <LocalWhitelistPanel serverId={id} data={data}
    candidates={query.data?.candidates?.data} candidatesStale={query.data?.candidateReadFailed === true}
    stale={query.isError} fetching={query.isFetching} refresh={async () => !(await query.refetch()).isError} />;
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
          <ul>{data.items.map(member => <li key={member.uuid}><strong>{member.name}</strong> · <span style={{ overflowWrap: 'anywhere' }}>{member.uuid}</span>
            {data.membershipWritable ? <button className="button button--secondary" disabled={!writable} onClick={() => confirm('remove', member.name)}>删除 {member.name}</button> : null}</li>)}</ul>}
        {!data.membershipWritable ? <>
        <p>成员添加和删除尚未开放；当前不会改变成员名单。</p>
        <p role="status">在线增删暂不可用：专用 RCON 执行链尚未接入生产，Vanilla 26.3 命令响应与保存结果尚未完成真实验收。</p>
        </> : null}
        <p>第一版仅计划支持本地、由 Manager 管理且正在运行的 Vanilla 26.3；不支持停服编辑、批量操作或自动重启。</p>
        <label>玩家名称<input value={name} maxLength={16} autoComplete="off" disabled={!writable} onChange={event => setName(event.target.value)} /></label>
        <button className="button" disabled={!writable || !/^[A-Za-z0-9_]{3,16}$/u.test(name)} onClick={() => confirm('add', name)}>添加玩家</button>
        {data.membershipWritable ? <p>操作前请使用“再次确认身份”。只发送一次命令，不自动停止或重启。</p> : null}
      </section> : null}
      {sending ? <p role="status">正在提交白名单操作…</p> : null}
      {operationId ? <section aria-label="白名单操作状态"><p>操作 ID：{operationId}</p>
        <p role="status">{op?.state === 'succeeded' ? '白名单操作已确认成功。' : op?.state === 'failed' ? `操作失败：${op.error?.message ?? '请检查操作记录'}` :
          op?.state === 'interrupted' ? '结果不确定，需要恢复检查；不会自动重发。' : '正在核对操作状态…'}</p>
        {operation.isError || (pollCount.current >= 30 && active) ? <p role="alert">状态尚未确认，请检查操作记录，不要重复提交。</p> : null}
        <button className="button button--secondary" disabled={operation.isFetching} onClick={() => void operation.refetch()}>刷新操作状态</button>
        {op?.state === 'interrupted' ? <button className="button button--secondary" disabled={sending} onClick={() => setRecoverPending(true)}>核验已保存结果</button> : null}
      </section> : null}
      {error ? <p role="alert">{error}。{unknown ? '请求结果尚未确认，请检查操作记录；不要重复提交。' : '请求未获准，请检查身份和页面状态后重新确认。'}</p> : null}
      {pending ? <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="whitelist-confirm-title" tabIndex={-1} onKeyDown={trap} className="settings-panel">
        <h2 id="whitelist-confirm-title">确认{pending.body.action === 'add' ? '添加' : '删除'}白名单成员</h2>
        <p>{pending.body.name} · 当前服务器：{id}。不会自动重启。</p>
        <button className="button" disabled={!writable || sending} onClick={() => void submit()}>确认执行</button>
        <button className="button button--secondary" disabled={sending} onClick={() => setPending(null)}>取消</button>
      </section> : null}
      {recoverPending ? <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="whitelist-recover-title" tabIndex={-1} onKeyDown={trap} className="settings-panel">
        <h2 id="whitelist-recover-title">确认核验已保存结果</h2><p>仅核验已有证据，不重发命令、不反向修改；证据不足时继续阻塞。</p>
        <button className="button" disabled={sending} onClick={() => void recover()}>确认核验</button>
        <button className="button button--secondary" disabled={sending} onClick={() => setRecoverPending(false)}>取消</button>
      </section> : null}
      <button className="button button--secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>刷新白名单</button>
    </>}
  </div>;
}
