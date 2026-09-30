import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from '@mcsm/contracts';
import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ApiClientError, api, errorMessage, shouldRetry } from './api';
import { AppShell } from './components/AppShell';
import { ConnectionBanner, EmptyState, ErrorState, MockBanner, PageHeading, SkeletonMetrics } from './components/Ui';
import { Dashboard } from './pages/Dashboard';
import { PhasePage, SettingsPage, type PhasePageKind } from './pages/PhasePage';
import { Servers } from './pages/Servers';
import { ConsolePage } from './pages/Console';
import { BackupsPage, WorldsPage } from './pages/WorldsBackups';

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
  return (
    <ErrorState
      title="实例不存在 / 已移除"
      description="链接中的实例 ID 不在当前服务器列表中。请选择一个仍然可用的实例。"
      secondary={<Link className="button button--secondary" to="/servers">返回 Servers</Link>}
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
    return <div className="page-stack"><PageHeading eyebrow="OVERVIEW" title="Dashboard" description="正在读取实例目录与最新快照…" /><SkeletonMetrics /></div>;
  }
  if (listError && !selectedId) {
    return <ErrorState description={errorMessage(listError)} retry={retryList} />;
  }
  if (invalidSelection) return <InvalidSelection />;
  if (!selectedId) {
    return <div className="page-stack">{mode === 'mock' ? <MockBanner /> : null}<PageHeading eyebrow="OVERVIEW" title="Dashboard" /><EmptyState title="没有可显示的服务器" description="当前实例列表为空。Phase 1 不提供未实现的注册操作，请等待本地接入功能。" /></div>;
  }
  if (overviewQuery.isPending) {
    return <div className="page-stack">{mode === 'mock' ? <MockBanner /> : null}<PageHeading eyebrow="OVERVIEW" title="Dashboard" description="正在读取服务器快照…" /><SkeletonMetrics /></div>;
  }
  if (overviewQuery.isError && !overviewQuery.data) {
    const isMissing = overviewQuery.error instanceof ApiClientError && overviewQuery.error.code === 'SERVER_NOT_FOUND';
    return (
      <ErrorState
        title={isMissing ? '实例不存在 / 已移除' : overviewQuery.error instanceof ApiClientError && overviewQuery.error.kind === 'schema' ? '后端响应格式异常' : '无法读取 Dashboard'}
        description={`${errorMessage(overviewQuery.error)}${overviewQuery.error instanceof ApiClientError && overviewQuery.error.requestId ? ` 请求 ID：${overviewQuery.error.requestId}` : ''}`}
        retry={() => void overviewQuery.refetch()}
        secondary={<Link className="button button--secondary" to="/servers">返回 Servers</Link>}
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
  const location = useLocation();
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
      features={healthQuery.data?.data.features}
      servers={servers}
      selectedId={selectedId}
      connectionState={connectionState}
    >
      {connectionError && (healthQuery.data || serversQuery.data) ? (
        <ConnectionBanner message={errorMessage(connectionError)} retry={retryCore} />
      ) : null}
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
            ? <div className="page-stack"><PageHeading eyebrow="INSTANCES" title="Servers" description="正在读取服务器列表…" /></div>
            : serversQuery.isError && !serversQuery.data
              ? <ErrorState description={errorMessage(serversQuery.error)} retry={() => void serversQuery.refetch()} />
              : <Servers items={servers} mode={mode ?? 'local'} stale={serversStale} />
        } />
        <Route path="/players" element={phaseRoute('players')} />
        <Route path="/worlds" element={invalidSelection ? <InvalidSelection /> : mode === 'local' ? <WorldsPage server={selectedServer} /> : phaseRoute('worlds')} />
        <Route path="/addons" element={phaseRoute('addons')} />
        <Route path="/console" element={consoleRoute} />
        <Route path="/performance" element={phaseRoute('performance')} />
        <Route path="/backups" element={invalidSelection ? <InvalidSelection /> : mode === 'local' ? <BackupsPage server={selectedServer} /> : phaseRoute('backups')} />
        <Route path="/crashes" element={phaseRoute('crashes')} />
        <Route path="/settings" element={invalidSelection ? <InvalidSelection /> : <SettingsPage features={healthQuery.data?.data.features} />} />
        <Route path="*" element={<Navigate to={`/dashboard${selectedId ? `?server=${encodeURIComponent(selectedId)}` : ''}`} replace />} />
      </Routes>
    </AppShell>
  );
}
