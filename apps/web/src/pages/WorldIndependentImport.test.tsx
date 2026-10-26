import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiClientError } from '../api';
import { i18n } from '../i18n';
import { WorldIndependentImport } from './WorldIndependentImport';

vi.mock('../api', async load => ({ ...await load<typeof import('../api')>(), api: {
  worldLibraryImportPlan: vi.fn(), importIndependentWorld: vi.fn(), operation: vi.fn(), worldLibrary: vi.fn()
} }));
const uploadId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const current = 'worldv2-33333333-3333-4333-8333-333333333333';
const installed = 'worldv2-44444444-4444-4444-8444-444444444444';
const meta = { requestId: 'test', generatedAt: '2026-10-25T12:00:00.000Z', mode: 'local' as const };
const body = { mode: 'independent' as const, name: 'Independent', uploadId, uploadRevision: 'a'.repeat(64),
  libraryRevision: 'b'.repeat(64), currentWorldId: current, currentWorldRevision: 'c'.repeat(64) };
const plan = { ...body, executionAvailable: true as const, serverMustBeStopped: true as const, changesActiveWorld: false as const };
const operation = { id: operationId, serverId: 'server-a', kind: 'world-library-import' as const, state: 'succeeded' as const,
  step: 'completed', progress: 100, createdAt: meta.generatedAt, updatedAt: meta.generatedAt,
  result: { resourceId: installed, rollbackAvailable: false }, error: null };
const library = { serverId: 'server-a', state: 'ready' as const, reason: null, revision: 'd'.repeat(64), activeWorldId: current,
  mutationsAvailable: true, items: [{ worldId: installed, levelName: 'Independent', state: 'present' as const, origin: 'import' as const,
    createdAt: meta.generatedAt, legacySlotId: null, legacyBackupAssociation: 'unverified' as const }] };
function view(serverId = 'server-a', selected: string | null = uploadId) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}><WorldIndependentImport serverId={serverId} uploadId={selected} /></QueryClientProvider>) };
}
async function prepare() {
  fireEvent.change(screen.getByLabelText('新存档名称'), { target: { value: 'Independent' } });
  fireEvent.click(screen.getByRole('button', { name: '检查独立导入计划' }));
  await screen.findByText('计划已校验，尚未安装。');
}
beforeEach(async () => {
  sessionStorage.clear(); await i18n.changeLanguage('zh-CN');
  vi.mocked(api.worldLibraryImportPlan).mockResolvedValue({ data: plan, meta });
  vi.mocked(api.importIndependentWorld).mockResolvedValue({ data: { operation }, meta });
  vi.mocked(api.operation).mockResolvedValue({ data: operation, meta });
  vi.mocked(api.worldLibrary).mockResolvedValue({ data: library, meta });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); sessionStorage.clear(); });
