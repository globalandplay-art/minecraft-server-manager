import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { BackupScheduleResponse } from '@mcsm/contracts';
import { api, errorMessage, shouldRetry } from '../api';

export function BackupSchedule({ serverId }: { serverId: string }) {
  const client = useQueryClient();
  const queryKey = ['backup-schedule', serverId];
  const query = useQuery({ queryKey, queryFn: ({ signal }) => api.backupSchedule(serverId, signal), retry: shouldRetry, refetchInterval: 15_000 });
  const [draft, setDraft] = useState<BackupScheduleResponse['data'] | null>(null);
  const value = draft ?? query.data?.data;
  const mutation = useMutation({ mutationFn: () => api.saveBackupSchedule(serverId, { revision: value!.revision, settings: value!.settings }),
    onSuccess: (result) => { client.setQueryData(queryKey, result); setDraft(null); } });
  const change = (patch: Partial<BackupScheduleResponse['data']['settings']>) => { if (value) setDraft({ ...value, settings: { ...value.settings, ...patch } }); };
  return <section className="resource-card backup-create">
    <h2>定时世界备份</h2>
    <p className="muted">默认关闭。仅在管理器运行时触发；错过的计划不补跑。运行中默认跳过，开启停服许可后会停止并在备份完成后尝试启动。</p>
    {query.isError ? <p role="alert">{errorMessage(query.error)}</p> : null}
    {value ? <>
      <label className="checkbox-line"><input type="checkbox" checked={value.settings.enabled} disabled={mutation.isPending} onChange={(event) => change({ enabled: event.target.checked })} />启用每日备份</label>
      <label className="field-label">每日时间<input type="time" value={value.settings.localTime} disabled={mutation.isPending} onChange={(event) => change({ localTime: event.target.value })} /></label>
      <label className="field-label">IANA 时区<input value={value.settings.timezone} maxLength={64} disabled={mutation.isPending} placeholder="Asia/Shanghai" onChange={(event) => change({ timezone: event.target.value })} /></label>
      <label className="checkbox-line"><input type="checkbox" checked={value.settings.allowStop} disabled={mutation.isPending} onChange={(event) => change({ allowStop: event.target.checked })} />允许计划备份停服并尝试重新启动</label>
      <button className="button button--primary" disabled={!draft || mutation.isPending || !value.settings.localTime || !value.settings.timezone} onClick={() => {
        if (value.settings.enabled && value.settings.allowStop && !window.confirm('每日计划将允许管理器停止受管服务器，并在备份完成后尝试重新启动。是否保存？')) return;
        mutation.mutate();
      }}>{mutation.isPending ? '正在保存…' : '保存备份计划'}</button>
      <button className="button button--secondary" disabled={mutation.isPending || query.isFetching} onClick={async () => { const result = await query.refetch(); if (result.data) { setDraft(null); mutation.reset(); } }}>刷新已保存计划</button>
      {mutation.isError ? <p role="alert">{errorMessage(mutation.error)}。输入已保留；刷新已保存计划后重新确认。</p> : null}
      {mutation.isSuccess ? <p role="status">计划已保存。</p> : null}
      <h3>最近执行</h3>
      {(query.data?.data.runs ?? []).length ? query.data!.data.runs.map((run) => <p key={run.id}>{run.localDate} {run.localTime} · {run.timezone} · {run.state}{run.code ? ` · ${run.code}` : ''}</p>) : <p className="muted">尚无计划执行记录。</p>}
    </> : query.isPending ? <p>正在读取计划…</p> : null}
  </section>;
}
