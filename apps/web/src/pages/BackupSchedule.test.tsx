import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiClientError } from '../api';
import { BackupSchedule } from './BackupSchedule';
vi.mock('../api', async (load) => ({ ...(await load<typeof import('../api')>()), api: { backupSchedule: vi.fn(), saveBackupSchedule: vi.fn() } }));
const response = { data: { revision: '1'.repeat(64), settings: { enabled: false, localTime: '02:00', timezone: 'Asia/Shanghai', allowStop: false }, runs: [] }, meta: { mode: 'local' as const, requestId: 'test', generatedAt: '2026-10-04T00:00:00.000Z' } };
const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><BackupSchedule serverId="test" /></QueryClientProvider>);
beforeEach(() => { cleanup(); vi.clearAllMocks(); vi.mocked(api.backupSchedule).mockResolvedValue(structuredClone(response)); });
describe('daily backup explicit settings', () => {
  it('defaults off and submits only after an explicit save with revision', async () => {
    vi.mocked(api.saveBackupSchedule).mockResolvedValue(response); show();
    const enabled = await screen.findByLabelText('启用每日备份'); expect(enabled).not.toBeChecked();
    expect(screen.getByRole('button', { name: '保存备份计划' })).toBeDisabled();
    fireEvent.click(enabled); expect(api.saveBackupSchedule).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存备份计划' }));
    await waitFor(() => expect(api.saveBackupSchedule).toHaveBeenCalledWith('test', { revision: response.data.revision, settings: { ...response.data.settings, enabled: true } }));
  });
  it('requires additional confirmation before granting scheduled stop/start', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false); show();
    fireEvent.click(await screen.findByLabelText('启用每日备份')); fireEvent.click(screen.getByLabelText('允许计划备份停服并尝试重新启动'));
    fireEvent.click(screen.getByRole('button', { name: '保存备份计划' })); expect(confirm).toHaveBeenCalled(); expect(api.saveBackupSchedule).not.toHaveBeenCalled(); confirm.mockRestore();
  });
  it('retains conflict input and never auto-retries a mutation', async () => {
    vi.mocked(api.saveBackupSchedule).mockRejectedValue(new ApiClientError('计划已变化', 'http', 409, 'SCHEDULE_REVISION_CONFLICT')); show();
    fireEvent.change(await screen.findByLabelText('IANA 时区'), { target: { value: 'America/New_York' } });
    fireEvent.click(screen.getByRole('button', { name: '保存备份计划' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('计划已变化'); expect(screen.getByLabelText('IANA 时区')).toHaveValue('America/New_York'); expect(api.saveBackupSchedule).toHaveBeenCalledTimes(1);
  });
});
