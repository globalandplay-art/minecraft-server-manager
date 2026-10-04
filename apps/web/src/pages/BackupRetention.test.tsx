import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { BackupRetention } from './BackupRetention';
vi.mock('../api', async (load) => ({ ...(await load<typeof import('../api')>()), api: { backupRetention: vi.fn(), saveBackupRetention: vi.fn(), runBackupRetention: vi.fn() } }));
const response = { data: { revision: '2'.repeat(64), settings: { enabled: false, retainCount: 10, retainDays: 7 }, lastRun: null }, meta: { mode: 'local' as const, requestId: 'test', generatedAt: '2026-10-04T00:00:00.000Z' } };
const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><BackupRetention serverId="test" /></QueryClientProvider>);
beforeEach(() => { cleanup(); vi.clearAllMocks(); vi.mocked(api.backupRetention).mockResolvedValue(structuredClone(response)); });
describe('retention consent', () => {
  it('defaults off and does not save deletion authorization without confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false); show();
    expect(await screen.findByLabelText('启用安全保留清理')).not.toBeChecked();
    fireEvent.click(screen.getByLabelText('启用安全保留清理')); fireEvent.click(screen.getByRole('button', { name: '保存保留策略' }));
    expect(confirm).toHaveBeenCalled(); expect(api.saveBackupRetention).not.toHaveBeenCalled(); confirm.mockRestore();
  });
  it('rejects invalid count/day locally and sends bound settings only', async () => {
    vi.mocked(api.saveBackupRetention).mockResolvedValue(response); show();
    fireEvent.change(await screen.findByLabelText('至少保留最近份数'), { target: { value: '0' } }); expect(screen.getByRole('button', { name: '保存保留策略' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('至少保留最近份数'), { target: { value: '3' } }); fireEvent.click(screen.getByRole('button', { name: '保存保留策略' }));
    await waitFor(() => expect(api.saveBackupRetention).toHaveBeenCalledWith('test', { revision: response.data.revision, settings: { ...response.data.settings, retainCount: 3 } }));
  });
  it('keeps partial cleanup visible and requires explicit confirmation for manual run', async () => {
    vi.mocked(api.backupRetention).mockResolvedValue({ ...response, data: { ...response.data, settings: { ...response.data.settings, enabled: true }, lastRun: {
      state: 'partial', code: 'RETENTION_INSPECTION_REQUIRED', completedAt: response.meta.generatedAt, removed: [], retained: [{ id: 'preserved', reason: 'cleanup-receipt-inspection-required' }]
    } } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false); show();
    expect(await screen.findByRole('status')).toHaveTextContent('partial');
    fireEvent.click(screen.getByRole('button', { name: '按已保存策略清理' })); expect(api.runBackupRetention).not.toHaveBeenCalled(); confirm.mockRestore();
  });
});
