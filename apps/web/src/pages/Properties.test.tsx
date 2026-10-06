import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Operation, PropertiesResponse, ServersResponse } from '@mcsm/contracts';
import { api, ApiClientError } from '../api';
import { PropertiesPage } from './Properties';

vi.mock('../api', async (load) => {
  const actual = await load<typeof import('../api')>();
  return { ...actual, api: { ...actual.api, properties: vi.fn(), saveProperties: vi.fn(), operation: vi.fn() } };
});
const revision = 'a'.repeat(64);
function snapshot(pvp = true): PropertiesResponse {
  const fields = { 'max-players': 20, difficulty: 'normal', gamemode: 'survival', pvp, 'online-mode': true,
    'view-distance': 10, 'simulation-distance': 10, motd: 'Isolated test' };
  return { meta: { requestId: 'test', generatedAt: new Date().toISOString(), mode: 'local' }, data: { fields, revision,
    fieldRules: Object.fromEntries(Object.keys(fields).map((key) => [key, { editable: !key.includes('distance'), restartRequired: true, reason: null }])) } };
}
function operation(state: Operation['state'] = 'running'): Operation {
  return { id: 'operation-test', serverId: 'test', kind: 'properties-write', state, step: state === 'succeeded' ? 'completed' : 'writing',
    progress: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), result: { resourceId: 'guard', rollbackAvailable: false }, error: null };
}
function show(overrides = {}) {
  const server = { server: { id: 'test' }, capabilities: { properties: true }, status: { state: 'stopped', ownership: 'none',
    observedAt: new Date().toISOString(), activeOperationId: null, recoveryRequired: false, ...overrides } } as unknown as ServersResponse['data']['items'][number];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><PropertiesPage server={server} /></QueryClientProvider>);
}
async function edit() {
  fireEvent.change(await screen.findByLabelText('玩家对战'), { target: { value: 'false' } });
  fireEvent.click(screen.getByLabelText(/确认以上变更/));
}
beforeEach(() => {
  vi.mocked(api.properties).mockResolvedValue(snapshot());
  vi.mocked(api.saveProperties).mockResolvedValue({ meta: snapshot().meta, data: { operation: operation(), restartRequired: true, restartFields: ['pvp'] } });
  vi.mocked(api.operation).mockImplementation(() => new Promise(() => {}));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('uses backend readonly rules and requires explicit confirmation', async () => {
  show(); await screen.findByLabelText('玩家对战');
  expect(screen.queryByLabelText('视距', { selector: 'input' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('玩家对战'), { target: { value: 'false' } });
  expect(screen.getByRole('button', { name: '备份并保存配置' })).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/确认以上变更/));
  fireEvent.click(screen.getByRole('button', { name: '备份并保存配置' }));
  await waitFor(() => expect(api.saveProperties).toHaveBeenCalledTimes(1));
  expect(api.saveProperties).toHaveBeenCalledWith('test', { changes: { pvp: 'false' }, confirmOfflineIdentity: false }, revision, expect.any(String));
  expect(await screen.findByText('请求已受理，正在核验配置写入…')).toBeInTheDocument();
  expect(screen.queryByText(/配置已保存/)).not.toBeInTheDocument();
});

it('only reports saved after a matching operation succeeds and never restarts', async () => {
  vi.mocked(api.operation).mockResolvedValue({ meta: snapshot().meta, data: operation('succeeded') });
  show(); await edit(); fireEvent.click(screen.getByRole('button', { name: '备份并保存配置' }));
  expect(await screen.findByText(/配置已保存。需要重启/)).toBeInTheDocument();
  expect(api.saveProperties).toHaveBeenCalledTimes(1);
});

it('preserves a conflict draft and uses fresh revision only after renewed confirmation', async () => {
  vi.mocked(api.saveProperties).mockRejectedValueOnce(new ApiClientError('revision changed', 'http', 409, 'PROPERTIES_REVISION_CONFLICT'));
  show(); await edit(); fireEvent.click(screen.getByRole('button', { name: '备份并保存配置' }));
  await screen.findByText(/草稿保留，请刷新/);
  expect(screen.getByLabelText('玩家对战')).toHaveValue('false');
  fireEvent.click(screen.getByLabelText(/确认以上变更/));
  expect(screen.getByRole('button', { name: '备份并保存配置' })).toBeDisabled();
  const fresh = snapshot(); fresh.data.revision = 'b'.repeat(64); fresh.data.fields.motd = 'Updated elsewhere';
  vi.mocked(api.properties).mockResolvedValue(fresh);
  fireEvent.click(screen.getByRole('button', { name: '刷新当前配置，保留草稿' }));
  await waitFor(() => expect(screen.getByLabelText('服务器描述')).toHaveValue('Updated elsewhere'));
  expect(screen.getByLabelText('玩家对战')).toHaveValue('false');
  expect(screen.getByRole('button', { name: '备份并保存配置' })).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/确认以上变更/)); fireEvent.click(screen.getByRole('button', { name: '备份并保存配置' }));
  await waitFor(() => expect(api.saveProperties).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.saveProperties).mock.calls[1]?.[1].changes).toEqual({ pvp: 'false' });
  expect(vi.mocked(api.saveProperties).mock.calls[1]?.[2]).toBe('b'.repeat(64));
});

