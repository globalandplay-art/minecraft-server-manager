import type { AddonTrashResponse, AddonsResponse, AddonUploadResponse, Operation, ServerSummary } from '@mcsm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, RefreshCw, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api, ApiClientError, errorMessage, shouldRetry } from '../api';
import { EmptyState, ErrorState, PageHeading } from '../components/Ui';

type AddonRecord = AddonsResponse['data']['items'][number];
type TrashRecord = AddonTrashResponse['data']['items'][number];
type StagedAddon = AddonUploadResponse['data'];
export type AddonLifecycleState = 'installed' | 'disabled' | 'trashed' | 'unknown' | 'unavailable' | 'requires-inspection';
export type AddonViewModel = {
  readonly identity: string;
  readonly name: string;
  readonly version: string;
  readonly kind: 'mod' | 'plugin';
  readonly state: AddonLifecycleState;
  readonly compatibility: string;
  readonly metadata: string;
  readonly minecraft: string;
  readonly sizeBytes: number;
  readonly trashId?: string;
};
export type UploadUiState = { readonly kind: 'idle' } | { readonly kind: 'uploading' } |
  { readonly kind: 'validated'; readonly item: StagedAddon } | { readonly kind: 'unknown'; readonly message: string };
export type AddonOperationUiState = { readonly kind: 'idle' } | { readonly kind: 'confirming' } |
  { readonly kind: 'submitting' } | { readonly kind: 'accepted'; readonly operationId: string } |
  { readonly kind: 'running'; readonly operation: Operation } | { readonly kind: 'succeeded'; readonly operation: Operation } |
  { readonly kind: 'failed'; readonly operation?: Operation; readonly message?: string } |
  { readonly kind: 'recovery-required'; readonly operation?: Operation; readonly message: string } |
  { readonly kind: 'outcome-unknown'; readonly message: string };

type ConfirmTarget = { action: 'install'; item: StagedAddon } | { action: 'disable' | 'enable' | 'trash'; item: AddonRecord } |
  { action: 'restore'; item: TrashRecord };
type PendingAction = { action: ConfirmTarget; key: string };

