import type { HealthResponse, ServersResponse } from '@mcsm/contracts';
import {
  Activity,
  Boxes,
  ChevronDown,
  DatabaseBackup,
  Gauge,
  Globe2,
  LayoutDashboard,
  Menu,
  MonitorCog,
  Server,
  Settings,
  TerminalSquare,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import { LanguageSelector } from './LanguageSelector';
import { ThemeSelector } from './Appearance';

type ServerSummary = ServersResponse['data']['items'][number];
type Features = HealthResponse['data']['features'];
function addonLabelKey(selectedServer?: ServerSummary) {
  if (selectedServer?.server.type === 'paper' && selectedServer.capabilities.plugins) return 'nav.plugins';
  if (selectedServer && (selectedServer.server.type === 'forge' || selectedServer.server.type === 'neoforge' || selectedServer.server.type === 'fabric' && selectedServer.capabilities.mods)) return 'nav.mods';
  return 'nav.addons';
}

const navItems = [
  { to: '/dashboard', labelKey: 'nav.dashboard', feature: 'dashboard', icon: LayoutDashboard },
  { to: '/servers', labelKey: 'nav.servers', feature: 'servers', icon: Server },
  { to: '/players', labelKey: 'nav.players', feature: 'players', icon: Users },
  { to: '/worlds', labelKey: 'nav.worlds', feature: 'worlds', icon: Globe2 },
  { to: '/addons', labelKey: 'nav.addons', feature: 'addons', icon: Boxes },
  { to: '/console', labelKey: 'nav.console', feature: 'console', icon: TerminalSquare },
  { to: '/performance', labelKey: 'nav.performance', feature: 'performance', icon: Gauge },
  { to: '/backups', labelKey: 'nav.backups', feature: 'backups', icon: DatabaseBackup },
  { to: '/crashes', labelKey: 'nav.crashes', feature: 'crashAnalysis', icon: Activity },
] as const;

function phaseLabel(feature: keyof Features, features?: Features) {
  const state = features?.[feature];
  if (!state) return i18n.t('common.unknownState');
  return state.implemented ? null : `P${state.phase}`;
}

interface SidebarProps {
  features?: Features | undefined;
  selectedServer?: ServerSummary | undefined;
  query: string;
  drawerOpen: boolean;
  closeDrawer: () => void;
  drawerRef: React.RefObject<HTMLElement | null>;
}

function Sidebar({
  features,
  selectedServer,
  query,
  drawerOpen,
  closeDrawer,
  drawerRef,
}: SidebarProps) {
  const { t } = useTranslation();
  const readOnlyMods = selectedServer?.server.type === 'forge' || selectedServer?.server.type === 'neoforge';
  const addonsUnsupported = !readOnlyMods && selectedServer
    ? !selectedServer.capabilities.mods && !selectedServer.capabilities.plugins
    : false;

  return (
    <>
      <aside
        ref={drawerRef}
        className={`sidebar ${drawerOpen ? 'sidebar--open' : ''}`}
        role={drawerOpen ? 'dialog' : undefined}
        aria-label={t(drawerOpen ? 'shell.drawer' : 'shell.sidebar')}
        aria-modal={drawerOpen || undefined}
      >
        <div className="brand">
          <span className="brand__mark" aria-hidden="true"><MonitorCog size={20} /></span>
          <span><strong>LT Manager</strong><small>Workspace</small></span>
          <button className="icon-button sidebar__close" onClick={closeDrawer} aria-label={t('shell.closeNav')}>
            <X size={20} />
          </button>
        </div>
        <nav className="nav-list" aria-label={t('shell.navigation')}>
          {navItems.map(({ to, labelKey, feature, icon: Icon }) => {
            const label = feature === 'addons' ? t(addonLabelKey(selectedServer)) : t(labelKey);
            const badge = feature === 'addons' && readOnlyMods ? t('common.limited') : feature === 'addons' && addonsUnsupported
              ? t('common.unsupported')
              : feature === 'addons' && (selectedServer?.capabilities.mods || selectedServer?.capabilities.plugins)
                ? null
                : phaseLabel(feature, features);
            return (
              <NavLink
                key={to}
                to={`${to}${query}`}
                className={({ isActive }) => `nav-item ${isActive ? 'nav-item--active' : ''}`}
                onClick={closeDrawer}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
                {badge ? <small className="phase-badge">{badge}</small> : null}
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar__footer">
          <NavLink
            to={`/settings${query}`}
            className={({ isActive }) => `nav-item ${isActive ? 'nav-item--active' : ''}`}
            onClick={closeDrawer}
          >
            <Settings size={18} aria-hidden="true" />
            <span>{t('nav.settings')}</span>
            <small className="phase-badge">{t('common.readOnly')}</small>
          </NavLink>
          <div className="local-note">
            <span className="status-dot status-dot--success" aria-hidden="true" />
            <span><strong>{t('shell.localManagement')}</strong><small>{t('shell.thisComputer')}</small></span>
          </div>
        </div>
      </aside>
      {drawerOpen ? (
        <button className="drawer-overlay" onClick={closeDrawer} aria-label={t('shell.closeOverlay')} />
      ) : null}
    </>
  );
}

interface AppShellProps {
  mode?: 'mock' | 'local' | undefined;
  children: ReactNode;
  features?: Features | undefined;
  servers: ServerSummary[];
  selectedId?: string | undefined;
  connectionState: 'connecting' | 'connected' | 'error';
}

export function AppShell({ children, features, servers, selectedId, connectionState, mode }: AppShellProps) {
  const { t } = useTranslation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const query = selectedId ? `?server=${encodeURIComponent(selectedId)}` : '';
  const selectedServer = servers.find((item) => item.server.id === selectedId);

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = drawerRef.current?.querySelector<HTMLElement>('a, button:not([disabled])');
    focusable?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDrawerOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const items = [...drawerRef.current.querySelectorAll<HTMLElement>('a, button:not([disabled])')];
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      menuButtonRef.current?.focus();
    };
  }, [drawerOpen]);

  const updateServer = (serverId: string) => {
    const params = new URLSearchParams(location.search);
    params.set('server', serverId);
    navigate(`${location.pathname}?${params.toString()}`);
  };

  return (
    <div className="app-shell">
      <Sidebar
        features={features}
        selectedServer={selectedServer}
        query={query}
        drawerOpen={drawerOpen}
        closeDrawer={() => setDrawerOpen(false)}
        drawerRef={drawerRef}
      />
      <div className="app-frame">
        <header className="topbar">
          <div className="topbar__leading">
            <span className="workspace-breadcrumb" aria-label={t('workspace.location')}>LT / {t(location.pathname === '/addons' ? addonLabelKey(selectedServer) : location.pathname === '/settings' ? 'nav.settings' : `nav.${({ '/whitelist': 'whitelist', '/dashboard': 'dashboard', '/servers': 'servers', '/players': 'players', '/worlds': 'worlds', '/addons': 'addons', '/console': 'console', '/performance': 'performance', '/backups': 'backups', '/crashes': 'crashes' } as Record<string, string>)[location.pathname] ?? 'dashboard'}`)}</span>
            <button
              ref={menuButtonRef}
              className="icon-button menu-button"
              onClick={() => setDrawerOpen(true)}
              aria-label={t('shell.openNav')}
              aria-expanded={drawerOpen}
            >
              <Menu size={21} />
            </button>
            <div className="mobile-server-name" title={selectedServer?.server.name}>
              {selectedServer?.server.name ?? t('shell.noSelection')}
            </div>
            <label className="server-switcher">
              <span>{t('shell.currentInstance')}</span>
              <span className="select-wrap">
                <select
                  value={selectedServer?.server.id ?? ''}
                  onChange={(event) => updateServer(event.target.value)}
                  disabled={servers.length === 0}
                  aria-label={t('shell.selectInstance')}
                >
                  {selectedId && !selectedServer ? <option value="">{t('shell.unavailableInstance')}</option> : null}
                  {servers.length === 0 ? <option value="">{t('shell.noInstances')}</option> : null}
                  {servers.map((item) => (
                    <option key={item.server.id} value={item.server.id}>{item.server.name}</option>
                  ))}
                </select>
                <ChevronDown size={16} aria-hidden="true" />
              </span>
            </label>
          </div>
          <div className="topbar__status" aria-live="polite">
            <LanguageSelector />
            <ThemeSelector compact />
            <span className="topbar-chip">{t(mode === 'mock' ? 'shell.mock' : mode === 'local' ? 'shell.local' : 'shell.readingMode')}</span>
            <span className={`topbar-chip ${connectionState === 'connected' ? 'topbar-chip--success' : connectionState === 'error' ? 'topbar-chip--danger' : ''}`}>
              <span className={`status-dot ${connectionState === 'connected' ? 'status-dot--success' : connectionState === 'error' ? 'status-dot--danger' : 'status-dot--warning'}`} aria-hidden="true" />
              API {t(connectionState === 'connected' ? 'shell.connected' : connectionState === 'error' ? 'shell.connectionError' : 'shell.connecting')}
            </span>
          </div>
        </header>
        <main className="main-content">{children}</main>
        <footer className="workspace-statusbar" aria-label={t('workspace.statusbar')}><span>LT Workspace</span><span>{selectedServer?.server.name ?? t('workspace.noInstance')}</span><span>{t(mode === 'mock' ? 'shell.mock' : mode === 'local' ? 'shell.local' : 'shell.readingMode')}</span><span>API: {t(connectionState === 'connected' ? 'shell.connected' : connectionState === 'error' ? 'shell.connectionError' : 'shell.connecting')}</span></footer>
      </div>
    </div>
  );
}
