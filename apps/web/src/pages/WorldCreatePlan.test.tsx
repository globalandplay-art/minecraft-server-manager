import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiClientError } from '../api';
import { WorldCreatePlan } from './WorldCreatePlan';
vi.mock('../api', async (original) => ({ ...await original<typeof import('../api')>(), api: { worldCreatePlan: vi.fn(), createWorld: vi.fn(), operation: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); sessionStorage.clear(); });
function show() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><WorldCreatePlan serverId="test" /></QueryClientProvider>); }
const meta = { requestId: 'test', generatedAt: '2026-10-02T00:00:00Z', mode: 'local' as const };
async function approveCreate() {
  vi.mocked(api.worldCreatePlan).mockResolvedValue({ data: { serverId: 'test', name: 'new', seed: '9223372036854775807', minecraftVersion: '26.3',
    currentWorldName: 'world', worldRevision: 'a'.repeat(64), requiresStop: true, executionAvailable: true, generation: 'on-explicit-start' }, meta });
  fireEvent.change(screen.getByLabelText('新世界名称'), { target: { value: 'new' } });
  fireEvent.change(screen.getByLabelText('Seed（留空为随机）'), { target: { value: '9223372036854775807' } });
  fireEvent.click(screen.getByRole('button', { name: '校验新世界计划' }));
  const button = await screen.findByRole('button', { name: '确认创建并保持停服' });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText('输入当前世界名确认切换'), { target: { value: 'world' } });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByLabelText('我确认保留旧世界，并允许必要停服'));
  fireEvent.click(button);
}
describe('new-world preview', () => {
  it('preserves exact seed and clearly reports preview only, resetting on edit', async () => {
    vi.mocked(api.worldCreatePlan).mockResolvedValue({ data: { serverId: 'test', name: 'new', seed: '9223372036854775807', minecraftVersion: '26.3',
      currentWorldName: 'world', worldRevision: 'a'.repeat(64), requiresStop: true, executionAvailable: false, generation: 'on-explicit-start' }, meta: { requestId: 'test', generatedAt: '2026-10-02T00:00:00Z', mode: 'local' } });
    show(); fireEvent.change(screen.getByLabelText('新世界名称'), { target: { value: 'new' } });
    fireEvent.change(screen.getByLabelText('Seed（留空为随机）'), { target: { value: '9223372036854775807' } });
    fireEvent.click(screen.getByRole('button', { name: '校验新世界计划' }));
    expect(await screen.findByRole('status')).toHaveTextContent('尚未创建世界');
    expect(api.worldCreatePlan).toHaveBeenCalledWith('test', { name: 'new', seed: '9223372036854775807' });
    expect(screen.getByRole('status')).toHaveTextContent('明确允许停服');
    fireEvent.change(screen.getByLabelText('新世界名称'), { target: { value: 'other' } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('reports server rejection while preserving input', async () => {
    vi.mocked(api.worldCreatePlan).mockRejectedValue(new ApiClientError('目标名称已被使用', 'http', 409, 'WORLD_NAME_CONFLICT'));
    show(); fireEvent.change(screen.getByLabelText('新世界名称'), { target: { value: 'world' } });
    fireEvent.click(screen.getByRole('button', { name: '校验新世界计划' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('目标名称已被使用');
    expect(screen.getByLabelText('新世界名称')).toHaveValue('world');
  });
  it('requires explicit name/stop confirmation and reports stopped pending generation', async () => {
    vi.mocked(api.createWorld).mockResolvedValue({ data: { operation: { id: '123e4567-e89b-42d3-a456-426614174000' } }, meta } as never);
    vi.mocked(api.operation).mockResolvedValue({ data: { state: 'succeeded', step: 'completed', error: null }, meta } as never);
    show(); await approveCreate();
    await waitFor(() => expect(api.createWorld).toHaveBeenCalledWith('test', { name: 'new', seed: '9223372036854775807', confirmWorldName: 'world', worldRevision: 'a'.repeat(64), allowStop: true }, expect.any(String)));
    expect(await screen.findByText(/配置已切换/)).toHaveTextContent('明确启动生成新世界');
    await waitFor(() => expect(sessionStorage.getItem('mcsm.pendingWorldCreate.test')).toBeNull());
  });
  it('retains exact request and idempotency key after network loss and refresh', async () => {
    vi.mocked(api.createWorld).mockRejectedValue(new ApiClientError('连接中断', 'network'));
    const first = show(); await approveCreate(); await screen.findByRole('alert');
    const call = vi.mocked(api.createWorld).mock.calls[0]!; first.unmount();
    show(); expect(api.createWorld).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '确认未完成的新建请求' }));
    await waitFor(() => expect(api.createWorld).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.createWorld).mock.calls[1]).toEqual(call);
  });
  it('keeps user input and unlocks fields after a stale revision rejection', async () => {
    vi.mocked(api.createWorld).mockRejectedValue(new ApiClientError('世界已发生变化', 'http', 409, 'WORLD_REVISION_CONFLICT'));
    show(); await approveCreate(); expect(await screen.findByRole('alert')).toHaveTextContent('世界已发生变化');
    expect(screen.getByLabelText('新世界名称')).toHaveValue('new'); expect(screen.getByLabelText('新世界名称')).toBeEnabled();
    expect(sessionStorage.getItem('mcsm.pendingWorldCreate.test')).toBeNull();
  });
});
