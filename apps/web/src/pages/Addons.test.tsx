import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
