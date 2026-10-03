import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiClientError } from '../api';
import { WorldImportAction } from './WorldImportAction';

vi.mock('../api', async (original) => ({ ...await original<typeof import('../api')>(), api: {
  worldImportPlan: vi.fn(), importWorld: vi.fn(), worldImportRecoveryPlan: vi.fn(), recoverWorldImport: vi.fn(), operation: vi.fn()
} }));
afterEach(() => { cleanup(); vi.resetAllMocks(); sessionStorage.clear(); });
const uploadId = '123e4567-e89b-42d3-a456-426614174000';
const operationId = '123e4567-e89b-42d3-a456-426614174001';
const meta = { requestId: 'test', generatedAt: '2026-10-02T00:00:00Z', mode: 'local' as const };
const plan = { serverId: 'test', uploadId, name: 'imported', uploadRevision: 'a'.repeat(64), worldRevision: 'b'.repeat(64),
  minecraftVersion: '26.3', currentWorldName: 'world', requiresStop: true, fileCount: 3, sizeBytes: 100,
  checksumSha256: 'c'.repeat(64), executionAvailable: true as const };
function show(selected: string | null = uploadId) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><WorldImportAction serverId="test" uploadId={selected} /></QueryClientProvider>);
}
async function preview() {
  vi.mocked(api.worldImportPlan).mockResolvedValue({ data: plan, meta });
  fireEvent.change(screen.getByLabelText('导入后的世界名称'), { target: { value: 'imported' } });
  fireEvent.click(screen.getByRole('button', { name: '校验导入计划' }));
  return screen.findByRole('button', { name: '确认导入并保持停服' });
}
async function approve() {
  const button = await preview();
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText('输入当前世界名确认导入'), { target: { value: 'world' } });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByLabelText('我确认保留旧世界和保护备份，并允许必要停服'));
  fireEvent.click(button);
}
describe('world import confirmation', () => {
  it('re-preview requires fresh approval even when the world name is unchanged', async () => {
    show(); await preview();
    fireEvent.change(screen.getByLabelText('输入当前世界名确认导入'), { target: { value: 'world' } });
    fireEvent.click(screen.getByLabelText('我确认保留旧世界和保护备份，并允许必要停服'));
    expect(screen.getByRole('button', { name: '确认导入并保持停服' })).toBeEnabled();
    vi.mocked(api.worldImportPlan).mockResolvedValue({ data: { ...plan, worldRevision: 'e'.repeat(64) }, meta });
    fireEvent.click(screen.getByRole('button', { name: '校验导入计划' }));
    await waitFor(() => expect(api.worldImportPlan).toHaveBeenCalledTimes(2));
    const button = await screen.findByRole('button', { name: '确认导入并保持停服' });
    expect(button).toBeDisabled();
    expect(screen.getByLabelText('输入当前世界名确认导入')).toHaveValue('');
    expect(screen.getByLabelText('我确认保留旧世界和保护备份，并允许必要停服')).not.toBeChecked();
    expect(api.importWorld).not.toHaveBeenCalled();
  });
  it('expired persisted requests are not offered or replayed', () => {
    sessionStorage.setItem('mcsm.pendingWorldImport.test', JSON.stringify({ kind: 'import', key: uploadId, savedAt: Date.now() - 86_400_001,
      body: { uploadId, name: 'imported', uploadRevision: plan.uploadRevision, worldRevision: plan.worldRevision, confirmWorldName: 'world', allowStop: true } }));
    show(); expect(screen.queryByRole('button', { name: '确认未完成的导入或恢复请求' })).not.toBeInTheDocument();
    expect(api.importWorld).not.toHaveBeenCalled();
  });
  it('reload with an accepted operation polls only and does not execute again', async () => {
    sessionStorage.setItem('mcsm.pendingWorldImport.test', JSON.stringify({ kind: 'import', key: uploadId, savedAt: Date.now(), operationId,
      body: { uploadId, name: 'imported', uploadRevision: plan.uploadRevision, worldRevision: plan.worldRevision, confirmWorldName: 'world', allowStop: true } }));
    vi.mocked(api.operation).mockResolvedValue({ data: { state: 'succeeded', step: 'completed', error: null }, meta } as never);
    show(); await screen.findByText(/世界已导入，旧世界及保护备份保留/);
    expect(api.operation).toHaveBeenCalled(); expect(api.importWorld).not.toHaveBeenCalled(); expect(api.recoverWorldImport).not.toHaveBeenCalled();
  });
  it('preview does not execute and changing the name invalidates confirmation', async () => {
    show(); await preview();
    expect(api.importWorld).not.toHaveBeenCalled();
    expect(await screen.findByText(/计划已校验，尚未导入/)).toHaveTextContent('imported');
    fireEvent.change(screen.getByLabelText('导入后的世界名称'), { target: { value: 'another' } });
    expect(screen.queryByRole('button', { name: '确认导入并保持停服' })).not.toBeInTheDocument();
  });
  it('requires separate name and stop approval and reports stopped success', async () => {
    vi.mocked(api.importWorld).mockResolvedValue({ data: { operation: { id: operationId } }, meta } as never);
    vi.mocked(api.operation).mockResolvedValue({ data: { state: 'succeeded', step: 'completed', error: null }, meta } as never);
    show(); await approve();
    await waitFor(() => expect(api.importWorld).toHaveBeenCalledWith('test', { uploadId, name: 'imported', uploadRevision: plan.uploadRevision,
      worldRevision: plan.worldRevision, confirmWorldName: 'world', allowStop: true }, expect.any(String)));
    expect(await screen.findByText(/世界已导入，旧世界及保护备份保留/)).toHaveTextContent('另行明确启动');
    await waitFor(() => expect(sessionStorage.getItem('mcsm.pendingWorldImport.test')).toBeNull());
    expect(api.recoverWorldImport).not.toHaveBeenCalled();
  });
  it('network loss and reload never replay automatically and manual retry preserves the exact key', async () => {
    vi.mocked(api.importWorld).mockRejectedValue(new ApiClientError('连接中断', 'network'));
    const first = show(); await approve(); await screen.findByRole('alert');
    const original = vi.mocked(api.importWorld).mock.calls[0]; first.unmount(); show();
    expect(api.importWorld).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '确认未完成的导入或恢复请求' }));
    await waitFor(() => expect(api.importWorld).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.importWorld).mock.calls[1]).toEqual(original);
  });
  it('stale revision rejection releases pending state for a new preview', async () => {
    vi.mocked(api.importWorld).mockRejectedValue(new ApiClientError('世界已变化', 'http', 409, 'WORLD_REVISION_CONFLICT'));
    show(); await approve(); expect(await screen.findByRole('alert')).toHaveTextContent('世界已变化');
    expect(sessionStorage.getItem('mcsm.pendingWorldImport.test')).toBeNull();
    expect(screen.getByLabelText('导入后的世界名称')).toBeEnabled();
    expect(screen.queryByRole('button', { name: '确认导入并保持停服' })).not.toBeInTheDocument();
  });
  it('failed import only offers explicit recovery after a separate preview and confirmation', async () => {
    vi.mocked(api.importWorld).mockResolvedValue({ data: { operation: { id: operationId } }, meta } as never);
    vi.mocked(api.operation).mockResolvedValue({ data: { state: 'failed', step: 'recovery-required', error: null }, meta } as never);
    vi.mocked(api.worldImportRecoveryPlan).mockResolvedValue({ data: { serverId: 'test', operationId, previousWorldName: 'world',
      importedWorldName: 'imported', recoveryRevision: 'd'.repeat(64), executionAvailable: true, preservesAllTrees: true }, meta });
    vi.mocked(api.recoverWorldImport).mockRejectedValue(new ApiClientError('连接中断', 'network'));
    show(); await approve();
    fireEvent.click(await screen.findByRole('button', { name: '关闭操作结果并检查恢复' }));
    expect(api.recoverWorldImport).not.toHaveBeenCalled();
    expect(screen.getByLabelText('原导入操作 ID')).toHaveValue(operationId);
    fireEvent.click(screen.getByRole('button', { name: '校验显式恢复计划' }));
    const button = await screen.findByRole('button', { name: '明确恢复旧世界并保持停服' });
    expect(button).toBeDisabled(); expect(api.recoverWorldImport).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('输入旧世界名确认恢复'), { target: { value: 'world' } });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByLabelText('我确认恢复原配置，保留所有世界树并保持停服')); fireEvent.click(button);
    await waitFor(() => expect(api.recoverWorldImport).toHaveBeenCalledWith('test', { operationId, confirmWorldName: 'world', recoveryRevision: 'd'.repeat(64) }, expect.any(String)));
  });
  it('invalid persisted bodies never authorize retry', () => {
    sessionStorage.setItem('mcsm.pendingWorldImport.test', JSON.stringify({ kind: 'import', key: uploadId, savedAt: Date.now(), body: { path: '../world' } }));
    show(); expect(screen.queryByRole('button', { name: '确认未完成的导入或恢复请求' })).not.toBeInTheDocument();
    expect(sessionStorage.getItem('mcsm.pendingWorldImport.test')).toBeNull();
  });
});
