import type { ServersResponse } from '@mcsm/contracts';
import { ArrowRight, Box, Database, Server as ServerIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, MockBanner, PageHeading, StatusBadge } from '../components/Ui';
import { formatLocalTime, localTimezoneLabel, statusLabels } from '../format';
import { ServerRegistration } from '../components/ServerRegistration';
import { ServerRemoval } from '../components/ServerRemoval';
import { useState } from 'react';

type ServerSummary = ServersResponse['data']['items'][number];

function capabilityLabel(server: ServerSummary) {
  const labels = [
    server.capabilities.mods ? 'Mods' : null,
    server.capabilities.plugins ? 'Plugins' : null,
    server.capabilities.console ? 'Console' : null,
    server.capabilities.worlds ? 'Worlds' : null,
  ].filter(Boolean);
  return labels.length ? labels.join(' · ') : '无扩展能力';
}

export function Servers({ items, mode, stale = false, onRegistered, onRemoved }: { items: ServerSummary[]; mode: 'mock' | 'local'; stale?: boolean; onRegistered?: () => void; onRemoved?: (id: string) => void }) {
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const removed = (id: string, message?: string) => { setNotice(message ?? '已移除登记，服务端文件保留。'); setCatalogRevision(value => value + 1); onRemoved?.(id); };
  const mockHelp = mode === 'mock' ? <div className="settings-panel"><h2>添加已有 Minecraft 服务器</h2><p>当前为 Mock 演示模式。添加和移除真实实例需要本地模式；在项目 PowerShell 运行：</p><code>$env:MCSM_MODE='local'; npm.cmd run dev</code><p>请先正常关闭旧 Manager，再启动本地模式。</p></div> : null;
  if (items.length === 0) {
    return (
      <div className="page-stack">
        {mode === 'mock' ? <MockBanner /> : null}
        <PageHeading eyebrow="INSTANCES" title="Servers" description="管理多个本地服务端实例。" />
        {mockHelp}
        {notice ? <p role="status">{notice}</p> : null}
        {mode === 'local' ? <ServerRegistration key={catalogRevision} onLoaded={onRegistered} onRemoved={removed} /> : null}
        <EmptyState
          title="尚未接入服务器实例"
          description={mode === 'mock' ? '请切换本地模式添加已有服务端。' : '请在上方检查并添加已有服务端目录；正常保存后立即加载，不会自动开服。'}
          icon={<ServerIcon size={25} />}
        />
      </div>
    );
  }

  return (
    <div className="page-stack">
      {mode === 'mock' ? <MockBanner /> : null}
      <PageHeading
        eyebrow="INSTANCES"
        title="Servers"
        description={`本地实例目录 · 状态时间按 ${localTimezoneLabel()} 显示`}
        aside={<span className="count-badge">{items.length} 个实例</span>}
      />
      {mockHelp}
      {notice ? <p role="status">{notice}</p> : null}
      {mode === 'local' ? <ServerRegistration key={catalogRevision} onLoaded={onRegistered} onRemoved={removed} /> : null}
      {stale ? <div className="stale-banner" role="status">服务器列表超过 15 秒未刷新成功，状态已降级为未知；以下保留上次结果供回看。</div> : null}
      <div className="servers-grid">
        {items.map((item) => (
          <article className="server-card" key={item.server.id}>
            <div className="server-card__top">
              <span className="server-type-icon"><Box size={20} /></span>
              <StatusBadge status={stale ? 'unknown' : item.status.state} mock={mode === 'mock'} />
            </div>
            <h2>{item.server.name}</h2>
            <p className="server-card__version">{item.server.type.toUpperCase()} · Minecraft {item.server.minecraftVersion ?? '版本未知'}</p>
            <dl className="server-card__details">
              <div><dt>Java</dt><dd>{item.server.java.runtimeVersion ?? 'N/A'}</dd></div>
              <div><dt>能力</dt><dd>{capabilityLabel(item)}</dd></div>
              <div><dt>{stale ? '上次状态' : '状态采样'}</dt><dd>{stale ? `${statusLabels[item.status.state] ?? item.status.state} · ${formatLocalTime(item.status.observedAt)}` : formatLocalTime(item.status.observedAt)}</dd></div>
            </dl>
            {item.server.detection.warnings.length ? (
              <p className="server-card__warning">{item.server.detection.warnings.join('；')}</p>
            ) : null}
            <Link className="button button--secondary button--full" to={`/dashboard?server=${encodeURIComponent(item.server.id)}`}>
              查看 Dashboard <ArrowRight size={16} />
            </Link>
            {mode === 'local' ? <ServerRemoval id={item.server.id} name={item.server.name} type={item.server.type}
              blocked={stale || item.status.state !== 'stopped' || item.status.ownership !== 'none' || item.status.recoveryRequired || item.status.activeOperationId !== null} onRemoved={removed} /> : null}
          </article>
        ))}
      </div>
      <div className="read-only-note"><Database size={17} /><span>添加只保存登记；通过 Dashboard 切换实例，生命周期操作需另行确认。</span></div>
    </div>
  );
}
