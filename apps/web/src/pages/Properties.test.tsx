import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
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
function discoveredSnapshot(): PropertiesResponse {
  const result = snapshot();
  result.data.discovery = { serverType: 'vanilla', minecraftVersion: '26.3', fileIdentity: 'a'.repeat(64), omittedCount: 0,
    files: [{ id:'server-properties',source:'server.properties',format:'properties',editable:true }],
    items: [{ key:'pvp',label:'玩家对战',group:'游戏玩法',category:'core',rawValue:'true',value:true,inferredType:'boolean',source:'server.properties',fileId:'server-properties',
      ruleStatus:'verified',editable:true,sensitive:false,duplicate:false,restartRequired:true,reason:null,description:'已验证' }] };
  return result;
}
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
function show(overrides = {}, client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }), serverId = 'test') {
  const server = { server: { id: serverId }, capabilities: { properties: true }, status: { state: 'stopped', ownership: 'none',
    observedAt: new Date().toISOString(), activeOperationId: null, recoveryRequired: false, ...overrides } } as unknown as ServersResponse['data']['items'][number];
  return render(<QueryClientProvider client={client}><MemoryRouter><PropertiesPage server={server} /></MemoryRouter></QueryClientProvider>);
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

it('keeps an externally removed draft visible and blocks submission until explicitly discarded', async () => {
  vi.mocked(api.properties).mockResolvedValue(discoveredSnapshot());
  show(); await edit();
  const fresh = discoveredSnapshot(); fresh.data.revision = 'b'.repeat(64); fresh.data.discovery!.items = [];
  vi.mocked(api.properties).mockResolvedValue(fresh);
  fireEvent.click(screen.getByRole('button',{name:'刷新当前配置，保留草稿'}));
  expect(await screen.findByRole('heading',{name:'磁盘配置发生变化'})).toBeInTheDocument();
  expect(api.saveProperties).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:/确认比较/}));
  expect(screen.getByRole('heading',{name:'草稿需要核对'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'刷新当前配置，保留草稿'}));
  await waitFor(() => expect(api.properties).toHaveBeenCalledTimes(3));
  expect(screen.getByRole('heading',{name:'草稿需要核对'})).toBeInTheDocument();
  expect(screen.getByText('pvp: false', { exact: false })).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'备份并保存配置'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'放弃 pvp 草稿'}));
  expect(screen.queryByRole('heading',{name:'草稿需要核对'})).not.toBeInTheDocument();
  expect(api.saveProperties).not.toHaveBeenCalled();
});

it('detects an identity-only replacement independently of revision and preserves the draft', async () => {
  vi.mocked(api.properties).mockResolvedValue(discoveredSnapshot()); show(); await edit();
  const fresh = discoveredSnapshot(); fresh.data.discovery!.fileIdentity = 'b'.repeat(64);
  vi.mocked(api.properties).mockResolvedValue(fresh);
  fireEvent.click(screen.getByRole('button',{name:'刷新当前配置，保留草稿'}));
  expect(await screen.findByText(/配置文件身份已变化/)).toBeInTheDocument();
  expect(screen.getByLabelText('玩家对战')).toHaveValue('false');
  expect(screen.getByRole('button',{name:'备份并保存配置'})).toBeDisabled();
  expect(api.saveProperties).not.toHaveBeenCalled();
});

it('retains an uncertain request across navigation without an automatic resend and reuses its exact key on explicit check', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  vi.mocked(api.saveProperties).mockRejectedValueOnce(new Error('synthetic disconnect'));
  const first = show({}, client); await edit(); fireEvent.click(screen.getByRole('button', { name: '备份并保存配置' }));
  await screen.findByRole('button', { name: '使用原请求核对结果' });
  const original = vi.mocked(api.saveProperties).mock.calls[0]!;
  first.unmount(); show({}, client);
  await screen.findByRole('button', { name: '使用原请求核对结果' });
  expect(api.saveProperties).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '备份并保存配置' })).toBeDisabled();
  expect(screen.getByLabelText('玩家对战')).toHaveValue('false');
  fireEvent.click(screen.getByRole('button', { name: '使用原请求核对结果' }));
  await waitFor(() => expect(api.saveProperties).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.saveProperties).mock.calls[1]).toEqual(original);
});

