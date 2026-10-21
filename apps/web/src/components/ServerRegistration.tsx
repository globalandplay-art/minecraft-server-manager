import { useEffect, useRef, useState } from 'react';
import type { RegistrationCatalogResponse, RegistrationDraft, RegistrationPreviewResponse } from '@mcsm/contracts';
import { api, ApiClientError, errorMessage } from '../api';

export function ServerRegistration({ onLoaded }: { onLoaded?: () => void } = {}) {
  const [catalog, setCatalog] = useState<RegistrationCatalogResponse['data']>();
  const [draft, setDraft] = useState<RegistrationDraft>({ id: '', name: '', root: '', jarFile: 'server.jar', javaProfileId: '' });
  const [preview, setPreview] = useState<RegistrationPreviewResponse['data']>();
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false);
  const [message, setMessage] = useState('');
  const inFlight = useRef(false), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    void api.registrationCatalog(controller.signal).then(response => {
      if (controller.signal.aborted) return;
      setCatalog(response.data); setDraft(current => ({ ...current, javaProfileId: current.javaProfileId || response.data.profiles[0]?.id || '' }));
    }).catch(error => { if (!controller.signal.aborted) setMessage(errorMessage(error)); });
    return () => { mounted.current = false; controller.abort(); };
  }, []);
  const edit = (key: keyof RegistrationDraft, value: string) => {
    setDraft(current => ({ ...current, [key]: value })); setPreview(undefined); setConfirmed(false);
  };
  const check = async () => {
    if (inFlight.current || unknown) return;
    inFlight.current = true; setBusy(true); setMessage(''); setPreview(undefined); setConfirmed(false);
    try { const result = await api.registrationPreview(draft); if (mounted.current) setPreview(result.data); }
    catch (error) { if (mounted.current) setMessage(errorMessage(error)); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const save = async () => {
    if (inFlight.current || !preview || !confirmed || unknown) return;
    inFlight.current = true; setBusy(true); setMessage('');
    try {
      const response = await api.registrationSave(preview.token);
      if (!mounted.current) return;
      const loaded = response.data.loaded === true;
      setMessage(loaded ? `已登记并加载 ${response.data.name}，现在可以切换。未启动 Minecraft。`
        : `已登记 ${response.data.name}；暂未加载${response.data.loadErrorCode ? `（${response.data.loadErrorCode}）` : ''}，请检查后手动重启 Manager。不会自动启动 Minecraft。`);
      if (loaded) onLoaded?.();
      setCatalog(current => current ? {
        profiles: loaded ? [...current.profiles.filter(row => row.id !== response.data.id), { id: response.data.id, name: response.data.name }] : current.profiles,
        pending: loaded ? current.pending.filter(row => row.id !== response.data.id)
          : [...current.pending.filter(row => row.id !== response.data.id), { id: response.data.id, name: response.data.name }]
      } : current);
      setPreview(undefined); setConfirmed(false);
    } catch (error) {
      if (mounted.current) {
        const rejected = error instanceof ApiClientError && [400,401,403,409].includes(error.status ?? 0) && error.code !== 'REGISTRATION_RESULT_UNKNOWN';
        setUnknown(!rejected); setPreview(undefined); setConfirmed(false);
        setMessage(rejected ? `登记被拒绝：${errorMessage(error)}，请重新检查。` : `登记未能确认：${errorMessage(error)}。不会自动重试，请重新打开页面检查待加载实例。`);
      }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  return <section className="settings-panel registration-panel" aria-label="添加服务器实例">
    <h2>添加服务器实例</h2>
    <p>选择已有服务端目录并检查。安全初始化成功后立即加入实例列表；不会启动服务器、修改世界或接受 EULA。</p>
    <p>如旧状态需人工检查，登记会保留为待加载；不会自动重试或影响其他实例。</p>
    {catalog?.pending.length ? <div role="status"><h3>待重启 Manager 加载</h3><ul>{catalog.pending.map(row => <li key={row.id}>{row.name}（{row.id}）</li>)}</ul></div> : null}
    {!catalog?.profiles.length ? <p>请先在本地配置中建立一个可信 Java 配置，网页不能指定任意程序作为 Java。</p> : null}
    <form onSubmit={event => { event.preventDefault(); void check(); }}>
      <fieldset disabled={busy || unknown || !catalog?.profiles.length}>
        <legend>现有本地服务端</legend>
        <label className="field-label">实例标识<input required pattern="[a-z0-9][a-z0-9-]{0,62}" maxLength={63} value={draft.id} onChange={event => edit('id', event.target.value)} placeholder="survival-2" /></label>
        <label className="field-label">显示名称<input required maxLength={128} value={draft.name} onChange={event => edit('name', event.target.value)} /></label>
        <label className="field-label">服务端目录<input required maxLength={4096} value={draft.root} onChange={event => edit('root', event.target.value)} placeholder="C:\Minecraft\survival" /></label>
        <label className="field-label">启动 JAR 文件名<input required maxLength={128} value={draft.jarFile} onChange={event => edit('jarFile', event.target.value)} /></label>
        <label className="field-label">复用 Java 配置<select value={draft.javaProfileId} onChange={event => edit('javaProfileId', event.target.value)}>
          {catalog?.profiles.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select></label>
        <button type="submit" className="button button--secondary">{busy ? '正在处理…' : '检查实例'}</button>
      </fieldset>
    </form>
    {preview ? <div className="registration-preview">
      <h3>确认登记：{preview.server.name}</h3>
      <p>{preview.server.type.toUpperCase()} · Minecraft {preview.server.minecraftVersion ?? '版本未知'} · Java {preview.server.java.runtimeVersion ?? '未知'}</p>
      <p>{preview.lifecycleSupported ? '启动类型受支持；实际启动仍检查实例状态和 EULA。' : '当前仅识别和登记；启动能力尚未支持。'}</p>
      {!preview.eulaAccepted ? <p>EULA 尚未接受，启动将被拒绝；LT 不代为接受。</p> : null}
      {preview.server.detection.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
      <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />{preview.restartRequired ? '确认添加此目录；重启 Manager 后加载' : '确认添加此目录并立即加载'}</label>
      <button className="button button--primary" disabled={busy || !confirmed || unknown} onClick={() => void save()}>保存实例</button>
    </div> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
