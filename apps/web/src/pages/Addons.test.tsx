import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddonTrashResponse, AddonsResponse, AddonUploadResponse, LifecycleActionResponse, Operation, ServerResponse, ServersResponse } from '@mcsm/contracts';
import { api, ApiClientError } from '../api';
import { AddonsPage } from './Addons';
import { ModInstallPanel } from './ModInstallPanel';

type TrashRecord = AddonTrashResponse['data']['items'][number];

vi.mock('../api', async (load) => {
  const actual = await load<typeof import('../api')>();
  return { ...actual, api: { ...actual.api, addons: vi.fn(), addonTrash: vi.fn(), server: vi.fn(), uploadAddon: vi.fn(),
    installAddon: vi.fn(), mutateAddon: vi.fn(), restoreAddon: vi.fn(), operation: vi.fn() } };
});
const revision = 'a'.repeat(64);
const meta = { requestId: 'test', generatedAt: new Date().toISOString(), mode: 'local' as const };
function summary(type: 'paper' | 'fabric' | 'vanilla' | 'forge' | 'neoforge' = 'paper', overrides = {}) {
  const data = { server: { id: 'test', name: 'Test server', type, minecraftVersion: '26.2', java: { runtimeVersion: '25', requiredMajor: 25 }, detection: { confidence: 'high', evidence: [], warnings: [] } },
    capabilities: { mods: type === 'fabric', plugins: type === 'paper', rcon: true, console: true, backup: true, worlds: true, properties: true },
    status: { state: 'stopped' as const, ownership: 'none' as const, source: 'process' as const, observedAt: new Date().toISOString(), activeOperationId: null, recoveryRequired: false, ...overrides },
    readiness: { start: { allowed: true as const, reason: null }, stop: { allowed: false as const, reason: 'state-stopped' }, restart: { allowed: false as const, reason: 'state-stopped' },
      commands: { allowed: false as const, reason: 'state-stopped' }, backup: { allowed: true as const, reason: null }, restore: { allowed: true as const, reason: null },
      worldChanges: { allowed: true as const, reason: null }, addonChanges: { allowed: true as const, reason: null }, propertiesChanges: { allowed: false as const, reason: 'feature-not-implemented' }, commandTransport: 'rcon' as const } };
  return data as unknown as ServersResponse['data']['items'][number];
}
function addon(kind: 'plugin' | 'mod' = 'plugin', state: 'enabled' | 'disabled' = 'enabled') {
  return { id: 'b'.repeat(64), kind, state, filename: 'private-name.jar', sizeBytes: 1000, sha256: 'c'.repeat(64), name: 'Test Addon', version: '1.2.3',
    loader: kind === 'plugin' ? 'paper' as const : 'fabric' as const, compatibility: 'unknown' as const, minecraftConstraint: null, metadataStatus: 'parsed' as const };
}
function addonsResponse(type: 'paper' | 'fabric' = 'paper', items = [addon(type === 'paper' ? 'plugin' : 'mod')]): AddonsResponse {
  return { meta, data: { items, revision, writeSupported: true } };
}
function trashResponse(): AddonTrashResponse { return { meta, data: { revision, items: [] } }; }
function stagedResponse(): AddonUploadResponse { return { meta, data: { id: 'e5cbbfa0-836a-4f57-a8b8-1a6772947c01', kind: 'plugin', filename: 'private-stage.jar', sizeBytes: 2048,
  checksumSha256: 'd'.repeat(64), revision, name: 'Fresh Addon', version: '2.0', loader: 'paper', minecraftConstraint: ['26.2'], state: 'validated', executionAvailable: false } }; }