it('records a late accepted response after navigation and restores only operation observation', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let accept!: (response: Awaited<ReturnType<typeof api.saveProperties>>) => void;
  vi.mocked(api.saveProperties).mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
  const first = show({}, client); await edit(); fireEvent.click(screen.getByRole('button', { name: '备份并保存配置' }));
  await waitFor(() => expect(api.saveProperties).toHaveBeenCalledTimes(1));
  first.unmount(); show({}, client);
  accept({ meta: snapshot().meta, data: { operation: operation(), restartRequired: true, restartFields: ['pvp'] } });
  expect(await screen.findByText(/操作 ID：/)).toBeInTheDocument();
  expect(api.saveProperties).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(api.operation).toHaveBeenCalled());
});
it('retains uncertainty when an explicit old-key check is denied before admission', async () => {
  vi.mocked(api.saveProperties).mockRejectedValueOnce(new Error('synthetic disconnect'))
    .mockRejectedValueOnce(new ApiClientError('reauth needed', 'http', 403, 'AUTH_REAUTH_REQUIRED'));
  show(); await edit(); fireEvent.click(screen.getByRole('button', { name: '备份并保存配置' }));
  fireEvent.click(await screen.findByRole('button', { name: '使用原请求核对结果' }));
  expect(await screen.findByText(/此次核对失败不能证明原请求未执行/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '备份并保存配置' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '使用原请求核对结果' })).toBeEnabled();
  expect(vi.mocked(api.saveProperties).mock.calls[1]?.[3]).toBe(vi.mocked(api.saveProperties).mock.calls[0]?.[3]);
});

it('does not show another server pending receipt when navigating between instances', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  vi.mocked(api.saveProperties).mockRejectedValueOnce(new Error('synthetic disconnect'));
  const first = show({}, client); await edit(); fireEvent.click(screen.getByRole('button', { name: '备份并保存配置' }));
  await screen.findByRole('button', { name: '使用原请求核对结果' });
  first.unmount(); show({}, client, 'other');
  expect(await screen.findByLabelText('玩家对战')).toHaveValue('true');
  expect(screen.queryByRole('button', { name: '使用原请求核对结果' })).not.toBeInTheDocument();
  expect(api.saveProperties).toHaveBeenCalledTimes(1);
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
  const old = snapshot(); const fresh = { ...old, data: { ...old.data, revision: 'b'.repeat(64), fields: { ...old.data.fields, motd: 'Updated elsewhere' } } };
  vi.mocked(api.properties).mockResolvedValue(fresh);
  fireEvent.click(screen.getByRole('button', { name: '刷新当前配置，保留草稿' }));
  fireEvent.click(await screen.findByRole('button', { name: /\u786e\u8ba4\u6bd4\u8f83/ }));
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
  fireEvent.click(await screen.findByRole('button', { name: /\u786e\u8ba4\u6bd4\u8f83/ }));
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

it('retains the pending request across actual Router navigation and return', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const server = { server: { id: 'test' }, capabilities: { properties: true }, status: {
    state: 'stopped', ownership: 'none', observedAt: new Date().toISOString(), activeOperationId: null, recoveryRequired: false
  } } as unknown as ServersResponse['data']['items'][number];
  vi.mocked(api.saveProperties).mockRejectedValueOnce(new Error('synthetic disconnect'));
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/properties']}><Routes>
    <Route path="/properties" element={<PropertiesPage server={server} />} />
    <Route path="/whitelist" element={<Link to="/properties">return-to-properties</Link>} />
  </Routes></MemoryRouter></QueryClientProvider>);
  await edit();
  fireEvent.click(screen.getByRole('button', { name: /\u5907\u4efd\u5e76\u4fdd\u5b58\u914d\u7f6e/ }));
  await screen.findByRole('button', { name: /\u4f7f\u7528\u539f\u8bf7\u6c42\u6838\u5bf9\u7ed3\u679c/ });
  fireEvent.click(screen.getByRole('link', { name: /\u67e5\u770b\u767d\u540d\u5355\u6210\u5458/ }));
  fireEvent.click(await screen.findByRole('link', { name: 'return-to-properties' }));
  await screen.findByRole('button', { name: /\u4f7f\u7528\u539f\u8bf7\u6c42\u6838\u5bf9\u7ed3\u679c/ });
  expect(api.saveProperties).toHaveBeenCalledTimes(1);
});
