import { useEffect, useRef, useState } from 'react';
import type { WhitelistResponse, WhitelistCandidatesResponse, WhitelistMemberRequest, WhitelistMutationResponse } from '@mcsm/contracts';
import { api, ApiClientError, errorMessage } from '../api';
import { PageHeading } from './Ui';

type Props = { serverId: string; data: WhitelistResponse['data']; candidates: WhitelistCandidatesResponse['data'] | undefined;
  candidatesStale: boolean; stale: boolean; fetching: boolean; refresh: () => Promise<boolean> };
/** One selected instance per mounted panel. Neither reads nor mutations are auto-replayed. */
export function LocalWhitelistPanel({ serverId, data, candidates, candidatesStale, stale, fetching, refresh }: Props) {
  const [name, setName] = useState(''), [search, setSearch] = useState('');
  const [pending, setPending] = useState<WhitelistMemberRequest | null>(null);
  const [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false);
  const [result, setResult] = useState<WhitelistMutationResponse['data'] | null>(null);
  const active = useRef(true), inFlight = useRef(false), dialog = useRef<HTMLElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (pending) dialog.current?.focus(); }, [pending]);
  const writable = data.membershipWritable && !stale && !fetching && !busy && !unknown;
  const choose = (action: 'add' | 'remove', player: string) => {
    if (writable && data.membershipWritable && /^[A-Za-z0-9_]{3,16}$/u.test(player)) {
      const request: WhitelistMemberRequest = { action, name: player, revision: data.revision, confirm: true };
      if (action === 'add') void submit(request); else setPending(request);
    }
  };
  const submit = async (request: WhitelistMemberRequest | null = pending) => {
    if (!request || !writable || inFlight.current) return;
    inFlight.current = true; setBusy(true); setPending(null);
    try {
      const response = await api.mutateWhitelistMember(serverId, request, crypto.randomUUID());
      if (response.data.serverId !== serverId || response.data.action !== request.action || response.data.name !== request.name) throw new Error('操作响应与所选实例不一致');
      if (!active.current) return;
      setResult(response.data); setUnknown(response.data.outcome === 'unknown');
      if (response.data.outcome === 'succeeded') setName('');
      await refresh();
    } catch (failure) {
      if (!active.current) return;
      const rejected = failure instanceof ApiClientError && [400, 401, 403, 404, 409, 428].includes(failure.status ?? 0);
      setUnknown(!rejected); setResult({ serverId, ...request, outcome: rejected ? 'failed' : 'unknown',
        code: rejected ? 'REQUEST_REJECTED' : 'WHITELIST_RESULT_UNKNOWN', relatedErrorObserved: null,
        message: rejected ? errorMessage(failure) : '结果未知：响应未完整收到；不会自动重发，请手动刷新核实' });
    } finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  const manualRefresh = async () => { if (await refresh() && active.current) setUnknown(false); };
  const filter = (value: string) => value.toLowerCase().includes(search.trim().toLowerCase());
  return <div className="page-stack">
    <PageHeading eyebrow="LT · WHITELIST" title="白名单" description="通过当前受管服务器的 Minecraft 原生命令添加或删除玩家。" />
    {stale ? <p role="alert">下面是旧快照，读取失败；当前不能修改。</p> : null}
    <section className="settings-panel" aria-label="白名单状态">
      <p>目标服务器：{serverId}</p>
      <p>保存的白名单开关：{data.configuredEnabled === null ? '未知' : data.configuredEnabled ? '启用' : '关闭'} · 运行时开关：未知</p>
      <p>最近同步：{new Date(data.sampledAt).toLocaleString()}。页面可见时每 5 秒刷新。</p>
      {!data.membershipWritable ? <p role="status">在线修改不可用：{data.writeUnavailableReason === 'runtime-saved-mismatch' ? '运行时与保存名单不一致。' : '请确认 Vanilla 26.3 由 LT 管理且正在运行、RCON 已配置且可用。'}不会自动开服或启用 RCON。</p> : null}
      {data.runtime?.available ? <p>运行时名单：{data.runtime.names.join('、') || '空'}。{data.runtime.consistent ? '与保存名单一致。' : '与保存名单不一致，请检查。'}</p> : <p>运行时名单：不可用。</p>}
      <button className="button button--secondary" disabled={fetching || busy} onClick={() => void manualRefresh()}>刷新白名单</button>
    </section>
    <section className="settings-panel" aria-label="添加玩家">
      <h2>添加玩家</h2><p>用户名格式正确不代表账号存在，身份解析由 Minecraft 完成。</p>
      <label>玩家名称<input value={name} maxLength={16} autoComplete="off" disabled={!writable} onChange={event => setName(event.target.value)} /></label>
      <button className="button" disabled={!writable || !/^[A-Za-z0-9_]{3,16}$/u.test(name)} onClick={() => choose('add', name)}>添加玩家</button>
    </section>
    <label>搜索玩家<input value={search} onChange={event => setSearch(event.target.value)} /></label>
    <section className="settings-panel" aria-label="历史候选玩家"><h2>历史候选玩家</h2>
      <p>来自此实例的 usercache.json，仅为历史记录，未经当前账号身份验证，不会自动添加。</p>
      {candidatesStale ? <p role="alert">候选读取失败，保留的候选可能已过期。</p> : null}
      {!candidates || candidates.availability === 'unavailable' ? <p>历史候选暂不可用；可使用手动输入。</p> :
        candidates.items.length === 0 ? <p>没有尚未添加的有效历史候选。</p> :
        <ul>{candidates.items.filter(row => filter(row.name) && !data.items.some(member => member.name.toLowerCase() === row.name.toLowerCase())).map(row =>
          <li key={row.uuid}><strong>{row.name}</strong> · 历史玩家缓存 <button className="button button--secondary" disabled={!writable || candidatesStale}
            onClick={() => choose('add', row.name)}>添加 {row.name}</button></li>)}</ul>}
    </section>
    <section className="settings-panel" aria-label="已授权玩家"><h2>已授权玩家</h2>
      {data.availability === 'unavailable' ? <p>保存名单无法安全读取，不能视为空名单。</p> :
        data.items.length === 0 ? <p>已确认保存的名单为空。</p> :
        <ul>{data.items.filter(row => filter(row.name)).map(row => <li key={row.uuid}><strong>{row.name}</strong> · <span style={{ overflowWrap: 'anywhere' }}>{row.uuid}</span>
          <button className="button button--secondary" disabled={!writable} onClick={() => choose('remove', row.name)}>删除 {row.name}</button></li>)}</ul>}
    </section>
    {busy ? <p role="status">正在发送一次白名单命令并检查运行状态与保存结果…</p> : null}
    {result ? <p role={result.outcome === 'succeeded' ? 'status' : 'alert'}>{result.outcome === 'succeeded' ? '成功' : result.outcome === 'failed' ? '失败' : '结果未知'}：{result.message}
      {unknown ? ' 请手动刷新核实后再决定下一步，不要重复提交。' : ''}</p> : null}
    {pending ? <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="确认白名单操作" className="settings-panel"
      onKeyDown={event => { if (event.key === 'Escape') setPending(null);
        if (event.key === 'Tab') { const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'); const first = buttons?.[0], last = buttons?.[buttons.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus(); } } }}>
      <h2>确认{pending.action === 'add' ? '添加' : '删除'}白名单玩家</h2><p>玩家：{pending.name} · 目标服务器：{serverId}</p>
      <button className="button" disabled={!writable} onClick={() => void submit()}>确认执行</button>
      <button className="button button--secondary" onClick={() => setPending(null)}>取消</button>
    </section> : null}
  </div>;
}