function stagedModResponse(loader: 'forge' | 'neoforge'): AddonUploadResponse {
  return { meta, data: { id: 'e5cbbfa0-836a-4f57-a8b8-1a6772947c01', kind: 'mod', filename: 'multiple.jar', sizeBytes: 2048,
    checksumSha256: 'd'.repeat(64), revision, name: null, version: null, loader, minecraftConstraint: null,
    compatibility: 'unknown', state: 'validated', executionAvailable: false, declaredMetadata: {
      loader, source: loader === 'forge' ? 'META-INF/mods.toml' : 'META-INF/neoforge.mods.toml', modLoader: 'javafml', loaderVersion: '[1,)',
      mods: [{ id: 'staged_mod', name: '暂存模组', version: '${file.jarVersion}', versionStatus: 'unresolved', dependencies: [] },
        { id: 'another_mod', name: 'Another mod', version: '2.0', versionStatus: 'declared', dependencies: [] }] } } };
}
function operation(state: Operation['state'] = 'running'): Operation {
  return { id: 'operation-42', serverId: 'test', kind: 'addon-change', state, step: state === 'running' ? 'installing' : 'completed', progress: 50,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), result: state === 'succeeded' ? { resourceId: 'opaque', rollbackAvailable: false, restartRequired: true } : null, error: null };
}
function actionResponse(op = operation()): LifecycleActionResponse { return { meta, data: { operation: op } }; }
function show(server = summary()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><AddonsPage server={server} /></QueryClientProvider>);
}
beforeEach(() => {
  vi.mocked(api.addons).mockImplementation(async (id) => addonsResponse(id === 'fabric-server' ? 'fabric' : 'paper'));
  vi.mocked(api.addonTrash).mockResolvedValue(trashResponse());
  vi.mocked(api.server).mockResolvedValue({ meta, data: summary() } as ServerResponse);
  vi.mocked(api.uploadAddon).mockResolvedValue(stagedResponse());
  vi.mocked(api.installAddon).mockResolvedValue(actionResponse());
  vi.mocked(api.mutateAddon).mockResolvedValue(actionResponse());
  vi.mocked(api.restoreAddon).mockResolvedValue(actionResponse());
  vi.mocked(api.operation).mockImplementation(() => new Promise(() => {}));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('P5.4 addon management UI', () => {
  it.each(['cached', 'pending'] as const)('uses a fresh shared installation proof with %s inventory', async mode => {
    const stage = stagedModResponse('neoforge').data, onInstalled = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    client.setQueryData(['addons', 'test'], { meta, data: { items: [], revision, writeSupported: true } });
    const fresh = { meta, data: { items: [{ ...addon('mod'), filename: stage.filename, sha256: stage.checksumSha256 }], revision, writeSupported: true } };
    let finish!: (value: AddonsResponse) => void;
    if (mode === 'pending') vi.mocked(api.addons).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    else vi.mocked(api.addons).mockResolvedValue(fresh);
    if (mode === 'pending') void client.fetchQuery({ queryKey: ['addons', 'test'], queryFn: () => api.addons('test'), staleTime: 0 });
    vi.mocked(api.server).mockResolvedValue({ meta, data: summary('neoforge') });
    vi.mocked(api.operation).mockResolvedValue({ meta, data: operation('succeeded') });
    render(<QueryClientProvider client={client}><ModInstallPanel serverId="test" serverName="Test" stage={stage} revision={revision}
      inventoryFresh locked={false} onBusy={vi.fn()} onUnknown={vi.fn()} onInstalled={onInstalled} /></QueryClientProvider>);
    const button = screen.getByRole('button', { name: '安装已校验模组' });
    await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: '确认安装' }));
    await waitFor(() => expect(api.operation).toHaveBeenCalled());
    if (mode === 'pending') { expect(onInstalled).not.toHaveBeenCalled(); await act(async () => { finish(fresh); }); }
    await waitFor(() => expect(onInstalled).toHaveBeenCalledTimes(1));
    expect(api.addons).toHaveBeenCalledTimes(1);
  });
  it('shares delayed new-loader reads through StrictMode without consuming abort signals', async () => {
    const server = summary('neoforge'); server.capabilities.mods = true;
    let finishInventory!: (value: AddonsResponse) => void;
    let finishTrash!: (value: AddonTrashResponse) => void;
    vi.mocked(api.server).mockResolvedValue({ meta, data: server });
    vi.mocked(api.addons).mockImplementation(() => new Promise(resolve => { finishInventory = resolve; }));
    vi.mocked(api.addonTrash).mockImplementation(() => new Promise(resolve => { finishTrash = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<StrictMode><QueryClientProvider client={client}><AddonsPage server={server} /></QueryClientProvider></StrictMode>);
    await waitFor(() => { expect(api.addons).toHaveBeenCalledTimes(1); expect(api.addonTrash).toHaveBeenCalledTimes(1); });
    expect(api.addons).toHaveBeenCalledWith('test'); expect(api.addonTrash).toHaveBeenCalledWith('test');
    expect(screen.getByLabelText('选择模组 JAR')).toBeDisabled();
    await act(async () => { finishInventory(addonsResponse()); finishTrash(trashResponse()); });
    expect(api.addons).toHaveBeenCalledTimes(1); expect(api.addonTrash).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByLabelText('选择模组 JAR')).toBeEnabled());
  });
  it('requires stopped-instance state and explicit unknown-compatibility acknowledgement before installing', async () => {
    const server = summary('neoforge'), listing = { meta, data: { items: [], revision, writeSupported: false, installSupported: true } };
    vi.mocked(api.addons).mockResolvedValue(listing); vi.mocked(api.server).mockResolvedValue({ meta, data: server });
    vi.mocked(api.uploadAddon).mockResolvedValue(stagedModResponse('neoforge'));
    vi.mocked(api.operation).mockResolvedValue({ meta, data: operation('running') }); show(server);
    fireEvent.change(screen.getByLabelText('选择模组 JAR'), { target: { files: [new File(['jar'], 'multiple.jar')] } });
    const open = await screen.findByRole('button', { name: '安装已校验模组' }); await waitFor(() => expect(open).toBeEnabled()); fireEvent.click(open);
    const confirm = screen.getByRole('button', { name: '确认安装' }); expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /接受未知兼容性/ })); fireEvent.click(confirm); fireEvent.click(confirm);
    await waitFor(() => expect(api.installAddon).toHaveBeenCalledTimes(1));
    expect(api.installAddon).toHaveBeenCalledWith('test', expect.objectContaining({ confirmUnknownCompatibility: true, inventoryRevision: revision }), expect.stringMatching(/^[a-f0-9-]{36}$/u));
    expect(screen.getByLabelText('选择模组 JAR')).toBeDisabled(); expect(api.mutateAddon).not.toHaveBeenCalled();
  });
  it('locks a new-loader install with a lost response and never repeats its mutation', async () => {
    const server = summary('neoforge'); vi.mocked(api.server).mockResolvedValue({ meta, data: server });
    vi.mocked(api.addons).mockResolvedValue({ meta, data: { items: [], revision, writeSupported: false, installSupported: true } });
    vi.mocked(api.uploadAddon).mockResolvedValue(stagedModResponse('neoforge')); vi.mocked(api.installAddon).mockRejectedValue(new ApiClientError('lost install response', 'network'));
    show(server); fireEvent.change(screen.getByLabelText('选择模组 JAR'), { target: { files: [new File(['jar'], 'multiple.jar')] } });
    const open = await screen.findByRole('button', { name: '安装已校验模组' }); await waitFor(() => expect(open).toBeEnabled()); fireEvent.click(open);
    fireEvent.click(screen.getByRole('checkbox', { name: /接受未知兼容性/ })); fireEvent.click(screen.getByRole('button', { name: '确认安装' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '安装已校验模组' })).toBeDisabled());
    expect(screen.getByLabelText('选择模组 JAR')).toBeDisabled(); expect(api.installAddon).toHaveBeenCalledTimes(1);
  });
  it('retains the accepted operation ID when installation is interrupted and locks all further changes', async () => {
    const server = summary('neoforge'); vi.mocked(api.server).mockResolvedValue({ meta, data: server });
    vi.mocked(api.addons).mockResolvedValue({ meta, data: { items: [], revision, writeSupported: false, installSupported: true } });
    vi.mocked(api.uploadAddon).mockResolvedValue(stagedModResponse('neoforge'));
    vi.mocked(api.operation).mockResolvedValue({ meta, data: operation('interrupted') }); show(server);
    fireEvent.change(screen.getByLabelText('选择模组 JAR'), { target: { files: [new File(['jar'], 'multiple.jar')] } });
    const open = await screen.findByRole('button', { name: '安装已校验模组' }); await waitFor(() => expect(open).toBeEnabled()); fireEvent.click(open);
    fireEvent.click(screen.getByRole('checkbox', { name: /接受未知兼容性/ })); fireEvent.click(screen.getByRole('button', { name: '确认安装' }));
    expect(await screen.findByText(/安装状态需要检查.*操作：operation-42/)).toBeInTheDocument();
    expect(screen.getByLabelText('选择模组 JAR')).toBeDisabled(); expect(screen.getByRole('button', { name: '安装已校验模组' })).toBeDisabled();
    expect(api.installAddon).toHaveBeenCalledTimes(1);
  });
  it.each(['forge', 'neoforge'] as const)('enables %s only after explicit compatibility acknowledgement and never repeats a lost response', async type => {
    const server = summary(type); server.capabilities.mods = true;
    vi.mocked(api.server).mockResolvedValue({ meta, data: server });
    vi.mocked(api.addons).mockResolvedValue({ meta, data: { items: [{ ...addon('mod', 'disabled'), loader: null }], revision, writeSupported: true } });
    vi.mocked(api.mutateAddon).mockRejectedValue(new ApiClientError('response lost', 'network'));
    show(server);
    const enable = await screen.findByRole('button', { name: '启用' });
    expect(api.addons).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(enable).toBeEnabled()); fireEvent.click(enable);
    const confirm = screen.getByRole('button', { name: '确认操作' }); expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox')); expect(confirm).toBeEnabled(); fireEvent.click(confirm);
    await waitFor(() => expect(api.mutateAddon).toHaveBeenCalledTimes(1));
    expect(api.mutateAddon).toHaveBeenCalledWith('test', 'b'.repeat(64), 'enable', { revision, confirmUnknownCompatibility: true }, expect.any(String));
    await waitFor(() => expect(screen.getByText('请求结果未确认')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '启用' })).toBeDisabled(); expect(api.mutateAddon).toHaveBeenCalledTimes(1);
  });
  it.each(['forge', 'neoforge'] as const)('uploads %s into inert staging once, without changing installed mods or offering install', async type => {
    vi.mocked(api.uploadAddon).mockResolvedValue(stagedModResponse(type));
    vi.mocked(api.addons).mockResolvedValue({ meta, data: { items: [], revision, writeSupported: false } }); show(summary(type));
    const input = screen.getByLabelText('选择模组 JAR'), file = new File(['jar'], 'multiple.jar');
    fireEvent.change(input, { target: { files: [file] } }); fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByRole('heading', { name: '暂存校验通过，尚未安装' })).toBeInTheDocument();
    expect(screen.getByLabelText('已校验暂存模组')).toHaveTextContent('未展开：${file.jarVersion}');
    expect(api.uploadAddon).toHaveBeenCalledTimes(1); expect(api.uploadAddon).toHaveBeenCalledWith('test', file);
    expect(screen.getByText('未发现模组 JAR 文件。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /安装|禁用|启用|回收/ })).not.toBeInTheDocument();
    expect(api.installAddon).not.toHaveBeenCalled(); expect(api.mutateAddon).not.toHaveBeenCalled();
  });
  it('locks inert uploads after a lost response and never resends automatically', async () => {
    vi.mocked(api.uploadAddon).mockRejectedValue(new ApiClientError('response lost', 'network')); show(summary('neoforge'));
    const input = screen.getByLabelText('选择模组 JAR'), file = new File(['jar'], 'sample.jar');
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('暂存结果未知'); expect(input).toBeDisabled();
    fireEvent.change(input, { target: { files: [file] } });
    expect(api.uploadAddon).toHaveBeenCalledTimes(1); expect(api.installAddon).not.toHaveBeenCalled();
  });
  it('discards the old-instance staged response when the selected server changes', async () => {
    let finish!: (response: AddonUploadResponse) => void;
    vi.mocked(api.uploadAddon).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const first = summary('neoforge'), second = { ...first, server: { ...first.server, id: 'second', name: 'Second instance' } };
    const view = render(<QueryClientProvider client={client}><AddonsPage server={first} /></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText('选择模组 JAR'), { target: { files: [new File(['jar'], 'sample.jar')] } });
    view.rerender(<QueryClientProvider client={client}><AddonsPage server={second} /></QueryClientProvider>);
    await act(async () => finish(stagedModResponse('neoforge')));
    expect(screen.queryByRole('heading', { name: '暂存校验通过，尚未安装' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('选择模组 JAR')).toBeEnabled();
    expect(api.uploadAddon).toHaveBeenCalledTimes(1); client.clear();
  });
  it('displays each declared mod, unresolved versions and raw dependencies without claiming compatibility', async () => {
    const item = { ...addon('mod'), name: null, loader: null, version: null, declaredMetadata: {
      loader: 'neoforge' as const, source: 'META-INF/neoforge.mods.toml' as const, modLoader: 'javafml', loaderVersion: '[1,)',
      mods: [{ id: 'first_mod', name: '第一个模组', version: '${file.jarVersion}', versionStatus: 'unresolved' as const, dependencies: [] },
        { id: 'second_mod', name: '第二个模组', version: '2.0', versionStatus: 'declared' as const,
          dependencies: [{ id: 'minecraft', versionRange: '[26.3,27)', side: 'SERVER' as const, requirement: 'required' as const }] }]
    } };
    vi.mocked(api.addons).mockResolvedValue({ meta, data: { items: [item], revision, writeSupported: false } });
    show(summary('neoforge'));
    expect(await screen.findByRole('heading', { name: '第一个模组' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '第二个模组' })).toBeInTheDocument();
    expect(screen.getByText('声明版本：未展开：${file.jarVersion}')).toBeInTheDocument();
    expect(screen.getByText(/minecraft · 声明范围：\[26.3,27\)/)).toBeInTheDocument();
    expect(screen.getByText('未知')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索文件名、模组名称或标识'), { target: { value: 'second_mod' } });
    expect(screen.getByRole('heading', { name: item.filename })).toBeInTheDocument();
    expect(api.installAddon).not.toHaveBeenCalled();
  });
  it('deduplicates StrictMode reads and keeps a late old-instance result out of the selected instance', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const first = summary('forge'), second = { ...first, server: { ...first.server, id: 'second', name: 'Second' } };
    let completeFirst!: (response: AddonsResponse) => void;
    vi.mocked(api.addons).mockImplementation(id => id === 'test' ? new Promise(resolve => { completeFirst = resolve; })
      : Promise.resolve({ meta, data: { items: [{ ...addon('mod'), filename: 'second.jar', loader: null }], revision, writeSupported: false } }));
    const view = render(<StrictMode><QueryClientProvider client={client}><AddonsPage server={first} /></QueryClientProvider></StrictMode>);
    await waitFor(() => expect(api.addons).toHaveBeenCalledTimes(1));
    expect(api.addons).toHaveBeenCalledWith('test');
    view.rerender(<StrictMode><QueryClientProvider client={client}><AddonsPage server={second} /></QueryClientProvider></StrictMode>);
    expect(await screen.findByRole('heading', { name: 'second.jar' })).toBeInTheDocument();
    await act(async () => completeFirst({ meta, data: { items: [{ ...addon('mod'), filename: 'first.jar', loader: null }], revision, writeSupported: false } }));
    expect(screen.queryByRole('heading', { name: 'first.jar' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'second.jar' })).toBeInTheDocument();
    client.clear();
  });
  it('isolates managed-loader cache and hides same-ID cached files until the current read completes', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } } });
    client.setQueryData(['addons', 'test'], addonsResponse());
    client.setQueryData(['addons-readonly', 'test', 'forge', '26.2'], { meta, data: { items: [{ ...addon('mod'), filename: 'old-root.jar' }], revision, writeSupported: false } });
    let complete!: (response: AddonsResponse) => void;
    vi.mocked(api.addons).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    render(<QueryClientProvider client={client}><AddonsPage server={summary('forge')} /></QueryClientProvider>);
    expect(screen.queryByRole('heading', { name: 'old-root.jar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'private-name.jar' })).not.toBeInTheDocument();
    expect(screen.getByText('正在读取模组文件…')).toBeInTheDocument();
    await waitFor(() => expect(api.addons).toHaveBeenCalledTimes(1));
    await act(async () => complete({ meta, data: { items: [{ ...addon('mod'), filename: 'current-root.jar', loader: null, name: null }], revision, writeSupported: false } }));
    expect(await screen.findByRole('heading', { name: 'current-root.jar' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'old-root.jar' })).not.toBeInTheDocument();
  });
  it.each(['forge', 'neoforge'] as const)('shows %s file inventory without enabling any mutation API', async type => {
    const item = { ...addon('mod'), name: null, loader: null, version: null, metadataStatus: 'missing' as const };
    vi.mocked(api.addons).mockResolvedValue({ meta, data: { items: [item], revision, writeSupported: false } });
    show(summary(type));
    expect(await screen.findByRole('heading', { name: '模组文件清单（只读）' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: item.filename })).toBeInTheDocument();
    expect(screen.getByText(/元数据仅展示文件声明，不代表文件兼容/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新清单' }).querySelector('svg')).not.toBeNull();
    expect(screen.queryByLabelText('选择扩展 JAR 文件')).not.toBeInTheDocument();
    expect(api.addonTrash).not.toHaveBeenCalled(); expect(api.server).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('搜索文件名、模组名称或标识'), { target: { value: 'no-match' } });
    expect(screen.getByText('没有匹配的文件。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新清单' }));
    await waitFor(() => expect(api.addons).toHaveBeenCalledTimes(2));
    expect(api.uploadAddon).not.toHaveBeenCalled(); expect(api.installAddon).not.toHaveBeenCalled(); expect(api.mutateAddon).not.toHaveBeenCalled(); expect(api.restoreAddon).not.toHaveBeenCalled();
  });
  it('shows Paper plugins from backend capability data and never renders internal filename identity', async () => {
    show();
    expect(await screen.findByRole('heading', { name: 'Plugins' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Test Addon' })).toBeInTheDocument();
    expect(screen.getAllByText('未知').length).toBeGreaterThan(0);
    expect(screen.queryByText('private-name.jar')).not.toBeInTheDocument();
    expect(screen.queryByText(/private|managerRoot|RCON/iu)).not.toBeInTheDocument();
  });

  it('shows Fabric mods and refuses unsupported Vanilla without requesting an addon list', async () => {
    const fabric = summary('fabric');
    vi.mocked(api.addons).mockResolvedValue(addonsResponse('fabric', [addon('mod')]));
    show(fabric);
    expect(await screen.findByRole('heading', { name: 'Mods' })).toBeInTheDocument();
    expect(await screen.findByText('Fabric Mod · 1.2.3')).toBeInTheDocument();
    cleanup();
    vi.clearAllMocks();
    show(summary('vanilla'));
    expect(await screen.findByText('此实例不支持 Mods / Plugins')).toBeInTheDocument();
    expect(api.addons).not.toHaveBeenCalled();
  });

  it('uploads only JAR files, displays backend validation, and does not claim that staging is installed', async () => {
    show();
    const input = await screen.findByLabelText('选择扩展 JAR 文件');
    fireEvent.change(input, { target: { files: [new File(['jar bytes'], 'fresh.jar', { type: 'application/java-archive' })] } });
    expect(await screen.findByText('Fresh Addon')).toBeInTheDocument();
    expect(screen.getByText('Ready to install')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Fresh Addon' })).not.toBeInTheDocument();
    expect(api.uploadAddon).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { files: [new File(['bad'], 'not.zip', { type: 'application/zip' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('.jar');
    expect(api.uploadAddon).toHaveBeenCalledTimes(1);
  });

  it('does not submit a second dropped file while an upload is pending', async () => {
    let finishUpload!: (response: AddonUploadResponse) => void;
    vi.mocked(api.uploadAddon).mockImplementation(() => new Promise((resolve) => { finishUpload = resolve; }));
    show();
    const input = await screen.findByLabelText('选择扩展 JAR 文件');
    const first = new File(['first'], 'first.jar', { type: 'application/java-archive' });
    fireEvent.change(input, { target: { files: [first] } });
    await waitFor(() => expect(api.uploadAddon).toHaveBeenCalledTimes(1));

    const dropzone = input.closest('.addon-dropzone');
    expect(dropzone).not.toBeNull();
    fireEvent.drop(dropzone!, { dataTransfer: { files: [new File(['second'], 'second.jar', { type: 'application/java-archive' })] } });

    expect(api.uploadAddon).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('正在上传并校验');
    finishUpload(stagedResponse());
    expect(await screen.findByText('Ready to install')).toBeInTheDocument();
  });

  it('requires install confirmation and tracks the accepted operation without retry or automatic restart', async () => {
    show();
    fireEvent.change(await screen.findByLabelText('选择扩展 JAR 文件'), { target: { files: [new File(['jar bytes'], 'fresh.jar')] } });
    await screen.findByText('Ready to install');
    fireEvent.click(screen.getByRole('button', { name: '安装扩展' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('需要重启才能生效');
    fireEvent.click(screen.getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(api.installAddon).toHaveBeenCalledTimes(1));
    expect(api.installAddon).toHaveBeenCalledWith('test', { uploadId: stagedResponse().data.id, uploadRevision: revision, inventoryRevision: revision }, expect.any(String));
    expect(await screen.findByText('请求已受理，尚未确认完成')).toBeInTheDocument();
    expect(api.installAddon).toHaveBeenCalledTimes(1);
  });

  it('confirms disable, enable, trash and restore and passes current revisions once', async () => {
    const on = addon('plugin', 'enabled');
    vi.mocked(api.addons).mockResolvedValue(addonsResponse('paper', [on]));
    show(); await screen.findByRole('heading', { name: 'Test Addon' });
    fireEvent.click(screen.getByRole('button', { name: '禁用' })); fireEvent.click(await screen.findByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(api.mutateAddon).toHaveBeenCalledWith('test', on.id, 'disable', { revision }, expect.any(String)));
    expect(api.mutateAddon).toHaveBeenCalledTimes(1);

    cleanup(); vi.clearAllMocks();
    vi.mocked(api.addons).mockResolvedValue(addonsResponse('paper', [addon('plugin', 'disabled')]));
    show(); await screen.findByRole('heading', { name: 'Test Addon' });
    fireEvent.click(screen.getByRole('button', { name: '启用' })); fireEvent.click(await screen.findByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(api.mutateAddon).toHaveBeenCalledWith('test', on.id, 'enable', { revision }, expect.any(String)));
  });

  it('moves an addon to Trash and restores it with explicit confirmation', async () => {
    const installed = addon();
    vi.mocked(api.addons).mockResolvedValue(addonsResponse('paper', [installed]));
    show(); await screen.findByRole('heading', { name: 'Test Addon' });
    expect(screen.getByText(/不等于永久删除/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移到回收区' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('可恢复');
    fireEvent.click(screen.getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(api.mutateAddon).toHaveBeenCalledWith('test', installed.id, 'trash', { revision }, expect.any(String)));

    cleanup(); vi.clearAllMocks();
    const trashItem: TrashRecord = { id: 'c0985a8b-c7e1-4dad-bae2-2e6ca36a5b8f', addonId: installed.id, kind: 'plugin', filename: 'private.jar',
      originalState: 'enabled', sizeBytes: installed.sizeBytes, sha256: installed.sha256, name: installed.name, version: installed.version,
      loader: 'paper', compatibility: 'unknown', minecraftConstraint: null, metadataStatus: 'parsed', createdAt: new Date().toISOString(), restoreAllowed: true };
    vi.mocked(api.addons).mockResolvedValue(addonsResponse('paper', []));
    vi.mocked(api.addonTrash).mockResolvedValue({ meta, data: { items: [trashItem], revision } });
    show(); await screen.findByRole('heading', { name: 'Test Addon' });
    fireEvent.click(screen.getByRole('button', { name: '恢复' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('原先的启用状态');
    fireEvent.click(screen.getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(api.restoreAddon).toHaveBeenCalledWith('test', trashItem.id, { revision }, expect.any(String)));
  });

  it('blocks addon changes while recovery is required', async () => {
    const blocked = summary('paper', { recoveryRequired: true });
    vi.mocked(api.server).mockResolvedValue({ meta, data: blocked } as ServerResponse);
    show(blocked);
    expect(await screen.findByRole('alert')).toHaveTextContent('需要恢复核验');
    expect(await screen.findByRole('heading', { name: 'Test Addon' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '禁用' })).toBeDisabled();
    expect(api.mutateAddon).not.toHaveBeenCalled();
  });

  it.each([
    ['a definite revision conflict', new ApiClientError('revision conflict', 'http', 409, 'ADDON_REVISION_CONFLICT'), 'revision conflict'],
    ['a validation rejection', new ApiClientError('invalid request', 'http', 400, 'VALIDATION_ERROR'), 'invalid request'],
    ['an ambiguous transport failure', new ApiClientError('connection lost', 'network'), '请求结果未确认'],
    ['a timeout', new ApiClientError('request timeout', 'network'), '请求结果未确认'],
    ['a lost accepted response', new ApiClientError('invalid response', 'schema', 202), '请求结果未确认'],
    ['a recovery rejection', new ApiClientError('recovery needed', 'http', 409, 'ADDON_RECOVERY_REQUIRED'), 'recovery needed'],
  ])('keeps mutation errors visible without an accepted operation ID after %s', async (_case, error, expected) => {
    vi.mocked(api.mutateAddon).mockRejectedValue(error);
    show();
    await screen.findByRole('heading', { name: 'Test Addon' });
    fireEvent.click(screen.getByRole('button', { name: '禁用' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认操作' }));

    await waitFor(() => expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes(expected))).toBe(true));
    expect(api.mutateAddon).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新状态' })).toBeEnabled();
    const locked = error.kind !== 'http' || error.code?.includes('RECOVERY_REQUIRED');
    if (locked) {
      expect(screen.getByRole('button', { name: '禁用' })).toBeDisabled();
      const input = screen.getByLabelText('选择扩展 JAR 文件');
      expect(input).toBeDisabled();
      fireEvent.drop(input.closest('.addon-dropzone')!, { dataTransfer: { files: [new File(['jar'], 'blocked.jar')] } });
      expect(api.uploadAddon).not.toHaveBeenCalled();
    }
  });

  it('admits one upload for same-render repeated drops and file selection, then allows an explicit next upload', async () => {
    let finishUpload!: (response: AddonUploadResponse) => void;
    vi.mocked(api.uploadAddon).mockImplementationOnce(() => new Promise((resolve) => { finishUpload = resolve; }));
    show();
    const input = await screen.findByLabelText('选择扩展 JAR 文件');
    const zone = input.closest('.addon-dropzone')!;
    const file = new File(['jar'], 'one.jar');
    act(() => {
      fireEvent.drop(zone, { dataTransfer: { files: [file] } });
      fireEvent.drop(zone, { dataTransfer: { files: [new File(['jar'], 'two.jar')] } });
      fireEvent.change(input, { target: { files: [new File(['jar'], 'three.jar')] } });
    });
    await waitFor(() => expect(api.uploadAddon).toHaveBeenCalledTimes(1));
    expect(api.uploadAddon).toHaveBeenCalledWith('test', file);
    expect(zone).toHaveAttribute('aria-disabled', 'true');
    finishUpload(stagedResponse());
    await screen.findByText('Fresh Addon');
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { files: [new File(['next'], 'next.jar')] } });
    await waitFor(() => expect(api.uploadAddon).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['unknown', new ApiClientError('lost upload response', 'network'), false],
    ['recovery', new ApiClientError('upload recovery', 'http', 409, 'ADDON_RECOVERY_REQUIRED'), false],
    ['rejected', new ApiClientError('invalid jar', 'http', 400, 'ADDON_INVALID'), true],
  ])('retains the upload admission policy after an %s upload', async (_case, error, retryAllowed) => {
    vi.mocked(api.uploadAddon).mockRejectedValueOnce(error);
    show();
    const input = await screen.findByLabelText('选择扩展 JAR 文件');
    const zone = input.closest('.addon-dropzone')!;
    fireEvent.change(input, { target: { files: [new File(['jar'], 'first.jar')] } });
    await screen.findByText(new RegExp(error.message));
    if (!retryAllowed) {
      expect(input).toBeDisabled();
      expect(screen.getByRole('button', { name: '禁用' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '刷新状态' })).toBeEnabled();
    }
    else await waitFor(() => expect(input).toBeEnabled());
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['next'], 'next.jar')] } });
    await waitFor(() => expect(api.uploadAddon).toHaveBeenCalledTimes(retryAllowed ? 2 : 1));
  });

  it('blocks drops during a backend active operation', async () => {
    const busy = summary('paper', { activeOperationId: 'operation-busy' });
    vi.mocked(api.server).mockResolvedValue({ meta, data: busy } as ServerResponse);
    show(busy);
    const input = await screen.findByLabelText('选择扩展 JAR 文件');
    fireEvent.drop(input.closest('.addon-dropzone')!, { dataTransfer: { files: [new File(['jar'], 'blocked.jar')] } });
    expect(input).toBeDisabled();
    expect(api.uploadAddon).not.toHaveBeenCalled();
  });

  it('locks malformed accepted operations without starting operation tracking', async () => {
    vi.mocked(api.mutateAddon).mockResolvedValue(actionResponse({ ...operation(), serverId: 'other-server' }));
    show();
    await screen.findByRole('heading', { name: 'Test Addon' });
    fireEvent.click(screen.getByRole('button', { name: '禁用' }));
    const confirm = await screen.findByRole('button', { name: '确认操作' });
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
    await screen.findByText('受理响应无法与本实例匹配。禁止重复提交，请刷新状态。');
    expect(api.mutateAddon).toHaveBeenCalledTimes(1);
    expect(api.operation).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '禁用' })).toBeDisabled();
  });

  it.each(['query-failed', 'interrupted'] as const)('retains the lifecycle operation number after %s without resubmission', async failure => {
    if (failure === 'query-failed') vi.mocked(api.operation).mockRejectedValue(new ApiClientError('operation unavailable', 'http', 400, 'OPERATION_UNAVAILABLE'));
    else vi.mocked(api.operation).mockResolvedValue({ meta, data: operation('interrupted') });
    show(); await screen.findByRole('heading', { name: 'Test Addon' });
    fireEvent.click(screen.getByRole('button', { name: '禁用' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认操作' }));
    expect(await screen.findByText('操作编号：operation-42')).toBeInTheDocument();
    await screen.findByText(failure === 'query-failed' ? /无法读取操作结果/ : '操作需要恢复核验');
    expect(screen.getByRole('button', { name: '禁用' })).toBeDisabled();
    expect(api.mutateAddon).toHaveBeenCalledTimes(1);
  });

  it('keeps a succeeded receipt unconfirmed when status refresh fails, then reconciles on explicit refresh', async () => {
    vi.mocked(api.operation).mockImplementation(async () => {
      vi.mocked(api.server).mockRejectedValue(new ApiClientError('status unavailable', 'network'));
      return { meta, data: operation('succeeded') };
    });
    show();
    await screen.findByRole('heading', { name: 'Test Addon' });
    fireEvent.click(screen.getByRole('button', { name: '禁用' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认操作' }));
    await screen.findByText('操作已结束，但当前列表或服务器状态未确认；请刷新状态，不要重复提交。');
    expect(screen.getByText('操作编号：operation-42')).toBeInTheDocument();
    expect(screen.queryByText('操作完成，列表已刷新')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '禁用' })).toBeDisabled();
    vi.mocked(api.server).mockResolvedValue({ meta, data: summary() } as ServerResponse);
    vi.mocked(api.operation).mockResolvedValue({ meta, data: operation('succeeded') });
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新状态' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
    await screen.findByText('操作完成，列表已刷新');
    expect(api.mutateAddon).toHaveBeenCalledTimes(1);
  });

  it('does not show a cached addon list as current after list failure', async () => {
    vi.mocked(api.addons).mockRejectedValue(new ApiClientError('list unavailable', 'http', 400, 'ADDON_UNAVAILABLE'));
    show();
    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('暂时无法载入数据');
    expect(error).toHaveTextContent('list unavailable');
    expect(screen.queryByRole('heading', { name: 'Test Addon' })).not.toBeInTheDocument();
  });
});
