import { useTranslation } from 'react-i18next';
import { i18n } from './i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { HealthResponse, ServersResponse } from '@mcsm/contracts';
import { Component, lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ApiClientError, api, errorMessage, shouldRetry } from './api';
import { AppShell } from './components/AppShell';
import { AuthenticationControls } from './components/Authentication';
import { ConnectionBanner, EmptyState, ErrorState, MockBanner, PageHeading, SkeletonMetrics } from './components/Ui';
import type { PhasePageKind } from './pages/PhasePage';

const Dashboard = lazy(() => import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })));
const PerformancePage = lazy(() => import('./pages/Performance').then((module) => ({ default: module.PerformancePage })));
const CrashAnalysisPage = lazy(() => import('./pages/CrashAnalysis').then((module) => ({ default: module.CrashAnalysisPage })));
const PhasePage = lazy(() => import('./pages/PhasePage').then((module) => ({ default: module.PhasePage })));
const SettingsPage = lazy(() => import('./pages/PhasePage').then((module) => ({ default: module.SettingsPage })));
const Servers = lazy(() => import('./pages/Servers').then((module) => ({ default: module.Servers })));
const ConsolePage = lazy(() => import('./pages/Console').then((module) => ({ default: module.ConsolePage })));
const BackupsPage = lazy(() => import('./pages/WorldsBackups').then((module) => ({ default: module.BackupsPage })));
const WorldsPage = lazy(() => import('./pages/WorldsBackups').then((module) => ({ default: module.WorldsPage })));
const PlayersPage = lazy(() => import('./pages/Players').then((module) => ({ default: module.PlayersPage })));
const PropertiesPage = lazy(() => import('./pages/Properties').then((module) => ({ default: module.PropertiesPage })));
const WhitelistPage = lazy(() => import('./pages/Whitelist').then((module) => ({ default: module.WhitelistPage })));
const AddonsPage = lazy(() => import('./pages/Addons').then((module) => ({ default: module.AddonsPage })));

function RouteLoading() {
  useTranslation();
  return (
    <div className="page-stack" role="status" aria-live="polite">
      <PageHeading eyebrow={i18n.t('monitor.loading')} title={i18n.t('app.loadingTitle')} description={i18n.t('app.loadingDescription')} />
      <SkeletonMetrics />
    </div>
  );
}

export class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  override componentDidCatch() {
    this.setState({ failed: true });
  }

  override render() {
    if (this.state.failed) {
      return (
        <div className="page-stack" role="alert">
          <PageHeading eyebrow={i18n.t('monitor.pageError')} title={i18n.t('app.pageErrorTitle')} description={i18n.t('app.pageErrorDescription')} />
          <div><button className="button button--secondary" type="button" onClick={() => window.location.reload()}>{i18n.t('app.reload')}</button></div>
        </div>
      );
    }

    return this.props.children;
  }
}

