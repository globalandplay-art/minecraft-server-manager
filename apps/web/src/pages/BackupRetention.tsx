import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { BackupRetentionResponse } from '@mcsm/contracts';
import { api, errorMessage, shouldRetry } from '../api';

export function BackupRetention({ serverId }: { serverId: string }) {
  const client = useQueryClient(), queryKey = ['backup-retention', serverId];
  const query = useQuery({ queryKey, queryFn: ({ signal }) => api.backupRetention(serverId, signal), retry: shouldRetry, refetchInterval: 15_000 });
  const [draft, setDraft] = useState<BackupRetentionResponse['data'] | null>(null), value = draft ?? query.data?.data;
  const saved = (result: BackupRetentionResponse) => { client.setQueryData(queryKey, result); setDraft(null); void client.invalidateQueries({ queryKey: ['backups', serverId] }); };
  const mutation = useMutation({ mutationFn: () => api.saveBackupRetention(serverId, { revision: value!.revision, settings: value!.settings }), onSuccess: saved });
  const run = useMutation({ mutationFn: () => api.runBackupRetention(serverId, query.data!.data.revision), onSuccess: saved });
  const busy = mutation.isPending || run.isPending;
  const change = (patch: Partial<BackupRetentionResponse['data']['settings']>) => { if (value) setDraft({ ...value, settings: { ...value.settings, ...patch } }); };
  const valid = value && Number.isInteger(value.settings.retainCount) && value.settings.retainCount >= 1 && value.settings.retainCount <= 100 &&
    Number.isInteger(value.settings.retainDays) && value.settings.retainDays >= 1 && value.settings.retainDays <= 365;
  return <section className="resource-card backup-create">
    <h2>备份保留策略</h2>
    <p className="muted">默认关闭。最近份数或最近天数满足任一项即保留。开启后仅在成功新建备份且实例已确认停止时清理；保护备份、事务引用、旧格式或身份不明的文件始终保留。</p>
    {query.isError ? <p role="alert">{errorMessage(query.error)}</p> : null}
    {value ? <>
      <label className="checkbox-line"><input type="checkbox" checked={value.settings.enabled} disabled={busy} onChange={(event) => change({ enabled: event.target.checked })} />启用安全保留清理</label>
      <label className="field-label">至少保留最近份数<input type="number" min={1} max={100} value={value.settings.retainCount} disabled={busy} onChange={(event) => change({ retainCount: Number(event.target.value) })} /></label>
      <label className="field-label">至少保留最近天数<input type="number" min={1} max={365} value={value.settings.retainDays} disabled={busy} onChange={(event) => change({ retainDays: Number(event.target.value) })} /></label>
      <button className="button button--primary" disabled={!draft || !valid || busy} onClick={() => {
        if (value.settings.enabled && !window.confirm('开启后会永久删除超出份数和天数、且通过全部安全检查的备份。是否保存？')) return;
        mutation.mutate();
      }}>保存保留策略</button>
      <button className="button button--secondary" disabled={busy || Boolean(draft) || !query.data?.data.settings.enabled} onClick={() => {
        if (!window.confirm('现在按已保存策略清理符合条件的旧备份？删除不能撤销。')) return; run.mutate();
      }}>{run.isPending ? '正在安全核验和清理…' : '按已保存策略清理'}</button>
      <button className="button button--secondary" disabled={busy || query.isFetching} onClick={async () => { const result = await query.refetch(); if (result.data) { setDraft(null); mutation.reset(); run.reset(); } }}>刷新已保存策略</button>
      {mutation.isError || run.isError ? <p role="alert">{errorMessage(mutation.error ?? run.error)}。请刷新查看结果，不会自动重试清理。</p> : null}
      {query.data?.data.lastRun ? <div role="status"><p>上次清理：{query.data.data.lastRun.state}{query.data.data.lastRun.code ? ` · ${query.data.data.lastRun.code}` : ''} · 删除 {query.data.data.lastRun.removed.length} 份 · 保留 {query.data.data.lastRun.retained.length} 份</p>
        {query.data.data.lastRun.retained.map((entry) => <p key={entry.id}>{entry.id} · {entry.reason}</p>)}</div> : <p className="muted">尚未执行保留清理。</p>}
    </> : query.isPending ? <p>正在读取保留策略…</p> : null}
  </section>;
}
