import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorldImportUploadResponse, WorldImportUploadsResponse } from '@mcsm/contracts';
import { api, errorMessage } from '../api';
import { WorldImportAction } from './WorldImportAction';

export function WorldImportUpload({ serverId }: { serverId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<WorldImportUploadResponse['data'] | null>(null);
  const [uploads, setUploads] = useState<WorldImportUploadsResponse['data'] | null>(null);
  const [listError, setListError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [discarding, setDiscarding] = useState<string | null>(null);
  const [selectedImport, setSelectedImport] = useState<string | null>(null);
  const refreshUploads = useCallback(() => setRefresh((value) => value + 1), []);
  const usableImport = uploads?.items.some((item) => item.id === selectedImport && item.state === 'validated') ? selectedImport : null;
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const abort = new AbortController(); setListError('');
    void api.worldImportUploads(serverId, abort.signal).then((response) => { if (!abort.signal.aborted) setUploads(response.data); })
      .catch((error: unknown) => { if (!abort.signal.aborted) { setUploads(null); setListError(errorMessage(error)); } });
    return () => abort.abort();
  }, [serverId, refresh]);
  const select = (selected?: File) => {
    setResult(null); setMessage('');
    if (!selected || !/\.zip$/iu.test(selected.name) || selected.size < 1 || selected.size > 128 * 1024 ** 2) {
      setFile(null); setMessage('请选择非空且不超过 128 MiB 的 .zip 世界文件。'); return;
    }
    setFile(selected);
  };
  return <section className="resource-card page-stack">
    <h2>上传并校验世界 ZIP</h2>
    <p className="muted">先在私有暂存区检查结构和版本。上传不会停止服务器或切换世界；实际导入需要另外校验计划并明确确认。</p>
    <p className="muted">所有实例共享最多三次暂存上传。失败、中断和成功都计入配额。自动清理默认关闭；明确开启后，新上传前才会安全清理过期且无引用的暂存。网络结果不确定时请先刷新记录，避免重复上传。明确丢弃只删除选中的私有暂存文件，无法恢复，不影响现世界。</p>
    <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
      event.preventDefault(); if (!busy) select(event.dataTransfer.files.length === 1 ? event.dataTransfer.files[0] : undefined);
    }}>
      <label className="field-label">世界 ZIP（也可拖入一个文件）
        <input type="file" accept=".zip,application/zip" disabled={busy} onChange={(event) => select(event.target.files?.[0])} />
      </label>
    </div>
    {file ? <p>{file.name} · {(file.size / 1024 ** 2).toFixed(1)} MiB</p> : null}
    <button className="button button--secondary" disabled={busy || Boolean(discarding) || !file || Boolean(result) || uploads?.occupiedSlots === 3} onClick={() => {
      if (!file || busy) return;
      const abort = new AbortController(); controller.current = abort;
      setBusy(true); setMessage(''); setResult(null);
      void api.uploadWorldZip(serverId, file, abort.signal).then((response) => {
        if (!abort.signal.aborted) setResult(response.data);
      }).catch((error: unknown) => { if (!abort.signal.aborted) setMessage(errorMessage(error)); })
        .finally(() => { if (!abort.signal.aborted) { setBusy(false); setRefresh((value) => value + 1); } });
    }}>{busy ? '正在上传并校验…' : '上传并校验'}</button>
    {message ? <p role="alert" className="inline-warning">{message}</p> : null}
    {result ? <div role="status"><p>ZIP 已校验并暂存，尚未导入。</p>
      <p>版本 {result.minecraftVersion} · {result.fileCount} 个文件 · {(result.sizeBytes / 1024 ** 2).toFixed(1)} MiB</p>
      <p className="muted">请在暂存记录中选择导入，再校验计划并明确确认。</p>
    </div> : null}
    <div className="page-stack">
      <h3>暂存记录</h3>
      <button className="button button--secondary" disabled={busy || Boolean(discarding)} onClick={() => setRefresh((value) => value + 1)}>刷新暂存记录</button>
      {listError ? <p role="alert" className="inline-warning">{listError}</p> : null}
      {uploads ? <><p className="muted">全局暂存配额：{uploads.occupiedSlots} / {uploads.limit}；这里只显示当前实例记录。</p>
        {!uploads.items.length ? <p>当前实例没有暂存记录。</p> : uploads.items.map((item) => <div className="page-stack" key={item.id}>
          <p style={{ overflowWrap: 'anywhere' }}>{item.id}</p>
          <p>{item.state === 'validated' ? '校验完成，尚未导入' : item.state === 'incomplete' ? '未完成，可检查后丢弃' : item.state === 'consumed' ? '导入事务已占用，保留暂存且不可丢弃' : '根目录身份未验证，需要人工检查'}</p>
          {item.lifecycle === 'failed' && <p>上传或校验失败；文件保留，可明确丢弃。</p>}
          {item.lifecycle === 'discard-pending' && <p>上次清理未完成；确认后可重试丢弃，不会自动删除。</p>}
          {item.lifecycle === 'requires-inspection' && <p>过期清理信息不完整；需要人工检查，不会自动清理。</p>}
          {item.expiresAt && item.state !== 'consumed' && <p>保留期限：{new Date(item.expiresAt).toLocaleString()}；过期后仍须通过安全检查才能清理。</p>}
          {item.importOperationId ? <p style={{ overflowWrap: 'anywhere' }}>导入操作 ID：{item.importOperationId}；失败后可在下方检查显式恢复计划。</p> : null}
          {item.state === 'validated' ? <button className="button button--secondary" disabled={busy || Boolean(discarding)} onClick={() => setSelectedImport(item.id)}>选择此暂存规划导入</button> : null}
          <button className="button button--secondary" disabled={busy || Boolean(discarding) || !item.discardAllowed} onClick={() => {
            if (!window.confirm(`永久丢弃暂存 ${item.id}？只删除私有上传文件，不影响当前世界；此操作无法恢复。`)) return;
            setDiscarding(item.id); setMessage('');
            void api.discardWorldImportUpload(serverId, item.id, { confirmUploadId: item.id, revision: item.revision })
              .then(() => { if (result?.id === item.id) setResult(null); if (selectedImport === item.id) setSelectedImport(null); })
              .catch((error: unknown) => setMessage(`${errorMessage(error)} 丢弃结果可能未确认；请稍后刷新暂存记录确认，不要自动重复请求。`))
              .finally(() => { setDiscarding(null); setRefresh((value) => value + 1); });
          }}>{discarding === item.id ? '正在丢弃…' : '明确丢弃暂存'}</button>
        </div>)}</> : null}
    </div>
    <WorldImportAction key={serverId} serverId={serverId} uploadId={usableImport} onLifecycle={refreshUploads} />
  </section>;
}
