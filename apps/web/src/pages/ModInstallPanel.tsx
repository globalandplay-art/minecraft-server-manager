import type { AddonUploadResponse } from '@mcsm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, ApiClientError, errorMessage, shouldRetry } from '../api';

export function ModInstallPanel({ serverId, serverName, stage, revision, inventoryFresh, locked, onBusy, onUnknown, onInstalled }: {
  serverId: string; serverName: string; stage: AddonUploadResponse['data']; revision: string; inventoryFresh: boolean;
  locked: boolean; onBusy: (busy: boolean) => void; onUnknown: () => void; onInstalled: () => void;
}) {
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false), [ack, setAck] = useState(false);
  const [operationId, setOperationId] = useState<string>(), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false), handled = useRef(false);
  const status = useQuery({ queryKey: ['mod-install-server', serverId], queryFn: () => api.server(serverId), retry: shouldRetry,
    refetchInterval: 5000, refetchIntervalInBackground: false, refetchOnWindowFocus: false });
  const operation = useQuery({ queryKey: ['mod-install-operation', serverId, operationId], queryFn: () => api.operation(operationId!),
    enabled: Boolean(operationId), retry: shouldRetry, refetchIntervalInBackground: false,
    refetchInterval: query => document.hidden || ['succeeded', 'failed', 'interrupted'].includes(query.state.data?.data.state ?? '') ? false : 1000 });
  const current = status.data?.data.status;
  const age = current ? Date.now() - Date.parse(current.observedAt) : Infinity;
  const ready = !locked && !busy && inventoryFresh && !status.isError && !status.isFetching && age >= 0 && age <= 15000 &&
    status.data?.data.server.id === serverId && status.data.data.server.type === stage.loader &&
    current?.state === 'stopped' && current.ownership === 'none' && !current.recoveryRequired && !current.activeOperationId;
  useEffect(() => {
    const op = operation.data?.data;
    if (!op || handled.current || !['succeeded', 'failed', 'interrupted'].includes(op.state)) return;
    handled.current = true;
    void (async () => {
      if (op.id !== operationId || op.serverId !== serverId || op.kind !== 'addon-change') {
        setMessage('操作身份不匹配，结果未知，请保留证据。'); onUnknown(); return;
      }
      try {
        const [listed, observed] = await Promise.all([client.fetchQuery({ queryKey: ['addons', serverId],
          queryFn: () => api.addons(serverId), staleTime: 0 }), api.server(serverId)]);
        if (op.state === 'interrupted' || observed.data.status.recoveryRequired || op.error?.code.includes('RECOVERY_REQUIRED')) {
          setMessage('安装需要恢复检查，禁止重复提交；保护快照和暂存证据已保留。'); onUnknown(); return;
        }
        if (op.state === 'succeeded') {
          if (!listed.data.items.some(item => item.state === 'enabled' && item.filename === stage.filename && item.sha256 === stage.checksumSha256)) {
            setMessage('操作已结束，但安装文件未能核对，结果未知。'); onUnknown(); return;
          }
          onBusy(false); onInstalled();
        } else {
          setMessage(op.error?.message ?? '安装失败，请刷新并检查文件。'); submitting.current = false; setBusy(false); onBusy(false);
        }
      } catch { setMessage('操作已结束，但最新清单或状态未确认，结果未知，请勿重复安装。'); onUnknown(); }
    })();
  }, [operation.data, operationId, serverId, stage.filename, stage.checksumSha256, onBusy, onUnknown, onInstalled, client]);
  async function install() {
    if (submitting.current || !ready || !ack) return;
    submitting.current = true; setBusy(true); onBusy(true); setMessage('');
    try {
      const result = await api.installAddon(serverId, { uploadId: stage.id, uploadRevision: stage.revision,
        inventoryRevision: revision, confirmUnknownCompatibility: true }, crypto.randomUUID());
      const op = result.data.operation;
      if (op.serverId !== serverId || op.kind !== 'addon-change') throw new Error('operation identity mismatch');
      handled.current = false; setOperationId(op.id); setConfirm(false);
    } catch (error) {
      const definite = error instanceof ApiClientError && error.kind === 'http' && error.status !== undefined && error.status >= 400 && error.status < 500 &&
        !error.code?.includes('RECOVERY_REQUIRED');
      setMessage(`${errorMessage(error)}${definite ? '' : ' 安装结果未知，禁止重复提交。'}`);
      if (definite) { submitting.current = false; setBusy(false); onBusy(false); } else onUnknown();
    }
  }
  return <section className="addon-stage">
    <button className="button button--primary" disabled={!ready} onClick={() => { setConfirm(true); setAck(false); }}>安装已校验模组</button>
    {!ready && !busy ? <p>需要新鲜清单、已确认停止的实例，且没有活动操作或恢复锁。</p> : null}
    {busy ? <p role="status">{locked ? '安装状态需要检查，不要重复提交。' : '正在处理安装；不会自动停服或启动。'}{operationId ? ` 操作：${operationId}` : ''}</p> : null}
    {operation.isError ? <p role="alert">操作状态读取失败，保留操作编号，不要重复提交。</p> : null}
    {message ? <p role="alert">{message}</p> : null}
    {confirm ? <section role="dialog" aria-label="确认模组安装" className="panel" style={{ overflowWrap: 'anywhere' }}>
      <h3>确认模组安装</h3><p>目标：{serverName} · 文件：{stage.filename}</p>
      <p>将创建完整保护快照并安装；需要之后手动启动或重启才会加载，不会自动执行。</p>
      <p>版本范围、依赖、适用端和第三方代码安全未验证。安装确认不代表兼容性通过；运行时可能无法加载或发生异常。</p>
      <label><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} disabled={busy} />我已核对模组来源及依赖，接受未知兼容性和第三方代码风险</label>
      <div className="confirm-dialog__actions"><button className="button button--secondary" disabled={busy} onClick={() => setConfirm(false)}>取消</button>
        <button className="button button--primary" disabled={!ready || !ack} onClick={() => void install()}>确认安装</button></div>
    </section> : null}
  </section>;
}
