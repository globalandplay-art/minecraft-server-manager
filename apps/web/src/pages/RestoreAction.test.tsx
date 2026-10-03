import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, api } from '../api';
import { RestoreAction, RestoreHistory } from './RestoreAction';

vi.mock('../api', async (load) => ({ ...(await load<typeof import('../api')>()), api: {
  restorePlan: vi.fn(), rollbackPlan: vi.fn(), restore: vi.fn(), rollback: vi.fn(), operation: vi.fn(), restoreHistory: vi.fn()
} }));
const meta = { requestId: 'test', generatedAt: '2026-10-02T00:00:00Z', mode: 'local' as const };
const plan = { data: { worldName: 'world', worldRevision: 'a'.repeat(64), backupId: 'backup', minecraftVersion: '1.21.1', sizeBytes: 100, rollbackAvailable: false }, meta };
function view(rollback = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><RestoreAction serverId="vanilla" resourceId="backup" rollback={rollback} /></QueryClientProvider>);
}
async function approve() {
  fireEvent.change(await screen.findByLabelText('输入世界名确认覆盖'), { target: { value: 'world' } });
  fireEvent.click(screen.getByLabelText('我确认覆盖此世界，并允许必要的停服'));
}
describe('explicit restore confirmation and recoverable requests', () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); sessionStorage.clear();
    vi.mocked(api.restorePlan).mockResolvedValue(plan); vi.mocked(api.rollbackPlan).mockResolvedValue(plan);
    vi.mocked(api.operation).mockResolvedValue({ data: { id: '123e4567-e89b-42d3-a456-426614174000', state: 'succeeded', step: 'completed', error: null }, meta } as never);
    vi.mocked(api.restore).mockResolvedValue({ data: { operation: { id: '123e4567-e89b-42d3-a456-426614174000', state: 'queued' } }, meta } as never);
  });
  it('requires name and downtime consent, defaults to stopped, and waits for operation completion', async () => {
    view(); fireEvent.click(screen.getByRole('button', { name: '恢复世界' }));
    const submit = await screen.findByRole('button', { name: '确认恢复' }); expect(submit).toBeDisabled();
    await approve(); fireEvent.click(submit);
    await waitFor(() => expect(api.restore).toHaveBeenCalledWith('vanilla', 'backup', {
      confirmWorldName: 'world', worldRevision: 'a'.repeat(64), restoreScope: 'world-set', allowStop: true, startAfterRestore: false
    }, expect.any(String)));
    expect(await screen.findByText(/恢复状态：succeeded/)).toBeInTheDocument();
  });
  it('only starts when explicitly selected', async () => {
    view(); fireEvent.click(screen.getByRole('button', { name: '恢复世界' })); await approve();
    fireEvent.click(screen.getByLabelText(/恢复后启动服务器/)); fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));
    await waitFor(() => expect(api.restore).toHaveBeenCalledWith('vanilla', 'backup', expect.objectContaining({ startAfterRestore: true }), expect.any(String)));
  });
  it('reuses exact payload and key after disconnected response and remount', async () => {
    vi.mocked(api.restore).mockRejectedValue(new ApiClientError('连接中断', 'network'));
    const first = view(); fireEvent.click(screen.getByRole('button', { name: '恢复世界' })); await approve(); fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));
    await screen.findByRole('alert'); const call = vi.mocked(api.restore).mock.calls[0]!; first.unmount();
    view(); fireEvent.click(screen.getByRole('button', { name: '用相同请求确认状态' }));
    await waitFor(() => expect(api.restore).toHaveBeenCalledTimes(2)); expect(vi.mocked(api.restore).mock.calls[1]).toEqual(call);
  });
  it('preserves confirmation text after stale revision and allows explicit refresh', async () => {
    vi.mocked(api.restore).mockRejectedValue(new ApiClientError('世界已发生变化', 'http', 409, 'WORLD_REVISION_CONFLICT'));
    view(); fireEvent.click(screen.getByRole('button', { name: '恢复世界' })); await approve(); fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('世界已发生变化'); expect(screen.getByLabelText('输入世界名确认覆盖')).toHaveValue('world');
    const before = vi.mocked(api.restorePlan).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '刷新确认信息' })); await waitFor(() => expect(vi.mocked(api.restorePlan).mock.calls.length).toBeGreaterThan(before));
  });
  it('uses a distinct rollback endpoint and does not start automatically', async () => {
    vi.mocked(api.rollback).mockResolvedValue({ data: { operation: { id: '123e4567-e89b-42d3-a456-426614174000' } }, meta } as never);
    view(true); fireEvent.click(screen.getByRole('button', { name: '显式回滚' })); await approve(); fireEvent.click(screen.getByRole('button', { name: '确认回滚' }));
    await waitFor(() => expect(api.rollback).toHaveBeenCalledWith('vanilla', 'backup', expect.objectContaining({ startAfterRollback: false }), expect.any(String)));
    expect(api.restore).not.toHaveBeenCalled();
  });
  it('finds rollback actions from durable history after UI request state is lost', async () => {
    vi.mocked(api.restoreHistory).mockResolvedValue({ data: { items: [{ operationId: 'restore-1', backupId: 'backup', state: 'recovery-required', rollbackAvailable: true }] }, meta });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><RestoreHistory serverId="vanilla" /></QueryClientProvider>);
    expect(await screen.findByRole('button', { name: '显式回滚' })).toBeInTheDocument();
  });

  it.each(['succeeded', 'failed', 'interrupted'])('allows fresh confirmation and a new key/revision after terminal %s', async (state) => {
    vi.mocked(api.operation).mockResolvedValue({ data: { id: '123e4567-e89b-42d3-a456-426614174000', state, step: 'completed', error: null }, meta } as never);
    view(); fireEvent.click(screen.getByRole('button', { name: '恢复世界' })); await approve();
    fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));
    expect(await screen.findByText(new RegExp(`恢复状态：${state}`))).toBeInTheDocument();
    const first = vi.mocked(api.restore).mock.calls[0]!;
    vi.mocked(api.restorePlan).mockResolvedValue({ ...plan, data: { ...plan.data, worldRevision: 'b'.repeat(64) } });
    fireEvent.click(screen.getByRole('button', { name: '重新确认恢复' }));
    expect(await screen.findByLabelText('输入世界名确认覆盖')).toHaveValue('');
    expect(screen.getByLabelText('我确认覆盖此世界，并允许必要的停服')).not.toBeChecked();
    expect(screen.getByText(new RegExp(`恢复状态：${state}`))).toBeInTheDocument();
    await waitFor(() => expect(api.restorePlan).toHaveBeenCalledTimes(2));
    await approve(); fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));
    await waitFor(() => expect(api.restore).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.restore).mock.calls[1]![2]).toMatchObject({ worldRevision: 'b'.repeat(64), startAfterRestore: false });
    expect(vi.mocked(api.restore).mock.calls[1]![3]).not.toBe(first[3]);
  });
});
