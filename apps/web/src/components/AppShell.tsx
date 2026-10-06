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

type ServerSummary = ServersResponse['data']['items'][number];
type Features = HealthResponse['data']['features'];

const navItems = [
  { to: '/dashboard', label: 'Dashboard', feature: 'dashboard', icon: LayoutDashboard },
  { to: '/servers', label: 'Servers', feature: 'servers', icon: Server },
  { to: '/players', label: 'Players', feature: 'players', icon: Users },
  { to: '/worlds', label: 'Worlds', feature: 'worlds', icon: Globe2 },
  { to: '/addons', label: 'Mods / Plugins', feature: 'addons', icon: Boxes },
  { to: '/console', label: 'Console', feature: 'console', icon: TerminalSquare },
  { to: '/performance', label: 'Performance', feature: 'performance', icon: Gauge },
  { to: '/backups', label: 'Backups', feature: 'backups', icon: DatabaseBackup },
  { to: '/crashes', label: 'Crash Analysis', feature: 'crashAnalysis', icon: Activity },
] as const;

function phaseLabel(feature: keyof Features, features?: Features) {
  const state = features?.[feature];
  if (!state) return '状态未知';
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
  const addonsUnsupported = selectedServer
    ? !selectedServer.capabilities.mods && !selectedServer.capabilities.plugins
    : false;

  return (
    <>
      <aside
        ref={drawerRef}
        className={`sidebar ${drawerOpen ? 'sidebar--open' : ''}`}
        role={drawerOpen ? 'dialog' : undefined}
        aria-label={drawerOpen ? '主导航抽屉' : '应用侧栏'}
        aria-modal={drawerOpen || undefined}
      >
        <div className="brand">
          <span className="brand__mark" aria-hidden="true"><MonitorCog size={20} /></span>
          <span><strong>MC Server</strong><small>Manager</small></span>
          <button className="icon-button sidebar__close" onClick={closeDrawer} aria-label="关闭导航">
            <X size={20} />
          </button>
        </div>
        <nav className="nav-list" aria-label="主导航">
          {navItems.map(({ to, label: defaultLabel, feature, icon: Icon }) => {
            const label = feature === 'addons' && selectedServer
              ? selectedServer.server.type === 'paper' && selectedServer.capabilities.plugins ? 'Plugins'
                : selectedServer.server.type === 'fabric' && selectedServer.capabilities.mods ? 'Mods' : defaultLabel
              : defaultLabel;
            const badge = feature === 'addons' && addonsUnsupported
              ? '不支持'
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
            <span>Settings</span>
            <small className="phase-badge">只读</small>
          </NavLink>
          <div className="local-note">
            <span className="status-dot status-dot--success" aria-hidden="true" />
            <span><strong>本地管理模式</strong><small>仅监听此电脑</small></span>
          </div>
        </div>
      </aside>
      {drawerOpen ? (
        <button className="drawer-overlay" onClick={closeDrawer} aria-label="关闭导航遮罩" />
      ) : null}
    </>
  );
}

interface AppShellProps {
  children: ReactNode;
  features?: Features | undefined;
  servers: ServerSummary[];
  selectedId?: string | undefined;
  connectionState: 'connecting' | 'connected' | 'error';
}

export function AppShell({ children, features, servers, selectedId, connectionState }: AppShellProps) {
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
            <button
              ref={menuButtonRef}
              className="icon-button menu-button"
              onClick={() => setDrawerOpen(true)}
              aria-label="打开主导航"
              aria-expanded={drawerOpen}
            >
              <Menu size={21} />
            </button>
            <div className="mobile-server-name" title={selectedServer?.server.name}>
              {selectedServer?.server.name ?? '未选择实例'}
            </div>
            <label className="server-switcher">
              <span>当前实例</span>
              <span className="select-wrap">
                <select
                  value={selectedServer?.server.id ?? ''}
                  onChange={(event) => updateServer(event.target.value)}
                  disabled={servers.length === 0}
                  aria-label="选择服务器实例"
                >
                  {selectedId && !selectedServer ? <option value="">实例不可用，请重新选择</option> : null}
                  {servers.length === 0 ? <option value="">暂无实例</option> : null}
                  {servers.map((item) => (
                    <option key={item.server.id} value={item.server.id}>{item.server.name}</option>
                  ))}
                </select>
                <ChevronDown size={16} aria-hidden="true" />
              </span>
            </label>
          </div>
          <div className="topbar__status" aria-live="polite">
            <span className="topbar-chip">本地模式</span>
            <span className={`topbar-chip ${connectionState === 'connected' ? 'topbar-chip--success' : connectionState === 'error' ? 'topbar-chip--danger' : ''}`}>
              <span className={`status-dot ${connectionState === 'connected' ? 'status-dot--success' : connectionState === 'error' ? 'status-dot--danger' : 'status-dot--warning'}`} aria-hidden="true" />
              API {connectionState === 'connected' ? '已连接' : connectionState === 'error' ? '连接异常' : '连接中'}
            </span>
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