function interval(visibleMs: number, hiddenMs?: number) {
  return () => document.hidden ? (hiddenMs ?? false) : visibleMs;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

export function InvalidSelection() {
  useTranslation();
  return (
    <ErrorState
      title={i18n.t('app.invalidInstance')}
      description={i18n.t('app.invalidDescription')}
      secondary={<Link className="button button--secondary" to="/servers">{i18n.t('app.backServers')}</Link>}
    />
  );
}

function DashboardRoute({
  selectedId,
  invalidSelection,
  listLoading,
  listError,
  mode,
  retryList,
  coreConnectionError,
  lifecycleFeature,
}: {
  selectedId?: string | undefined;
  invalidSelection: boolean;
  listLoading: boolean;
  listError?: Error | null | undefined;
  mode?: 'mock' | 'local' | undefined;
  retryList: () => void;
  coreConnectionError: boolean;
  lifecycleFeature?: HealthResponse['data']['features']['lifecycle'] | undefined;
}) {
  useTranslation();
  const overviewQuery = useQuery({
    queryKey: ['overview', selectedId],
    queryFn: ({ signal }) => api.overview(selectedId!, signal),
    enabled: Boolean(selectedId) && !invalidSelection,
    retry: shouldRetry,
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 2_000),
    refetchInterval: interval(5_000),
    refetchIntervalInBackground: false,
  });
  const now = useNow(Boolean(overviewQuery.data));
  const forceStale = Boolean(overviewQuery.data && now - overviewQuery.dataUpdatedAt > 15_000);

  if (listLoading) {
    return <div className="page-stack"><PageHeading eyebrow={i18n.t('monitor.overview')} title={i18n.t('nav.dashboard')} description={i18n.t('app.readingCatalog')} /><SkeletonMetrics /></div>;
  }
  if (listError && !selectedId) {
    return <ErrorState description={errorMessage(listError)} retry={retryList} />;
  }
  if (invalidSelection) return <InvalidSelection />;
  if (!selectedId) {
    return <div className="page-stack">{mode === 'mock' ? <MockBanner /> : null}<PageHeading eyebrow={i18n.t('monitor.overview')} title={i18n.t('nav.dashboard')} /><EmptyState title={i18n.t('app.noServers')} description={i18n.t('app.emptyServers')} /></div>;
  }
  if (overviewQuery.isPending) {
    return <div className="page-stack">{mode === 'mock' ? <MockBanner /> : null}<PageHeading eyebrow={i18n.t('monitor.overview')} title={i18n.t('nav.dashboard')} description={i18n.t('app.readingSnapshot')} /><SkeletonMetrics /></div>;
  }
  if (overviewQuery.isError && !overviewQuery.data) {
    const isMissing = overviewQuery.error instanceof ApiClientError && overviewQuery.error.code === 'SERVER_NOT_FOUND';
    return (
      <ErrorState
        title={isMissing ? i18n.t('app.invalidInstance') : overviewQuery.error instanceof ApiClientError && overviewQuery.error.kind === 'schema' ? i18n.t('app.invalidResponse') : i18n.t('app.dashboardError')}
        description={`${errorMessage(overviewQuery.error)}${overviewQuery.error instanceof ApiClientError && overviewQuery.error.requestId ? ` ${i18n.t('app.requestId', { id: overviewQuery.error.requestId })}` : ''}`}
        retry={() => void overviewQuery.refetch()}
        secondary={<Link className="button button--secondary" to="/servers">{i18n.t('app.backServers')}</Link>}
      />
    );
  }
  if (!overviewQuery.data) return null;

  return (
    <>
      {overviewQuery.isError && !coreConnectionError ? (
        <ConnectionBanner message={errorMessage(overviewQuery.error)} retry={() => void overviewQuery.refetch()} />
      ) : null}
      <Dashboard
        overview={overviewQuery.data.data}
        generatedAt={overviewQuery.data.meta.generatedAt}
        mode={overviewQuery.data.meta.mode}
        forceStale={forceStale}
        refreshing={overviewQuery.isFetching}
        refresh={() => void overviewQuery.refetch()}
        lifecycleFeature={lifecycleFeature}
      />
    </>
  );
}

