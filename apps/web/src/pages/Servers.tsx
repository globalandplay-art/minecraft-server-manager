import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import { renderMessage, type UiMessage } from '../i18n/message';
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
    server.capabilities.mods ? i18n.t('nav.mods') : null,
    server.capabilities.plugins ? i18n.t('nav.plugins') : null,
    server.capabilities.console ? i18n.t('nav.console') : null,
    server.capabilities.worlds ? i18n.t('nav.worlds') : null,
  ].filter(Boolean);
  return labels.length ? labels.join(' · ') : i18n.t('servers.noCapabilities');
}

export function Servers({ items, mode, stale = false, onRegistered, onRemoved }: { items: ServerSummary[]; mode: 'mock' | 'local'; stale?: boolean; onRegistered?: () => void; onRemoved?: (id: string) => void }) {
  const { t } = useTranslation();
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [notice, setNotice] = useState<UiMessage>('');
  const removed = (id: string, message?: UiMessage) => { setNotice(message ?? { key: 'servers.removed' }); setCatalogRevision(value => value + 1); onRemoved?.(id); };
  const mockHelp = mode === 'mock' ? <div className="settings-panel"><h2>{i18n.t('servers.addExisting')}</h2><p>{i18n.t('servers.mockHelp')}</p><code>$env:MCSM_MODE='local'; npm.cmd run dev</code><p>{i18n.t('servers.closeOldManager')}</p></div> : null;
  if (items.length === 0) {
    return (
      <div className="page-stack">
        {mode === 'mock' ? <MockBanner /> : null}
        <PageHeading eyebrow={i18n.t('monitor.instances')} title={t('nav.servers')} description={i18n.t('servers.description')} />
        {mockHelp}
        {notice ? <p role="status">{renderMessage(notice)}</p> : null}
        {mode === 'local' ? <ServerRegistration key={catalogRevision} onLoaded={onRegistered} onRemoved={removed} /> : null}
        <EmptyState
          title={i18n.t('servers.emptyTitle')}
          description={mode === 'mock' ? i18n.t('servers.emptyMock') : i18n.t('servers.emptyLocal')}
          icon={<ServerIcon size={25} />}
        />
      </div>
    );
  }

  return (
    <div className="page-stack">
      {mode === 'mock' ? <MockBanner /> : null}
      <PageHeading
        eyebrow={i18n.t('monitor.instances')}
        title={t('nav.servers')}
        description={t('servers.timezone', { timezone: localTimezoneLabel() })}
        aside={<span className="count-badge">{t('servers.count', { count: items.length })}</span>}
      />
      {mockHelp}
      {notice ? <p role="status">{renderMessage(notice)}</p> : null}
      {mode === 'local' ? <ServerRegistration key={catalogRevision} onLoaded={onRegistered} onRemoved={removed} /> : null}
      {stale ? <div className="stale-banner" role="status">{i18n.t('servers.stale')}</div> : null}
      <div className="workspace-server-table" role="region" aria-label={i18n.t('nav.servers')} tabIndex={0}>
        <table><thead><tr><th>{i18n.t('nav.servers')}</th><th>{i18n.t('workspace.state')}</th><th>Java</th><th>{i18n.t('servers.capabilities')}</th><th>{i18n.t('servers.stateSample')}</th><th>{i18n.t('workspace.actions')}</th></tr></thead><tbody>
        {items.map((item) => (
          <tr key={item.server.id}>
            <td>
              <span className="server-type-icon"><Box size={20} /></span>
              <h2>{item.server.name}</h2>
              <p>{item.server.type.toUpperCase()} · Minecraft {item.server.minecraftVersion ?? i18n.t('servers.unknownVersion')}</p>
              {item.server.detection.warnings.length ? <p className="server-card__warning">{item.server.detection.warnings.join('；')}</p> : null}
            </td><td>
              <StatusBadge status={stale ? 'unknown' : item.status.state} mock={mode === 'mock'} />
            </td><td>{item.server.java.runtimeVersion ?? 'N/A'}</td><td>{capabilityLabel(item)}</td>
            <td>{stale ? <>{i18n.t('servers.lastState')}：{statusLabels[item.status.state] ?? item.status.state} · {formatLocalTime(item.status.observedAt)}</> : formatLocalTime(item.status.observedAt)}</td>
            <td className="workspace-row-actions"><Link className="button button--secondary" to={`/dashboard?server=${encodeURIComponent(item.server.id)}`}>
              {i18n.t('servers.openDashboard')} <ArrowRight size={16} />
            </Link>
            {mode === 'local' ? <ServerRemoval id={item.server.id} name={item.server.name} type={item.server.type}
              blocked={stale || item.status.state !== 'stopped' || item.status.ownership !== 'none' || item.status.recoveryRequired || item.status.activeOperationId !== null} onRemoved={removed} /> : null}
            </td></tr>
        ))}
        </tbody></table></div>
      <div className="read-only-note"><Database size={17} /><span>{i18n.t('servers.registrationNote')}</span></div>
    </div>
  );
}
