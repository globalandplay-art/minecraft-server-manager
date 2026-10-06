import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddonTrashResponse, AddonsResponse, AddonUploadResponse, LifecycleActionResponse, Operation, ServerResponse, ServersResponse } from '@mcsm/contracts';
import { api, ApiClientError } from '../api';
import { AddonsPage } from './Addons';

type TrashRecord = AddonTrashResponse['data']['items'][number];

vi.mock('../api', async (load) => {
  const actual = await load<typeof import('../api')>();
  return { ...actual, api: { ...actual.api, addons: vi.fn(), addonTrash: vi.fn(), server: vi.fn(), uploadAddon: vi.fn(),
    installAddon: vi.fn(), mutateAddon: vi.fn(), restoreAddon: vi.fn(), operation: vi.fn() } };
});
const revision = 'a'.repeat(64);
const meta = { requestId: 'test', generatedAt: new Date().toISOString(), mode: 'local' as const };
function summary(type: 'paper' | 'fabric' | 'vanilla' = 'paper', overrides = {}) {
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

  it('does not show a cached addon list as current after list failure', async () => {
    vi.mocked(api.addons).mockRejectedValue(new ApiClientError('list unavailable', 'http', 400, 'ADDON_UNAVAILABLE'));
    show();
    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('暂时无法载入数据');
    expect(error).toHaveTextContent('list unavailable');
    expect(screen.queryByRole('heading', { name: 'Test Addon' })).not.toBeInTheDocument();
  });
});