export function App() {
  useTranslation();
  const location = useLocation();
  const navigate = useNavigate(), queryClient = useQueryClient();
  const requestedId = new URLSearchParams(location.search).get('server') ?? undefined;
  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => api.health(signal),
    retry: shouldRetry,
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 2_000),
    refetchInterval: interval(10_000, 60_000),
    refetchIntervalInBackground: true,
  });
  const serversQuery = useQuery({
    queryKey: ['servers'],
    queryFn: ({ signal }) => api.servers(signal),
    retry: shouldRetry,
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 2_000),
    refetchInterval: interval(15_000),
    refetchIntervalInBackground: false,
  });
  const servers = serversQuery.data?.data.items ?? [];
  const listNow = useNow(Boolean(serversQuery.data));
  const serversStale = Boolean(
    serversQuery.data && listNow - serversQuery.dataUpdatedAt > 15_000,
  );
  const selectedId = requestedId ?? servers[0]?.server.id;
  const selectedServer = servers.find((item) => item.server.id === selectedId);
  const invalidSelection = Boolean(requestedId && serversQuery.data && !selectedServer);
  const mode = serversQuery.data?.meta.mode ?? healthQuery.data?.meta.mode;
  const listError = serversQuery.error as Error | null;
  const connectionState = healthQuery.isError || serversQuery.isError
    ? 'error'
    : healthQuery.isSuccess
      ? 'connected'
      : 'connecting';
  const connectionError = healthQuery.isError
    ? healthQuery.error
    : serversQuery.isError
      ? serversQuery.error
      : null;
  const retryCore = () => {
    void healthQuery.refetch();
    void serversQuery.refetch();
  };
  const removed = (id: string) => {
    void queryClient.cancelQueries({ predicate: query => query.queryKey.includes(id) });
    queryClient.removeQueries({ predicate: query => query.queryKey.includes(id) });
    const remaining = servers.filter(row => row.server.id !== id);
    queryClient.setQueryData<ServersResponse>(['servers'], current => current ? { ...current, data: { ...current.data, items: remaining } } : current);
    if (selectedId === id) {
      const search = new URLSearchParams(location.search);
      if (remaining[0]) search.set('server', remaining[0].server.id); else search.delete('server');
      void navigate({ pathname: location.pathname, search: search.toString() }, { replace: true });
    }
    void serversQuery.refetch();
  };

  const phaseRoute = (kind: PhasePageKind) => invalidSelection
    ? <InvalidSelection />
    : <PhasePage kind={kind} features={healthQuery.data?.data.features} server={selectedServer} />;
  const consoleRoute = invalidSelection
    ? <InvalidSelection />
    : mode === 'local' && selectedServer
      ? <ConsolePage server={selectedServer} feature={healthQuery.data?.data.features.console} stale={serversStale} />
      : phaseRoute('console');

  return (
    <AppShell
      mode={mode}
      features={healthQuery.data?.data.features}
      servers={servers}
      selectedId={selectedId}
      connectionState={connectionState}
    >
      <AuthenticationControls />
      {connectionError && (healthQuery.data || serversQuery.data) ? (
        <ConnectionBanner message={errorMessage(connectionError)} retry={retryCore} />
      ) : null}
      <RouteErrorBoundary key={location.pathname}>
        <Suspense fallback={<RouteLoading />}>
          <Routes>
        <Route path="/dashboard" element={
          <DashboardRoute
            selectedId={selectedId}
            invalidSelection={invalidSelection}
            listLoading={serversQuery.isPending}
            listError={listError}
            mode={mode}
            retryList={() => void serversQuery.refetch()}
            coreConnectionError={Boolean(connectionError)}
            lifecycleFeature={healthQuery.data?.data.features.lifecycle}
          />
        } />
        <Route path="/servers" element={
          serversQuery.isPending
            ? <div className="page-stack"><PageHeading eyebrow={i18n.t('monitor.instances')} title={i18n.t('nav.servers')} description={i18n.t('app.readingServers')} /></div>
            : serversQuery.isError && !serversQuery.data
              ? <ErrorState description={errorMessage(serversQuery.error)} retry={() => void serversQuery.refetch()} />
              : <Servers items={servers} mode={mode ?? 'local'} stale={serversStale} onRegistered={() => { void serversQuery.refetch(); }} onRemoved={removed} />
        } />
        <Route path="/players" element={invalidSelection ? <InvalidSelection /> : mode === 'local' && healthQuery.data?.data.features.players.implemented ? <PlayersPage key={selectedId} server={selectedServer} /> : phaseRoute('players')} />
        <Route path="/whitelist" element={invalidSelection ? <InvalidSelection /> : <WhitelistPage key={selectedId} server={selectedServer} />} />
        <Route path="/worlds" element={invalidSelection ? <InvalidSelection /> : mode === 'local' ? <WorldsPage server={selectedServer} /> : phaseRoute('worlds')} />
        <Route path="/addons" element={invalidSelection ? <InvalidSelection /> : <AddonsPage key={selectedId} server={selectedServer} />} />
        <Route path="/console" element={consoleRoute} />
        <Route path="/performance" element={invalidSelection ? <InvalidSelection /> : healthQuery.data?.data.features.performance.implemented ? <PerformancePage key={selectedId} server={selectedServer} /> : phaseRoute('performance')} />
        <Route path="/backups" element={invalidSelection ? <InvalidSelection /> : mode === 'local' ? <BackupsPage server={selectedServer} /> : phaseRoute('backups')} />
        <Route path="/crashes" element={invalidSelection ? <InvalidSelection /> : healthQuery.data?.data.features.crashAnalysis.implemented ? <CrashAnalysisPage key={selectedId} server={selectedServer} /> : phaseRoute('crashes')} />
        <Route path="/settings" element={invalidSelection ? <InvalidSelection /> : mode === 'local' ? <PropertiesPage key={selectedId} server={selectedServer} /> : <SettingsPage features={healthQuery.data?.data.features} />} />
        <Route path="*" element={<Navigate to={`/dashboard${selectedId ? `?server=${encodeURIComponent(selectedId)}` : ''}`} replace />} />
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
    </AppShell>
  );
}
