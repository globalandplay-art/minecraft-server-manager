import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BackupInfo, ServersResponse } from '@mcsm/contracts';
import { AlertTriangle, Archive, DatabaseBackup, Download, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiClientError, api, errorMessage, shouldRetry } from '../api';
import { EmptyState, ErrorState, PageHeading } from '../components/Ui';
import { RestoreAction, RestoreHistory } from './RestoreAction';
import { WorldCreatePlan } from './WorldCreatePlan';
import { WorldImportUpload } from './WorldImportUpload';

type Server = ServersResponse['data']['items'][number];
const metricText = (metric: { status: string; value: unknown }) => metric.status === 'unavailable' ? '不可用' : String(metric.value);
const sizeText = (value: number) => value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${(value / 1024 ** 3).toFixed(2)} GB`;
const PENDING_BACKUP_TTL_MS = 24 * 60 * 60 * 1_000;
type PendingBackup = { key: string; serverId: string; savedAt: number; body: { scope: 'world-set'; allowStop: boolean; label?: string } };

function BackupDownload({ serverId, backup }: { serverId: string; backup: BackupInfo }) {
  const storageKey = `mcsm.pendingExport.${serverId}.${backup.id}`;
  const [key, setKey] = useState(() => {
    const saved = sessionStorage.getItem(storageKey);
    try {
      const value = JSON.parse(saved ?? 'null') as { key?: unknown; savedAt?: unknown } | null;
      if (value && typeof value.key === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.key) &&
        typeof value.savedAt === 'number' && Date.now() >= value.savedAt && Date.now() - value.savedAt < PENDING_BACKUP_TTL_MS) return value.key;
    } catch { /* Invalid UI state never controls a filesystem path. */ }
    sessionStorage.removeItem(storageKey);
    return null;
  });
  const link = useRef<HTMLAnchorElement>(null);
  const downloaded = useRef<string | null>(null);
  const mutation = useMutation({ mutationFn: (requestKey: string) => api.createBackupExport(serverId, backup.id, requestKey) });
  const operationId = mutation.data?.data.operation.id;
  const operation = useQuery({ queryKey: ['export-operation', operationId],
    queryFn: ({ signal }) => api.operation(operationId!, signal), enabled: Boolean(operationId), retry: shouldRetry,
    refetchInterval: (query) => ['succeeded', 'failed', 'interrupted'].includes(query.state.data?.data.state ?? '') ? false : 500 });
  const succeeded = operation.data?.data.state === 'succeeded';
  const status = useQuery({ queryKey: ['backup-export', serverId, backup.id, operationId],
    queryFn: ({ signal }) => api.backupExport(serverId, backup.id, signal), enabled: succeeded, retry: shouldRetry });
  const ready = succeeded && status.data?.data.state === 'ready';
  useEffect(() => {
    if (ready && operationId && downloaded.current !== operationId && link.current) {
      downloaded.current = operationId;
      sessionStorage.removeItem(storageKey);
      link.current.click();
    }
  }, [ready, operationId, storageKey]);
  if (backup.scope !== 'world-set') return <p className="muted">私有服务端快照禁止下载</p>;
  const failed = ['failed', 'interrupted'].includes(operation.data?.data.state ?? '');
  const busy = mutation.isPending || (Boolean(operationId) && !succeeded && !failed && !operation.isError);
  const message = mutation.isError ? errorMessage(mutation.error) : operation.isError ? errorMessage(operation.error)
    : status.isError ? errorMessage(status.error) : operation.data?.data.error?.message;
  const state = message || failed ? 'Failed' : ready ? 'Ready' : operation.data?.data.step === 'scanning' ? 'Scanning' : busy || succeeded ? 'Exporting' : 'Available';
  const start = () => {
    const requestKey = succeeded || failed || (mutation.error instanceof ApiClientError && mutation.error.kind === 'http' && mutation.error.code !== 'OPERATION_CONFLICT')
      ? crypto.randomUUID() : key ?? crypto.randomUUID();
    setKey(requestKey);
    sessionStorage.setItem(storageKey, JSON.stringify({ key: requestKey, savedAt: Date.now() }));
    mutation.mutate(requestKey);
  };
  return <div className="page-stack">
    <span className="phase-badge" role="status">{state}</span>
    {!ready ? <button className="button button--secondary" disabled={busy} onClick={start}><Download size={15} />{busy ? '正在校验并导出…' : key && !failed ? '用相同请求确认导出' : 'Download World Set'}</button> : null}
    {ready ? <><a className="button button--secondary" ref={link} href={api.backupDownloadUrl(serverId, backup.id)} download><Download size={15} />下载世界备份</a><p className="muted">Ready 表示导出已校验。下载由浏览器管理，请在下载列表确认完成；页面无法确认传输结果。失败可重新校验后重试。</p><button className="button button--secondary" disabled={busy} onClick={start}><RefreshCw size={15} />重新校验并下载</button></> : null}
    {message ? <p className="inline-warning" role="alert">{message}</p> : null}
  </div>;
}

export function WorldsPage({ server }: { server: Server | undefined }) {
  const query = useQuery({ queryKey: ['worlds', server?.server.id], queryFn: ({ signal }) => api.worlds(server!.server.id, signal), enabled: Boolean(server), retry: shouldRetry });
  return <div className="page-stack">
    <PageHeading eyebrow="WORLD INVENTORY" title="Worlds" description="读取当前 Vanilla 世界及可确认的元数据。世界写入、导入与恢复仍受后续事务阶段控制。" />
    {!server ? <EmptyState title="尚无服务器实例" description="接入本地服务器后显示世界信息。" /> : query.isPending ? <p className="muted">正在读取世界目录…</p> : query.isError ? <ErrorState description={errorMessage(query.error)} retry={() => void query.refetch()} /> : query.data?.data.items.length ? query.data.data.items.map((world) => <section className="resource-card" key={world.worldId}>
      <div className="resource-card__heading"><div><span className="eyebrow">{world.active ? 'ACTIVE WORLD' : 'WORLD'}</span><h2>{world.name.status === 'unavailable' ? world.worldId : world.name.value}</h2></div><span className="phase-badge">{world.active ? '当前世界' : '只读'}</span></div>
      <dl className="resource-grid"><div><dt>Minecraft 版本</dt><dd>{metricText(world.minecraftVersion)}</dd></div><div><dt>Seed</dt><dd>{metricText(world.seed)}</dd></div><div><dt>占用空间</dt><dd>{world.sizeBytes.status === 'unavailable' ? '不可用' : sizeText(world.sizeBytes.value as number)}</dd></div><div><dt>难度 / 模式</dt><dd>{metricText(world.difficulty)} / {metricText(world.gameMode)}</dd></div><div><dt>维度</dt><dd>{world.dimensions.map((item) => item.kind).join(' · ')}</dd></div><div><dt>视距 / 模拟距离</dt><dd>{metricText(world.viewDistance)} / {metricText(world.simulationDistance)}</dd></div></dl>
    </section>) : <EmptyState title="未发现可管理的世界" description="后端没有返回可确认的世界目录。" />}
    {server?.capabilities.worlds ? <WorldCreatePlan key={server.server.id} serverId={server.server.id} /> : null}
    {server?.capabilities.worlds && query.data?.meta.mode === 'local' ? <WorldImportUpload key={`import-${server.server.id}`} serverId={server.server.id} /> : null}
    <p className="muted">当前支持 Vanilla 世界集盘点、新建与 ZIP 导入。上传后需要校验导入计划并明确确认；创建和导入完成后保持停服，由你另行启动。归档尚未开放。</p>
  </div>;
}

export function BackupsPage({ server }: { server: Server | undefined }) {
  const [allowStop, setAllowStop] = useState(false);
  const [label, setLabel] = useState('');
  const [pendingSubmission, setPendingSubmission] = useState<PendingBackup | null>(null);
  const [expiredPending, setExpiredPending] = useState(false);
  const client = useQueryClient();
  useEffect(() => {
    if (!server) { setPendingSubmission(null); return; }
    const storageKey = `mcsm.pendingBackup.${server.server.id}`;
    const saved = sessionStorage.getItem(storageKey);
    if (!saved) { setPendingSubmission(null); return; }
    try {
      const value: unknown = JSON.parse(saved);
      if (typeof value === 'object' && value !== null && 'serverId' in value && value.serverId === server.server.id &&
        'key' in value && typeof value.key === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.key) &&
        'body' in value && typeof value.body === 'object' && value.body !== null && 'scope' in value.body &&
        value.body.scope === 'world-set' && 'allowStop' in value.body && typeof value.body.allowStop === 'boolean') {
        const rawBody = value.body as Record<string, unknown>;
        if (Object.keys(rawBody).some((key) => !['scope', 'allowStop', 'label'].includes(key)) ||
          (rawBody.label !== undefined && (typeof rawBody.label !== 'string' || rawBody.label.length < 1 || rawBody.label.length > 128))) throw new Error('invalid-pending-backup');
        const body = { scope: 'world-set' as const, allowStop: rawBody.allowStop as boolean,
          ...(typeof rawBody.label === 'string' ? { label: rawBody.label } : {}) };
        if (!('savedAt' in value) || typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt)) throw new Error('invalid-pending-backup');
        if (Date.now() - value.savedAt < 0 || Date.now() - value.savedAt >= PENDING_BACKUP_TTL_MS) {
          sessionStorage.removeItem(storageKey); setPendingSubmission(null); setExpiredPending(true); return;
        }
        const restored: PendingBackup = { key: value.key, serverId: server.server.id, savedAt: value.savedAt, body };
        setPendingSubmission(restored); setLabel(body.label ?? ''); setAllowStop(body.allowStop);
        setExpiredPending(false);
      } else throw new Error('invalid-pending-backup');
    } catch { sessionStorage.removeItem(storageKey); setPendingSubmission(null); setExpiredPending(false); }
  }, [server?.server.id]);
  const list = useQuery({ queryKey: ['backups', server?.server.id], queryFn: ({ signal }) => api.backups(server!.server.id, signal), enabled: Boolean(server), retry: shouldRetry });
  const mutation = useMutation({
    mutationFn: (submission: NonNullable<typeof pendingSubmission>) => api.createBackup(submission.serverId, submission.body, submission.key),
    onSuccess: async (_data, submission) => {
      sessionStorage.removeItem(`mcsm.pendingBackup.${submission.serverId}`);
      setPendingSubmission(null); setLabel(''); setExpiredPending(false);
      await client.invalidateQueries({ queryKey: ['backups', submission.serverId] });
    },
    onError: (error, submission) => {
      const definitiveRejection = error instanceof ApiClientError && error.kind === 'http' &&
        error.status !== undefined && error.status >= 400 && error.status < 500 && error.code !== 'OPERATION_CONFLICT';
      if (definitiveRejection) {
        sessionStorage.removeItem(`mcsm.pendingBackup.${submission.serverId}`);
        setPendingSubmission(null);
      }
    },
  });
  const operationId = mutation.data?.data.operation.id;
  const operationQuery = useQuery({
    queryKey: ['operation', operationId], queryFn: ({ signal }) => api.operation(operationId!, signal),
    enabled: Boolean(operationId), retry: shouldRetry,
    refetchInterval: (query) => ['succeeded', 'failed', 'interrupted'].includes(query.state.data?.data.state ?? '') ? false : 1_000,
  });
  useEffect(() => {
    if (operationQuery.data?.data.state === 'succeeded') void client.invalidateQueries({ queryKey: ['backups', server?.server.id] });
  }, [client, operationQuery.data?.data.state, server?.server.id]);
  const isRunning = server?.status.state === 'running';
  const backupDisabledReason = !server?.capabilities.backup
    ? '此服务端未声明备份能力'
    : !server.readiness.backup.allowed ? server.readiness.backup.reason ?? '当前状态不能安全备份' : null;
  const hasPendingForSelected = Boolean(server && pendingSubmission?.serverId === server.server.id);
  const startBackup = () => {
    if (pendingSubmission && Date.now() - pendingSubmission.savedAt >= PENDING_BACKUP_TTL_MS) {
      sessionStorage.removeItem(`mcsm.pendingBackup.${pendingSubmission.serverId}`);
      setPendingSubmission(null); setExpiredPending(true); return;
    }
    if (isRunning && !hasPendingForSelected && (!allowStop || !window.confirm('创建一致性备份会停止当前由管理器启动的服务器，完成后再尝试启动。是否继续？'))) return;
    if (!server) return;
    const existing = pendingSubmission?.serverId === server.server.id ? pendingSubmission : null;
    const submission = existing ?? {
      key: crypto.randomUUID(), serverId: server.server.id, savedAt: Date.now(),
      body: { scope: 'world-set' as const, allowStop, ...(label.trim() ? { label: label.trim() } : {}) },
    };
    if (!existing) {
      sessionStorage.setItem(`mcsm.pendingBackup.${server.server.id}`, JSON.stringify(submission));
      setPendingSubmission(submission);
    }
    mutation.mutate(submission);
  };
  return <div className="page-stack">
    <PageHeading eyebrow="LOCAL SNAPSHOTS" title="Backups" description="创建并校验 Vanilla 世界集快照。运行中的受管实例只有在你明确允许停服后才会操作。" />
    <section className="resource-card backup-create">
      <div className="resource-card__heading"><div><span className="eyebrow">MANUAL BACKUP</span><h2><DatabaseBackup size={19} /> 创建世界备份</h2></div><span className="phase-badge">world-set</span></div>
      <label className="field-label">备份备注<input value={label} maxLength={128} disabled={Boolean(pendingSubmission)} placeholder="例如：大型改动前" onChange={(event) => setLabel(event.target.value)} /></label>
      {expiredPending ? <p className="inline-warning"><AlertTriangle size={16} />未确认的备份请求已超过 24 小时有效期，不能安全复用。请检查备份列表；如需继续，请重新发起并确认一条新请求。</p> : null}
      {isRunning ? <label className="checkbox-line"><input type="checkbox" checked={allowStop} onChange={(event) => setAllowStop(event.target.checked)} />我允许管理器停止并在备份后尝试重新启动此实例</label> : null}
      {backupDisabledReason || server?.status.recoveryRequired ? <p className="inline-warning"><AlertTriangle size={16} />{backupDisabledReason ?? '实例处于恢复检查状态，不能创建备份。'}</p> : null}
      <button className="button button--primary" disabled={!server || mutation.isPending || (Boolean(backupDisabledReason) && !hasPendingForSelected) || (Boolean(server.status.recoveryRequired) && !hasPendingForSelected) || (isRunning && !allowStop && !hasPendingForSelected)} onClick={startBackup}><Archive size={16} />{mutation.isPending ? '正在提交…' : hasPendingForSelected ? '用相同请求确认备份状态' : '创建备份'}</button>
      {mutation.isError ? <p className="inline-warning">{errorMessage(mutation.error)}</p> : null}
      {mutation.isError && hasPendingForSelected ? <button className="button button--secondary" onClick={() => {
        if (!pendingSubmission) return;
        if (!window.confirm('放弃重试此请求？如果后端此前已接受，它仍可能继续执行。')) return;
        sessionStorage.removeItem(`mcsm.pendingBackup.${pendingSubmission.serverId}`); setPendingSubmission(null);
      }}>放弃未确认请求</button> : null}
      {mutation.data ? <p className="muted">备份操作状态：{operationQuery.data?.data.state ?? mutation.data.data.operation.state}{operationQuery.data?.data.error ? `；${operationQuery.data.data.error.message}` : operationQuery.isError ? `；${errorMessage(operationQuery.error)}` : ''}。页面只查询进度，不会自动重复提交。</p> : null}
      <p className="muted">恢复仅支持同实例、相同版本的 Vanilla 世界备份。服务端快照不能恢复或下载。</p>
    </section>
      <div className="resource-card__heading"><div><span className="eyebrow">BACKUP ARCHIVES</span><h2>备份记录</h2></div><button className="button button--secondary" onClick={() => void list.refetch()} disabled={list.isFetching}><RefreshCw size={15} />刷新</button></div>
    {!server ? <EmptyState title="尚无服务器实例" description="接入本地服务器后显示备份记录。" /> : list.isPending ? <p className="muted">正在读取备份…</p> : list.isError ? <ErrorState description={errorMessage(list.error)} retry={() => void list.refetch()} /> : list.data?.data.items.length ? list.data.data.items.map((backup) => <section className="resource-card backup-row" key={backup.id}>
      <div><span className="eyebrow">{backup.scope === 'server-snapshot' ? 'PRIVATE SNAPSHOT' : backup.pinned ? 'PROTECTED WORLD SET' : 'MANUAL WORLD SET'}</span><h3>{backup.label ?? new Date(backup.createdAt).toLocaleString()}</h3><p>{backup.minecraftVersion ?? '版本未知'} · {backup.fileCount.toLocaleString()} 个文件 · {sizeText(backup.sizeBytes)}</p></div><span className="phase-badge">SHA-256 已记录</span>
      <BackupDownload key={`${server.server.id}.${backup.id}`} serverId={server.server.id} backup={backup} />
      {backup.scope === 'world-set' ? <RestoreAction key={`restore.${server.server.id}.${backup.id}`} serverId={server.server.id} resourceId={backup.id} /> : null}
    </section>) : <EmptyState title="还没有备份" description="成功结束且具有有效清单的备份会显示在这里。" />}
    {server ? <RestoreHistory key={server.server.id} serverId={server.server.id} /> : null}
  </div>;
}
