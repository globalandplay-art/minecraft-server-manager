import type { ServersResponse } from '@mcsm/contracts';
import { ArrowRight, Box, Database, Server as ServerIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, MockBanner, PageHeading, StatusBadge } from '../components/Ui';
import { formatLocalTime, localTimezoneLabel, statusLabels } from '../format';

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

export function Servers({ items, mode, stale = false }: { items: ServerSummary[]; mode: 'mock' | 'local'; stale?: boolean }) {
  if (items.length === 0) {
    return (
      <div className="page-stack">
        {mode === 'mock' ? <MockBanner /> : null}
        <PageHeading eyebrow="INSTANCES" title="Servers" description="本页只读取已注册实例，不会扫描或修改本地目录。" />
        <EmptyState
          title="尚未接入服务器实例"
          description="Phase 1 不提供实例注册。后续本地接入流程会要求明确选择受控目录并完成安全校验。"
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
        description={`只读实例目录 · 状态时间按 ${localTimezoneLabel()} 显示`}
        aside={<span className="count-badge">{items.length} 个实例</span>}
      />
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
          </article>
        ))}
      </div>
      <div className="read-only-note"><Database size={17} /><span><strong>只读视图</strong>Phase 1 不会启动、停止或写入这些实例。</span></div>
    </div>
  );
}