it('does not resurrect reverted fields after a conflict refresh', async () => {
  vi.mocked(api.saveProperties).mockRejectedValueOnce(new ApiClientError('revision changed', 'http', 409, 'PROPERTIES_REVISION_CONFLICT'));
  show();
  fireEvent.change(await screen.findByLabelText('玩家对战'), { target: { value: 'false' } });
  fireEvent.change(screen.getByLabelText('玩家对战'), { target: { value: 'true' } });
  fireEvent.change(screen.getByLabelText('服务器描述'), { target: { value: 'My draft' } });
  fireEvent.click(screen.getByLabelText(/确认以上变更/));
  fireEvent.click(screen.getByRole('button', { name: '备份并保存配置' }));
  await screen.findByText(/草稿保留，请刷新/);
  const fresh = snapshot(false); fresh.data.revision = 'b'.repeat(64);
  vi.mocked(api.properties).mockResolvedValue(fresh);
  fireEvent.click(screen.getByRole('button', { name: '刷新当前配置，保留草稿' }));
  await waitFor(() => expect(screen.getByLabelText('玩家对战')).toHaveValue('false'));
  expect(screen.getByLabelText('服务器描述')).toHaveValue('My draft');
  fireEvent.click(screen.getByLabelText(/确认以上变更/));
  fireEvent.click(screen.getByRole('button', { name: '备份并保存配置' }));
  await waitFor(() => expect(api.saveProperties).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.saveProperties).mock.calls[1]?.[1].changes).toEqual({ motd: 'My draft' });
});

it('does not automatically retry an uncertain response and explicitly reuses the original request key', async () => {
  vi.mocked(api.saveProperties).mockRejectedValueOnce(new ApiClientError('offline', 'network'));
  show(); await edit(); fireEvent.click(screen.getByRole('button', { name: '备份并保存配置' }));
  fireEvent.click(await screen.findByRole('button', { name: '使用原请求核对结果' }));
  await waitFor(() => expect(api.saveProperties).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.saveProperties).mock.calls[1]).toEqual(vi.mocked(api.saveProperties).mock.calls[0]);
});

it('requires a successful refresh after an asynchronous revision conflict', async () => {
  const failed = operation('failed');
  failed.error = { code: 'PROPERTIES_REVISION_CONFLICT', message: 'revision changed' };
  vi.mocked(api.operation).mockResolvedValue({ meta: snapshot().meta, data: failed });
  show(); await edit(); fireEvent.click(screen.getByRole('button', { name: '备份并保存配置' }));
  await screen.findByText(/配置保存失败/);
  fireEvent.click(screen.getByLabelText(/确认以上变更/));
  expect(screen.getByRole('button', { name: '备份并保存配置' })).toBeDisabled();
  vi.mocked(api.properties).mockRejectedValue(new ApiClientError('offline', 'network'));
  fireEvent.click(screen.getByRole('button', { name: '刷新当前配置，保留草稿' }));
  await screen.findByText(/配置刷新失败/);
  expect(screen.getByRole('button', { name: '备份并保存配置' })).toBeDisabled();
});

it.each(['wrong-id', 'wrong-server', 'wrong-kind', 'error', 'no-guard'])('does not report an unverified terminal response as saved: %s', async (caseName) => {
  const result = operation('succeeded');
  if (caseName === 'wrong-id') result.id = 'other';
  if (caseName === 'wrong-server') result.serverId = 'other';
  if (caseName === 'wrong-kind') result.kind = 'backup';
  if (caseName === 'error') result.error = { code: 'RECOVERY_REQUIRED', message: 'uncertain' };
  if (caseName === 'no-guard') result.result = null;
  vi.mocked(api.operation).mockResolvedValue({ meta: snapshot().meta, data: result });
  show(); await edit(); fireEvent.click(screen.getByRole('button', { name: '备份并保存配置' }));
  await waitFor(() => expect(api.operation).toHaveBeenCalled());
  expect(screen.queryByText(/配置已保存/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '备份并保存配置' })).toBeDisabled();
});

it('requires a separate online identity risk acknowledgement', async () => {
  show(); fireEvent.change(await screen.findByLabelText('正版验证'), { target: { value: 'false' } });
  fireEvent.click(screen.getByLabelText(/确认以上变更/));
  expect(screen.getByRole('button', { name: '备份并保存配置' })).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/我确认关闭在线验证/));
  expect(screen.getByRole('button', { name: '备份并保存配置' })).toBeEnabled();
});

it.each([{ state: 'running' }, { recoveryRequired: true }, { ownership: 'external' }, { observedAt: '2000-01-01T00:00:00Z' }])('blocks unavailable instance state %j', async (status) => {
  show(status); await edit(); expect(screen.getByRole('button', { name: '备份并保存配置' })).toBeDisabled();
  expect(api.saveProperties).not.toHaveBeenCalled();
});

it('retains a recovery-required response as a blocking receipt', async () => {
  vi.mocked(api.saveProperties).mockRejectedValue(new ApiClientError('recovery', 'http', 409, 'RECOVERY_REQUIRED'));
  show(); await edit(); fireEvent.click(screen.getByRole('button', { name: '备份并保存配置' }));
  await screen.findByText(/配置需要人工恢复核验/);
  expect(screen.getByRole('button', { name: '备份并保存配置' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: '使用原请求核对结果' })).not.toBeInTheDocument();
});