describe('independent import frontend', () => {
  it.each([401, 403])('retains an unknown request across confirmation HTTP %s and remount', async status => {
    vi.mocked(api.importIndependentWorld)
      .mockRejectedValueOnce(new ApiClientError('response lost', 'network'))
      .mockRejectedValueOnce(new ApiClientError('not authorized', 'http', status));
    const rendered = view(); await prepare();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('worldv2.install') }));
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('worldv2.confirmOriginal') }));
    await screen.findByText('not authorized');
    const first = vi.mocked(api.importIndependentWorld).mock.calls[0]!;
    const saved = JSON.parse(sessionStorage.getItem('lt.pendingIndependentWorld.server-a')!);
    expect(saved).toEqual({ serverId: first[0], body: first[1], key: first[2] });
    expect(screen.queryByRole('button', { name: i18n.t('worldv2.plan') })).not.toBeInTheDocument();
    rendered.unmount(); rendered.client.clear(); view();
    expect(api.importIndependentWorld).toHaveBeenCalledTimes(2);
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('worldv2.confirmOriginal') }));
    await screen.findByText(i18n.t('worldv2.success'));
    expect(vi.mocked(api.importIndependentWorld).mock.calls).toEqual([first, first, first]);
  });
  it('requires explicit confirmation, submits the exact plan once and verifies the saved list', async () => {
    view(); await prepare(); expect(api.importIndependentWorld).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认新增独立存档' }));
    await screen.findByText('独立存档已安装，当前活动世界未改变。');
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Independent'));
    expect(api.importIndependentWorld).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.importIndependentWorld).mock.calls[0]?.slice(0, 2)).toEqual(['server-a', body]);
    expect(api.worldLibrary).toHaveBeenCalledWith('server-a', expect.any(AbortSignal));
  });
  it('never submits when confirmation is cancelled', async () => {
    vi.mocked(window.confirm).mockReturnValue(false); view(); await prepare();
    fireEvent.click(screen.getByRole('button', { name: '确认新增独立存档' })); expect(api.importIndependentWorld).not.toHaveBeenCalled();
  });
  it('preserves input and plan across Japanese/English switching without submitting', async () => {
    view(); await prepare();
    await act(async () => { await i18n.changeLanguage('ja'); });
    expect(screen.getByLabelText('新しいワールド名')).toHaveValue('Independent');
    expect(screen.getByRole('button', { name: '独立したワールドの追加を確定' })).toBeEnabled();
    await act(async () => { await i18n.changeLanguage('en'); });
    expect(screen.getByLabelText('New world name')).toHaveValue('Independent'); expect(api.importIndependentWorld).not.toHaveBeenCalled();
    expect(api.worldLibraryImportPlan).toHaveBeenCalledTimes(1);
  });
  it('never automatically resends unknown results and manual confirmation reuses the exact request/key', async () => {
    vi.mocked(api.importIndependentWorld).mockRejectedValueOnce(new ApiClientError('response lost', 'network'));
    view(); await prepare(); fireEvent.click(screen.getByRole('button', { name: '确认新增独立存档' }));
    const confirm = await screen.findByRole('button', { name: '用原请求确认' });
    expect(api.importIndependentWorld).toHaveBeenCalledTimes(1);
    fireEvent.click(confirm); await screen.findByText('独立存档已安装，当前活动世界未改变。');
    const calls = vi.mocked(api.importIndependentWorld).mock.calls;
    expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
  });
  it('does not claim success from the operation receipt when the final world list disagrees', async () => {
    vi.mocked(api.worldLibrary).mockResolvedValue({ data: { ...library, activeWorldId: installed }, meta });
    view(); await prepare(); fireEvent.click(screen.getByRole('button', { name: '确认新增独立存档' }));
    await screen.findByText('需要检查：不会自动重试安装或切换世界。请保留操作 ID 和恢复证据。');
    expect(screen.queryByText('独立存档已安装，当前活动世界未改变。')).not.toBeInTheDocument();
  });
  it('does not accept a late plan from another selected instance', async () => {
    let finish!: (value: Awaited<ReturnType<typeof api.worldLibraryImportPlan>>) => void;
    vi.mocked(api.worldLibraryImportPlan).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const rendered = view(); fireEvent.change(screen.getByLabelText('新存档名称'), { target: { value: 'Independent' } });
    fireEvent.click(screen.getByRole('button', { name: '检查独立导入计划' }));
    rendered.rerender(<QueryClientProvider client={rendered.client}><WorldIndependentImport serverId="server-b" uploadId={uploadId} /></QueryClientProvider>);
    await act(async () => { finish({ data: plan, meta }); });
    expect(screen.getByLabelText('新存档名称')).toHaveValue('');
    expect(screen.queryByRole('button', { name: '确认新增独立存档' })).not.toBeInTheDocument(); expect(api.importIndependentWorld).not.toHaveBeenCalled();
  });
  it('restores pending work by querying its operation, not by submitting again', async () => {
    sessionStorage.setItem('lt.pendingIndependentWorld.server-a', JSON.stringify({ serverId: 'server-a', key: uploadId, body, operationId }));
    view('server-a', null); await screen.findByText('独立存档已安装，当前活动世界未改变。');
    expect(api.importIndependentWorld).not.toHaveBeenCalled(); expect(api.worldLibraryImportPlan).not.toHaveBeenCalled();
  });
  it('does not submit if pending-request persistence fails', async () => {
    view(); await prepare(); vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
    fireEvent.click(screen.getByRole('button', { name: '确认新增独立存档' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('无法保存待处理请求'));
    expect(api.importIndependentWorld).not.toHaveBeenCalled();
  });
});