const terminal = (state?: Operation['state']) => state === 'succeeded' || state === 'failed' || state === 'interrupted';
const safeOperationId = (value: string | null | undefined): value is string => Boolean(value && /^[a-zA-Z0-9-]{1,128}$/u.test(value));
const sizeLabel = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MiB`;

function toAddonView(item: AddonRecord): AddonViewModel {
  return { identity: item.id, name: item.name ?? '未识别扩展', version: item.version ?? '版本未知', kind: item.kind,
    state: item.state === 'enabled' ? 'installed' : 'disabled', compatibility: '未知',
    metadata: item.metadataStatus === 'parsed' ? '已识别' : item.metadataStatus === 'invalid' ? '无效' : '缺失',
    minecraft: item.minecraftConstraint?.join(', ') ?? '未知', sizeBytes: item.sizeBytes };
}
function toTrashView(item: TrashRecord): AddonViewModel {
  return { identity: item.addonId, trashId: item.id, name: item.name ?? '未识别扩展', version: item.version ?? '版本未知', kind: item.kind,
    state: 'trashed', compatibility: '未知', metadata: item.metadataStatus === 'parsed' ? '已识别' : item.metadataStatus === 'invalid' ? '无效' : '缺失',
    minecraft: item.minecraftConstraint?.join(', ') ?? '未知', sizeBytes: item.sizeBytes };
}

function ActionConfirmation({ target, busy, onCancel, onConfirm }: { target: ConfirmTarget; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => { dialog.current?.focus(); }, []);
  const title = target.action === 'install' ? '确认安装' : target.action === 'disable' ? '确认禁用' : target.action === 'enable' ? '确认启用' : target.action === 'trash' ? '移到回收区' : '确认恢复';
  const record = target.item;
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onCancel(); }
    if (event.key === 'Tab') {
      const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
      if (!buttons?.length) return;
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1]?.focus(); }
      else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0]?.focus(); }
    }
  };
  return <div className="addon-dialog-backdrop"><section ref={dialog} className="confirm-dialog addon-confirm" role="alertdialog" aria-modal="true"
    aria-labelledby="addon-confirm-title" aria-describedby="addon-confirm-description" tabIndex={-1} onKeyDown={keyDown}>
    <h2 id="addon-confirm-title">{title}</h2>
    <p id="addon-confirm-description"><strong>{record.name}</strong> · {record.version} · {record.kind === 'plugin' ? 'Paper 插件' : 'Fabric 模组'}</p>
    {target.action === 'install' ? <p>目标：{record.loader === 'paper' ? 'Paper' : 'Fabric'}。安装会创建保护快照；之后需要重启才能生效。</p> : null}
    {target.action === 'disable' || target.action === 'enable' ? <p>服务端必须已停止。操作不会自动停服或重启。</p> : null}
    {target.action === 'trash' ? <p>扩展会移入回收区，可恢复，不会永久删除。需要重启才能生效。</p> : null}
    {target.action === 'restore' ? <p>将恢复为原先的{target.item.originalState === 'enabled' ? '启用' : '禁用'}状态。目标冲突时会停止并保留回收记录。</p> : null}
    <div className="confirm-dialog__actions">
      <button className="button button--secondary" disabled={busy} onClick={onCancel}>取消</button>
      <button className="button button--primary" disabled={busy} onClick={onConfirm}>{busy ? '正在提交…' : '确认操作'}</button>
    </div>
  </section></div>;
}

function AddonCard({ item, busy, disabledReason, onAction }: { item: AddonViewModel; busy: boolean; disabledReason: string; onAction: (action: 'disable' | 'enable' | 'trash' | 'restore') => void }) {
  return <article className="addon-card">
    <div className="addon-card__title"><div><h3>{item.name}</h3><p>{item.kind === 'plugin' ? 'Paper Plugin' : 'Fabric Mod'} · {item.version}</p></div>
      <span className={`addon-state addon-state--${item.state}`}>{item.state === 'installed' ? '已启用' : item.state === 'disabled' ? '已禁用' : '回收区'}</span></div>
    <dl className="addon-card__details"><div><dt>兼容性</dt><dd>{item.compatibility}</dd></div><div><dt>Minecraft 版本约束</dt><dd>{item.minecraft}</dd></div>
      <div><dt>元数据</dt><dd>{item.metadata}</dd></div><div><dt>文件大小</dt><dd>{sizeLabel(item.sizeBytes)}</dd></div></dl>
    {item.state === 'trashed' ? <button className="button button--secondary" disabled={busy} title={disabledReason || undefined}
      onClick={() => onAction('restore')}>恢复</button> : <div className="addon-card__actions">
      <button className="button button--secondary" disabled={busy} title={disabledReason || undefined}
        onClick={() => onAction(item.state === 'installed' ? 'disable' : 'enable')}>{item.state === 'installed' ? '禁用' : '启用'}</button>
      <button className="button button--secondary" disabled={busy} title={disabledReason || undefined}
        onClick={() => onAction('trash')}>移到回收区</button>
    </div>}
  </article>;
}

export function AddonsPage({ server }: { server?: ServerSummary | undefined }) {
  const serverId = server?.server.id;
  const client = useQueryClient();
  const [staged, setStaged] = useState<StagedAddon | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [uploadUnknown, setUploadUnknown] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmTarget | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [operationId, setOperationId] = useState<string>();
  const [operationState, setOperationState] = useState<AddonOperationUiState>({ kind: 'idle' });
  const [restartRequired, setRestartRequired] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const terminalHandled = useRef(new Set<string>());
  const uploadInFlight = useRef(false);
  const submissionInFlight = useRef(false);

  const supportedKind = server?.server.type === 'paper' && server.capabilities.plugins ? 'plugin'
    : server?.server.type === 'fabric' && server.capabilities.mods ? 'mod' : null;
  const supported = supportedKind !== null;
  const title = supportedKind === 'plugin' ? 'Plugins' : supportedKind === 'mod' ? 'Mods' : 'Mods / Plugins';
  const inventory = useQuery({ queryKey: ['addons', serverId], queryFn: ({ signal }) => api.addons(serverId!, signal),
    enabled: Boolean(serverId && supported), retry: shouldRetry, refetchOnWindowFocus: false });
  const trash = useQuery({ queryKey: ['addon-trash', serverId], queryFn: ({ signal }) => api.addonTrash(serverId!, signal),
    enabled: Boolean(serverId && supported), retry: shouldRetry, refetchOnWindowFocus: false });
  const status = useQuery({ queryKey: ['server', serverId], queryFn: ({ signal }) => api.server(serverId!, signal),
    enabled: Boolean(serverId && supported), retry: false, refetchInterval: 5_000, refetchIntervalInBackground: false });
  const current = status.data?.data ?? server;
  const recovery = Boolean(current?.status.recoveryRequired);
  const activeOperation = current?.status.activeOperationId ?? null;
  const age = current ? Date.now() - Date.parse(current.status.observedAt) : Infinity;
  const statusFresh = Boolean(current && age >= 0 && age <= 15_000 && !status.isError && !status.isFetching);
  const mutationReady = Boolean(statusFresh && current?.status.state === 'stopped' && current.status.ownership === 'none' &&
    !recovery && !activeOperation && current.readiness.addonChanges.allowed && inventory.data?.data.writeSupported && !inventory.isError && !inventory.isFetching);
  const inventoryFresh = Boolean(inventory.data && !inventory.isError && !inventory.isFetching);
  const upload = useMutation({ mutationFn: (file: File) => api.uploadAddon(serverId!, file), retry: false });
  const operationQuery = useQuery({ queryKey: ['addon-operation', serverId, operationId], queryFn: ({ signal }) => api.operation(operationId!, signal),
    enabled: Boolean(serverId && operationId), retry: shouldRetry,
    refetchInterval: (query) => document.hidden || terminal(query.state.data?.data.state) ? false : 750,
    refetchIntervalInBackground: false });
  const operation = operationQuery.data?.data;
  const actionMutation = useMutation({ mutationFn: async (request: PendingAction) => {
    const action = request.action;
    if (action.action === 'install') {
      if (!inventory.data) throw new Error('暂存校验信息已失效，请刷新列表并重新确认。');
      return api.installAddon(serverId!, { uploadId: action.item.id, uploadRevision: action.item.revision,
        inventoryRevision: inventory.data.data.revision }, request.key);
    }
    if (action.action === 'restore') {
      if (!trash.data) throw new Error('回收区版本已失效，请刷新并重新确认。');
      return api.restoreAddon(serverId!, action.item.id, { revision: trash.data.data.revision }, request.key);
    }
    if (!inventory.data) throw new Error('扩展列表版本已失效，请刷新并重新确认。');
    return api.mutateAddon(serverId!, action.item.id, action.action, { revision: inventory.data.data.revision }, request.key);
  }, retry: false });
  const addonItems = useMemo(() => inventory.data?.data.items.map(toAddonView) ?? [], [inventory.data]);
  const trashItems = useMemo(() => trash.data?.data.items.map(toTrashView) ?? [], [trash.data]);

  useEffect(() => {
    if (!operationId && safeOperationId(activeOperation)) setOperationId(activeOperation);
  }, [activeOperation, operationId]);
  useEffect(() => {
    if (!operationId || !operation) return;
    if (operation.id !== operationId || operation.serverId !== serverId || operation.kind !== 'addon-change') {
      setOperationState({ kind: 'recovery-required', operation, message: '当前操作与此实例的扩展变更不匹配；保留状态并停止变更。' });
      return;
    }
    if (operation.state === 'queued' || operation.state === 'running') {
      setOperationState({ kind: 'running', operation });
      return;
    }
    if (!terminal(operation.state) || terminalHandled.current.has(operation.id)) return;
    terminalHandled.current.add(operation.id);
    void Promise.all([inventory.refetch(), trash.refetch(), status.refetch()]).then(([listResult, trashResult, statusResult]) => {
      const needsRecovery = operation.state === 'interrupted' || operation.error?.code?.includes('RECOVERY_REQUIRED') || statusResult.data?.data.status.recoveryRequired;
      if (needsRecovery) {
        setOperationState({ kind: 'recovery-required', operation, message: '操作中断或需要恢复核验。文件和保护证据由后端保留；禁止重试其他扩展变更。' });
      } else if (listResult.isError || trashResult.isError || statusResult.isError) {
        setOperationState({ kind: 'outcome-unknown', message: '操作已结束，但当前列表或服务器状态未确认；请刷新状态，不要重复提交。' });
      } else if (operation.state === 'succeeded' && !listResult.isError && !trashResult.isError && !statusResult.isError) {
        setOperationState({ kind: 'succeeded', operation });
        setRestartRequired(operation.result?.restartRequired === true);
        if (pendingAction?.action.action === 'install') setStaged(null);
        setPendingAction(null);
        submissionInFlight.current = false;
      } else {
        setOperationState({ kind: 'failed', operation, message: operation.error?.message ?? '操作失败。当前文件状态以刷新后的列表为准。' });
        setPendingAction(null);
        submissionInFlight.current = false;
      }
      void client.invalidateQueries({ queryKey: ['servers'] });
    });
  }, [operation, operationId, serverId, inventory, trash, status, client, pendingAction]);

  const recoveryRequired = recovery || uploadUnknown || operationState.kind === 'recovery-required' || operationState.kind === 'outcome-unknown';
  const blockedReason = recoveryRequired ? '恢复状态需要核验，扩展变更已锁定。'
    : activeOperation ? '当前实例有其他操作正在进行。'
      : !statusFresh ? '服务器状态尚未确认，请刷新后再操作。'
        : current?.status.state !== 'stopped' ? '请先在 Servers 页面明确停止服务端；扩展操作不会自动停服。'
          : current.status.ownership !== 'none' ? '服务端进程所有权尚未确认。'
            : !current.readiness.addonChanges.allowed ? current.readiness.addonChanges.reason ?? '后端暂未开放此操作。'
              : !inventoryFresh ? '扩展列表刷新完成前不能确认或提交变更。' : '';
  const mutationBusy = recoveryRequired || actionMutation.isPending || operationState.kind === 'submitting' || operationState.kind === 'accepted' ||
    operationState.kind === 'running';
  const uploadBusy = upload.isPending || mutationBusy || Boolean(confirmation);
  const uploadAdmissionBlocked = uploadBusy || uploadUnknown || recoveryRequired || Boolean(activeOperation);

  function selectFile(file?: File) {
    if (!file) return;
    if (uploadInFlight.current || submissionInFlight.current || uploadAdmissionBlocked) {
      return;
    }
    setUploadError('');
    if (!/\.jar$/iu.test(file.name) || file.size < 1 || file.size > 64 * 1024 ** 2) {
      setUploadError('请选择非空且不超过 64 MiB 的 .jar 文件。文件内容与元数据由后端校验。'); return;
    }
    if (uploadUnknown || recoveryRequired || activeOperation) { setUploadError(uploadUnknown ? '上次上传结果未确认；请勿重复上传。' : blockedReason); return; }
    uploadInFlight.current = true;
    setStaged(null);
    upload.mutate(file, { onSuccess: (result) => { setStaged(result.data); uploadInFlight.current = false; }, onError: (error) => {
      const definite = error instanceof ApiClientError && error.kind === 'http' && error.status !== undefined && error.status >= 400 && error.status < 500;
      const requiresRecovery = error instanceof ApiClientError && Boolean(error.code?.includes('RECOVERY_REQUIRED'));
      setUploadUnknown(!definite || requiresRecovery);
      if (definite && !requiresRecovery) uploadInFlight.current = false;
      setUploadError(definite ? errorMessage(error) : `${errorMessage(error)} 暂存结果未确认，请勿自动重试。`);
    } });
  }
  function requestAction(action: ConfirmTarget) {
    if (recoveryRequired || activeOperation || uploadInFlight.current || uploadBusy || submissionInFlight.current) return;
    if (action.action !== 'install' && !mutationReady) return;
    if (action.action === 'install' && !mutationReady) return;
    setConfirmation(action); setOperationState({ kind: 'confirming' });
  }
  async function refreshAll() {
    const results = await Promise.all([inventory.refetch(), trash.refetch(), status.refetch()]);
    if (operationId && operationState.kind === 'outcome-unknown' && results.every((result) => !result.isError)) {
      terminalHandled.current.delete(operationId);
      setOperationState({ kind: 'accepted', operationId });
      await operationQuery.refetch();
    }
  }

  if (!server) return <div className="page-stack"><PageHeading eyebrow="ADDON MANAGEMENT" title={title} /><EmptyState title="请选择服务器" description="选择由后端识别的 Paper 或 Fabric 实例后查看扩展。" /></div>;
  if (!supported) return <div className="page-stack"><PageHeading eyebrow="ADDON MANAGEMENT" title={title} description="服务端类型和能力来自后端注册信息。" />
    <EmptyState title="此实例不支持 Mods / Plugins" description={`${server.server.type.toUpperCase()} 实例没有已开放的 Paper 插件或 Fabric 模组能力。`} /></div>;

  return <div className="page-stack addons-page">
    <PageHeading eyebrow="ADDON MANAGEMENT" title={title} description={`${server.server.name} · ${server.server.type.toUpperCase()} · ${server.server.minecraftVersion ?? '版本未知'}`}
      aside={<button className="button button--secondary" onClick={() => void refreshAll()} disabled={inventory.isFetching || trash.isFetching || status.isFetching}><RefreshCw size={16} aria-hidden="true" />刷新状态</button>} />
    {recoveryRequired ? <section className="addon-banner addon-banner--danger" role="alert"><strong>需要恢复核验，变更已锁定</strong><p>保留旧操作和证据。这里只能刷新状态，不能重试或开始新的扩展变更。</p></section> : null}
    {blockedReason && !recoveryRequired ? <section className="addon-banner" role="status">{blockedReason}</section> : null}
    {restartRequired ? <section className="addon-banner addon-banner--restart" role="status"><strong>Restart required</strong><p>扩展变更已完成，需要重启才能生效。管理器不会自动重启服务器。</p>
      <a className="button button--secondary" href={`/servers?server=${encodeURIComponent(serverId!)}`}>前往 Servers 手动重启</a></section> : null}

    <section className="panel addon-upload">
      <div className="addon-section-heading"><div><span className="eyebrow">VALIDATED STAGING</span><h2>上传 .jar</h2></div><Upload size={20} aria-hidden="true" /></div>
      <p className="muted">上传后由后端检查 JAR 结构和扩展元数据。校验通过才可安装；上传不会自动安装、停服或重启。</p>
      <div className={`addon-dropzone ${dropActive ? 'addon-dropzone--active' : ''}`} aria-disabled={uploadAdmissionBlocked} onDragEnter={(event) => { event.preventDefault(); if (!uploadAdmissionBlocked && !uploadInFlight.current && !submissionInFlight.current) setDropActive(true); }}
        onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false); }}
        onDrop={(event) => { event.preventDefault(); setDropActive(false); selectFile(event.dataTransfer.files.length === 1 ? event.dataTransfer.files[0] : undefined); }}>
        <input ref={fileInput} className="sr-only" type="file" accept=".jar,application/java-archive" aria-label="选择扩展 JAR 文件"
          disabled={uploadAdmissionBlocked} onChange={(event) => { selectFile(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
        <p>拖入一个 JAR 文件，或通过按钮选择</p>
        <button className="button button--secondary" disabled={uploadAdmissionBlocked} onClick={() => { if (!uploadAdmissionBlocked && !uploadInFlight.current && !submissionInFlight.current) fileInput.current?.click(); }}>选择 .jar 文件</button>
      </div>
      {upload.isPending ? <p role="status" aria-live="polite">正在上传并校验…</p> : null}
      {uploadError ? <p className="inline-warning" role="alert">{uploadError}</p> : null}
      {staged ? <article className="addon-stage" aria-label="已校验暂存扩展"><div><strong>Ready to install</strong><span>后端校验通过 · {staged.kind === 'plugin' ? 'Paper Plugin' : 'Fabric Mod'}</span></div>
        <dl><div><dt>扩展</dt><dd>{staged.name}</dd></div><div><dt>版本</dt><dd>{staged.version}</dd></div><div><dt>目标</dt><dd>{staged.loader === 'paper' ? 'Paper' : 'Fabric'}</dd></div>
          <div><dt>Minecraft 版本约束</dt><dd>{staged.minecraftConstraint?.join(', ') ?? '未知'}</dd></div><div><dt>兼容性</dt><dd>未知；请核对该版本扩展说明</dd></div><div><dt>大小</dt><dd>{sizeLabel(staged.sizeBytes)}</dd></div></dl>
        <p className="muted">安装会创建保护快照。安装成功后需要重启；不会自动重启。</p>
        <button className="button button--primary" disabled={!mutationReady || mutationBusy || uploadUnknown} title={blockedReason || undefined}
          onClick={() => requestAction({ action: 'install', item: staged })}>安装扩展</button>
      </article> : null}
    </section>

    <section className="panel page-stack"><div className="addon-section-heading"><div><span className="eyebrow">CURRENT INVENTORY</span><h2>已安装扩展</h2></div><span className="count-badge">{inventoryFresh ? addonItems.length : '—'}</span></div>
      {inventory.isPending && !inventory.data ? <p role="status">正在读取扩展列表…</p> : inventory.isError ? <ErrorState description={`无法确认当前扩展状态：${errorMessage(inventory.error)}。旧列表不会显示为当前状态。`} retry={() => void inventory.refetch()} />
        : !inventory.data ? <EmptyState title="扩展状态不可用" description="尚未取得后端确认的扩展清单。" /> : !inventoryFresh ? <p role="status">正在刷新；缓存内容暂不显示为当前状态。</p>
          : addonItems.length === 0 ? <EmptyState title="没有已安装扩展" description="后端确认当前启用与禁用目录中没有 JAR。暂存文件不会显示为已安装。" icon={<Boxes size={24} />} />
            : <div className="addon-list">{addonItems.map((item) => <AddonCard key={item.identity} item={item} busy={mutationBusy || !mutationReady} disabledReason={blockedReason}
              onAction={(action) => {
                const source = inventory.data!.data.items.find((candidate) => candidate.id === item.identity);
                if (source && action !== 'restore') requestAction({ action, item: source });
              }} />)}</div>}
    </section>

    <section className="panel page-stack"><div className="addon-section-heading"><div><span className="eyebrow">REVERSIBLE</span><h2>回收区</h2></div></div>
      <p className="muted">移到回收区不等于永久删除。恢复时会检查目标冲突，并保留原有启用或禁用状态。</p>
      {trash.isPending && !trash.data ? <p role="status">正在读取回收区…</p> : trash.isError ? <ErrorState title="回收区状态不可用" description={errorMessage(trash.error)} retry={() => void trash.refetch()} />
        : !trash.data ? <p>尚未读取回收区。</p> : trash.isFetching ? <p role="status">正在刷新回收区…</p> : !trashItems.length ? <p>回收区为空。</p>
          : <div className="addon-list">{trashItems.map((item) => <div className="addon-trash-entry" key={item.trashId}>
            <AddonCard item={item} busy={mutationBusy || !mutationReady || !trash.data!.data.items.find((t) => t.id === item.trashId)!.restoreAllowed}
            disabledReason={blockedReason} onAction={() => { const source = trash.data!.data.items.find((t) => t.id === item.trashId); if (source) requestAction({ action: 'restore', item: source }); }} />
            <p className="addon-trash-state">原状态：{trash.data!.data.items.find((t) => t.id === item.trashId)!.originalState === 'enabled' ? '已启用' : '已禁用'} · 可恢复</p>
          </div>)}</div>}
    </section>

    {operationId || operationState.kind === 'failed' || operationState.kind === 'recovery-required' || operationState.kind === 'outcome-unknown' ? <section className={`addon-banner ${operationState.kind === 'recovery-required' || operationState.kind === 'outcome-unknown' || operationState.kind === 'failed' ? 'addon-banner--danger' : ''}`}
      role={operationState.kind === 'failed' || operationState.kind === 'recovery-required' || operationState.kind === 'outcome-unknown' ? 'alert' : 'status'} aria-live="polite">
      <strong>{operationState.kind === 'accepted' ? '请求已受理，尚未确认完成' : operationState.kind === 'running' ? '扩展操作进行中' : operationState.kind === 'succeeded' ? '操作完成，列表已刷新' : operationState.kind === 'failed' ? '扩展操作失败' : operationState.kind === 'recovery-required' ? '操作需要恢复核验' : operationState.kind === 'outcome-unknown' ? '请求结果未确认' : '正在读取操作结果'}</strong>
      {operation ? <p>{operation.step} · {operation.progress === null ? '进度未知' : `${operation.progress}%`}{operation.result?.restartRequired ? ' · 需要重启才能生效' : ''}</p> : null}
      {operation?.error ? <p>{operation.error.code}: {operation.error.message}</p> : null}
      {operationState.kind === 'recovery-required' || operationState.kind === 'outcome-unknown' || operationState.kind === 'failed' ? <p>{operationState.message}</p> : null}
      {operationQuery.isError ? <p role="alert">无法读取操作结果，当前状态未确认；不要重复提交。<button className="button button--secondary" onClick={() => void operationQuery.refetch()}>刷新操作</button></p> : null}
    </section> : null}
    {actionMutation.isError && operationState.kind === 'idle' ? <p role="alert" className="inline-warning">{errorMessage(actionMutation.error)}</p> : null}
    {confirmation ? <ActionConfirmation target={confirmation} busy={actionMutation.isPending} onCancel={() => { setConfirmation(null); setOperationState({ kind: 'idle' }); }} onConfirm={() => {
      if (!serverId || !mutationReady || recoveryRequired || submissionInFlight.current || uploadInFlight.current || actionMutation.isPending) return;
      submissionInFlight.current = true;
      const next = { action: confirmation, key: crypto.randomUUID() } satisfies PendingAction;
      setOperationId(undefined); setPendingAction(next); setConfirmation(null); setOperationState({ kind: 'submitting' });
      actionMutation.mutate(next, { onSuccess: (response) => {
        const accepted = response.data.operation;
        if (accepted.serverId !== serverId || accepted.kind !== 'addon-change' || !safeOperationId(accepted.id)) {
          setOperationState({ kind: 'outcome-unknown', message: '受理响应无法与本实例匹配。禁止重复提交，请刷新状态。' }); return;
        }
        terminalHandled.current.delete(accepted.id);
        setOperationId(accepted.id); setOperationState({ kind: 'accepted', operationId: accepted.id });
      }, onError: (error) => {
        const definite = error instanceof ApiClientError && error.kind === 'http' && error.status !== undefined && error.status >= 400 && error.status < 500;
        if (!definite) setOperationState({ kind: 'outcome-unknown', message: `${errorMessage(error)} 请求结果未确认；禁止重复提交。` });
        else if (error instanceof ApiClientError && error.code?.includes('RECOVERY_REQUIRED')) setOperationState({ kind: 'recovery-required', message: errorMessage(error) });
        else setOperationState({ kind: 'failed', message: errorMessage(error) });
        if (definite) setPendingAction(null);
        if (definite && !(error instanceof ApiClientError && error.code?.includes('RECOVERY_REQUIRED'))) submissionInFlight.current = false;
        void Promise.all([inventory.refetch(), trash.refetch(), status.refetch()]);
      } });
    }} /> : null}
  </div>;
}
