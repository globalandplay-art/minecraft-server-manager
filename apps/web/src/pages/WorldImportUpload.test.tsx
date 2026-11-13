import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiClientError } from '../api';
import { WorldImportUpload } from './WorldImportUpload';
vi.mock('./WorldImportAction', () => ({ WorldImportAction: () => null }));
vi.mock('./WorldIndependentImport', () => ({ WorldIndependentImport: () => null }));
vi.mock('../api', async (original) => ({ ...await original<typeof import('../api')>(), api: { uploadWorldZip: vi.fn(), worldImportUploads: vi.fn(), discardWorldImportUpload: vi.fn() } }));
const meta = { requestId: 'test', generatedAt: '2026-10-02T00:00:00Z', mode: 'local' as const };
const id = '00000000-0000-4000-8000-000000000001';
const clients: QueryClient[] = [];
function renderUpload() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  return render(<QueryClientProvider client={client}><WorldImportUpload serverId="test" /></QueryClientProvider>);
}
beforeEach(() => { vi.mocked(api.worldImportUploads).mockResolvedValue({ data: { items: [], occupiedSlots: 0, limit: 3 }, meta }); });
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.clearAllMocks(); vi.restoreAllMocks(); });
describe('world ZIP upload preview', () => {
  it('prepares a selected folder locally and uploads only after explicit click', async () => {
    renderUpload();
    const source = new File(['world'], 'level.dat');
    Object.defineProperty(source, 'webkitRelativePath', { value: 'SelectedWorld/level.dat' });
    Object.defineProperty(source, 'arrayBuffer', { value: async () => new TextEncoder().encode('world').buffer });
    fireEvent.change(screen.getByLabelText('选择世界文件夹'), { target: { files: [source] } });
    await screen.findByText(/world-folder.zip/);
    expect(api.uploadWorldZip).not.toHaveBeenCalled();
    vi.mocked(api.uploadWorldZip).mockRejectedValueOnce(new ApiClientError('folder rejected by server', 'http', 400));
    fireEvent.click(screen.getByRole('button', { name: '上传并校验' }));
    await screen.findByText('folder rejected by server');
    expect(api.uploadWorldZip).toHaveBeenCalledWith('test', expect.objectContaining({ name: 'world-folder.zip' }), expect.any(AbortSignal));
  });
  it('explains retained failed lifecycle and expiry without deleting on mount',async () => {
    vi.mocked(api.worldImportUploads).mockResolvedValue({ data:{ items:[{ id,state:'incomplete',discardAllowed:true,revision:'a'.repeat(64),lifecycle:'failed',expiresAt:'2026-10-05T00:00:00Z' }],occupiedSlots:1,limit:3 },meta });
    renderUpload();
    expect(await screen.findByText('上传或校验失败；文件保留，可明确丢弃。')).toBeVisible();
    expect(screen.getByText(/过期后仍须通过安全检查/)).toBeVisible();
    expect(screen.getByText(/自动清理默认关闭/)).toBeVisible();
    expect(screen.queryByText(/不会自动清理；网络/)).not.toBeInTheDocument();
    expect(api.discardWorldImportUpload).not.toHaveBeenCalled();
  });
  it('rejects non-ZIP and empty files without calling API', () => {
    renderUpload();
    const input = screen.getByLabelText('世界 ZIP（也可拖入一个文件）');
    for (const file of [new File(['x'], 'x.jar'), new File([], 'x.zip')]) {
      fireEvent.change(input, { target: { files: [file] } });
      expect(screen.getByRole('alert')).toHaveTextContent('非空且不超过 128 MiB');
      expect(screen.getByRole('button', { name: '上传并校验' })).toBeDisabled();
    }
    expect(api.uploadWorldZip).not.toHaveBeenCalled();
  });
  it('reports staging only and never offers a switch/start operation', async () => {
    vi.mocked(api.uploadWorldZip).mockResolvedValue({ data: { id: '00000000-0000-4000-8000-000000000001', serverId: 'test', minecraftVersion: '26.3',
      fileCount: 3, sizeBytes: 100, checksumSha256: 'a'.repeat(64), state: 'validated', executionAvailable: false },
      meta: { requestId: 'test', generatedAt: '2026-10-02T00:00:00Z', mode: 'local' } });
    renderUpload();
    fireEvent.change(screen.getByLabelText('世界 ZIP（也可拖入一个文件）'), { target: { files: [new File(['zip'], 'world.zip')] } });
    fireEvent.click(screen.getByRole('button', { name: '上传并校验' }));
    expect(await screen.findByRole('status')).toHaveTextContent('尚未导入');
    expect(screen.getByRole('status')).toHaveTextContent('版本 26.3');
    expect(screen.getByRole('button', { name: '上传并校验' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '导入世界' })).not.toBeInTheDocument();
  });
  it('keeps uncertain uploads visible without automatic retries', async () => {
    vi.mocked(api.uploadWorldZip).mockRejectedValue(new ApiClientError('上传结果未确认，已接收的文件可能保留', 'network'));
    renderUpload();
    fireEvent.change(screen.getByLabelText('世界 ZIP（也可拖入一个文件）'), { target: { files: [new File(['zip'], 'world.zip')] } });
    fireEvent.click(screen.getByRole('button', { name: '上传并校验' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('上传结果未确认');
    expect(api.uploadWorldZip).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('shows retained records after mount and only discards after explicit confirmation', async () => {
    vi.mocked(api.worldImportUploads).mockResolvedValueOnce({ data: { items: [{ id, state: 'incomplete', discardAllowed: true, revision: 'a'.repeat(64) }], occupiedSlots: 1, limit: 3 }, meta });
    vi.mocked(api.discardWorldImportUpload).mockResolvedValue({ data: { id, state: 'discarded' }, meta });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderUpload();
    const button = await screen.findByRole('button', { name: '明确丢弃暂存' });
    fireEvent.click(button); expect(api.discardWorldImportUpload).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(await screen.findByText('当前实例没有暂存记录。')).toBeVisible();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(api.discardWorldImportUpload).toHaveBeenCalledWith('test', id, { confirmUploadId: id, revision: 'a'.repeat(64) });
  });
  it('disables discard for identity-unverified legacy artifacts', async () => {
    vi.mocked(api.worldImportUploads).mockResolvedValue({ data: { items: [{ id, state: 'identity-unverified', discardAllowed: false, revision: 'a'.repeat(64) }], occupiedSlots: 3, limit: 3 }, meta });
    renderUpload();
    expect(await screen.findByText('根目录身份未验证，需要人工检查')).toBeVisible();
    expect(screen.getByRole('button', { name: '明确丢弃暂存' })).toBeDisabled();
    expect(api.discardWorldImportUpload).not.toHaveBeenCalled();
  });
  it('allows retrying a failed list request with the refresh action', async () => {
    vi.mocked(api.worldImportUploads).mockRejectedValueOnce(new ApiClientError('暂存区需要检查', 'http', 409));
    renderUpload();
    expect(await screen.findByRole('alert')).toHaveTextContent('暂存区需要检查');
    fireEvent.click(screen.getByRole('button', { name: '刷新暂存记录' }));
    expect(await screen.findByText('当前实例没有暂存记录。')).toBeVisible();
  });
});
