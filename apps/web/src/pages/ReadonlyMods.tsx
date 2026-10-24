import type { AddonUploadResponse, ServerSummary } from '@mcsm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { api, ApiClientError, errorMessage, shouldRetry } from '../api';
import { PageHeading } from '../components/Ui';
import { ModInstallPanel } from './ModInstallPanel';

/** Inert validation staging is separate from permission to mutate installed mods. */
export function ReadonlyModsPage({ server, renderLifecycle }: { server: ServerSummary;
  renderLifecycle?: ((locked: boolean, onBusy: (busy: boolean) => void) => ReactNode) | undefined }) {
  const client = useQueryClient();
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [staged, setStaged] = useState<AddonUploadResponse['data'] | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [installing, setInstalling] = useState(false), [installed, setInstalled] = useState(false);
  const inFlight = useRef(false);
  const installBusy = useCallback((busy: boolean) => { inFlight.current = busy; setInstalling(busy); }, []);
  const installUnknown = useCallback(() => { setUnknown(true); setUploadError('安装结果未知或需要恢复核验，请保留操作及保护快照，不要重复提交。'); }, []);
  async function selectFile(file?: File) {
    if (!file || inFlight.current || unknown || lifecycleBusy) return;
    setUploadError('');
    if (!/\.jar$/iu.test(file.name) || file.size < 1 || file.size > 64 * 1024 ** 2) {
      setUploadError('请选择非空且不超过 64 MiB 的 .jar 文件。'); return;
    }
    inFlight.current = true; setUploading(true); setStaged(null); setInstalled(false);
    try {
      const result = (await api.uploadAddon(server.server.id, file)).data;
      if (result.loader !== server.server.type || !('declaredMetadata' in result) || result.declaredMetadata.loader !== server.server.type) {
        setUnknown(true); setUploadError('暂存响应与当前实例不匹配，结果未知；请勿重复上传。'); return;
      }
      setStaged(result); inFlight.current = false;
    } catch (error) {
      const definite = error instanceof ApiClientError && error.kind === 'http' && error.status !== undefined && error.status >= 400 && error.status < 500 &&
        !error.code?.includes('RECOVERY_REQUIRED');
      setUnknown(!definite); if (definite) inFlight.current = false;
      setUploadError(`${errorMessage(error)}${definite ? '' : ' 暂存结果未知，请勿重复上传。'}`);
    } finally { setUploading(false); }
  }
  // Keep one bounded read alive through StrictMode/remount. Its result stays in
  // this instance's cache and cannot replace another instance's active result.
  const inventory = useQuery({ queryKey: ['addons', server.server.id], queryFn: () => api.addons(server.server.id),
    retry: (count, error) => error instanceof ApiClientError && error.code === 'ADDON_SCAN_BUSY' ? count < 2 : shouldRetry(count, error),
    refetchOnWindowFocus: false, staleTime: 0, gcTime: 30_000, refetchOnMount: 'always' });
  const items = inventory.isFetching ? [] : inventory.data?.data.items.filter(item =>
    [item.filename, ...(item.declaredMetadata?.mods.flatMap(mod => [mod.name, mod.id]) ?? [])].some(value => value.toLowerCase().includes(search.toLowerCase()))) ?? [];
  return <div className="page-stack addons-page">
    <PageHeading eyebrow="MOD INVENTORY" title="Mods" description={`${server.server.name} · ${server.server.type.toUpperCase()} · ${server.server.minecraftVersion ?? '版本未知'}`}
      aside={<button className="button button--secondary" onClick={() => void inventory.refetch({ cancelRefetch: false })} disabled={inventory.isFetching}><RefreshCw size={16} aria-hidden="true" />刷新清单</button>} />
    <section className="panel"><h2>模组文件清单（只读）</h2>
      <p>清单读取 mods 和 disabled-mods 目录。可先上传校验，安装另需停服和明确确认；{renderLifecycle ? '下方可在停服后管理启用、禁用与回收，均不自动重启。' : '暂未开放启用、禁用或移除。'}</p>
      <p>元数据仅展示文件声明，不代表文件兼容或已在 Minecraft 中加载；不执行 JAR，不扫描子目录，不展开版本占位符。</p>
      <label className="field-label">搜索文件名、模组名称或标识<input value={search} onChange={event => setSearch(event.target.value)} /></label>
    </section>
    <section className="panel addon-upload"><h2>上传校验（不安装）</h2>
      <p>仅验证 JAR 及声明，不写入服务器 mods 目录，不执行模组或自动重启。兼容性仍未知。每个实例最多保留 3 份暂存记录；失败记录也保留，不自动清理。</p>
      <label className="field-label">选择模组 JAR<input type="file" accept=".jar" disabled={uploading || unknown || installing || lifecycleBusy}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void selectFile(file); }} /></label>
      {uploading ? <p role="status">正在上传校验，不会自动重试…</p> : null}
      {uploadError ? <p role="alert">{uploadError}</p> : null}
      {staged && 'declaredMetadata' in staged ? <section aria-label="已校验暂存模组" style={{ overflowWrap: 'anywhere' }}>
        <h3>暂存校验通过，尚未安装</h3><p>{staged.filename} · {staged.loader} · {staged.sizeBytes} 字节</p>
        <p>兼容性：未知。上传不会改变下方已保存清单；安装需要单独确认。</p>
        <p>SHA-256：{staged.checksumSha256}</p>
        {staged.declaredMetadata.mods.map(mod => <p key={mod.id}>{mod.name} · {mod.id} ·
          {mod.versionStatus === 'unresolved' ? ` 未展开：${mod.version}` : mod.version ?? '未声明版本'}</p>)}
        <p>语言加载器范围：{staged.declaredMetadata.loaderVersion ?? '未声明'}</p>
        {staged.declaredMetadata.mods.flatMap(mod => mod.dependencies.map((dep, index) => <p key={`${mod.id}-${index}`}>
          {mod.id} → {dep.id} · {dep.versionRange ?? '未声明范围'} · {dep.requirement} · {dep.side}</p>))}
        {inventory.data?.data.installSupported ? <ModInstallPanel serverId={server.server.id} serverName={server.server.name}
          stage={staged} revision={inventory.data.data.revision} inventoryFresh={!inventory.isFetching && !inventory.isError} locked={unknown || lifecycleBusy}
          onBusy={installBusy} onUnknown={installUnknown} onInstalled={() => { setStaged(null); setInstalled(true);
            void client.invalidateQueries({ queryKey: ['addon-trash', server.server.id] }); }} /> : null}
      </section> : null}
    </section>
    {installed ? <p role="status">安装文件已核验，需要之后手动启动或重启才会加载。管理器未自动启动服务器。</p> : null}
    {inventory.isPending || inventory.isFetching ? <p role="status">正在读取模组文件…</p> : null}
    {inventory.isError ? <section className="panel" role="alert"><p>{errorMessage(inventory.error)}</p>
      {inventory.data ? <p>下方为旧清单，可能已过期，请刷新后核对。</p> : null}</section> : null}
    {inventory.data && !inventory.isFetching ? <p role="status">文件数：{inventory.data.data.items.length}；读取时间：{inventory.data.meta.generatedAt}</p> : null}
    {inventory.data && !inventory.isFetching && !items.length ? <p>{inventory.data.data.items.length ? '没有匹配的文件。' : '未发现模组 JAR 文件。'}</p> : null}
    {items.map(item => <article className="addon-card" key={item.id}>
      <h3 style={{ overflowWrap: 'anywhere' }}>{item.filename}</h3>
      <dl className="addon-card__details"><div><dt>所在目录</dt><dd>{item.state === 'enabled' ? 'mods' : 'disabled-mods'}</dd></div>
        <div><dt>文件大小</dt><dd>{item.sizeBytes} 字节</dd></div>
        <div><dt>兼容性</dt><dd>未知</dd></div><div><dt>SHA-256</dt><dd style={{ overflowWrap: 'anywhere' }}>{item.sha256}</dd></div>
      </dl>
      {item.declaredMetadata ? <section aria-label={`${item.filename} 的元数据声明`} style={{ overflowWrap: 'anywhere' }}>
        <p>元数据来源：{item.declaredMetadata.source}；声明格式：{item.declaredMetadata.loader === 'forge' ? 'Forge' : 'NeoForge'}</p>
        <p>语言加载器：{item.declaredMetadata.modLoader}；加载器范围：{item.declaredMetadata.loaderVersion ?? '未声明'}</p>
        {item.declaredMetadata.mods.map(mod => <div key={mod.id}>
          <h4 style={{ overflowWrap: 'anywhere' }}>{mod.name}</h4><p>模组标识：{mod.id}</p>
          <p style={{ overflowWrap: 'anywhere' }}>声明版本：{mod.versionStatus === 'unresolved' ? `未展开：${mod.version}` : mod.version ?? '未声明'}</p>
          {mod.dependencies.length ? <ul>{mod.dependencies.map((dependency, index) => <li key={`${dependency.id}-${index}`} style={{ overflowWrap: 'anywhere' }}>
            {dependency.id} · 声明范围：{dependency.versionRange === '' ? '空范围（未判定）' : dependency.versionRange ?? '未声明'} ·
            依赖类型：{({ required: '必需', optional: '可选', incompatible: '不兼容', discouraged: '不建议', unknown: '未知' })[dependency.requirement]} ·
            依赖适用端：{dependency.side}
          </li>)}</ul> : <p>未读取到依赖声明。</p>}
        </div>)}
      </section> : item.metadataStatus === 'missing' ? <p>未发现此加载器可识别的元数据声明。</p> : null}
      {item.metadataStatus === 'invalid' ? <p role="alert">JAR 结构或元数据校验未通过，请检查原文件。</p> : null}
    </article>)}
    {renderLifecycle?.(uploading || unknown || installing, setLifecycleBusy)}
  </div>;
}
