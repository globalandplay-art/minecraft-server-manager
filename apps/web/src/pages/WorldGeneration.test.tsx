import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiClientError } from '../api';
import { i18n } from '../i18n';
import { WorldGeneration } from './WorldGeneration';

vi.mock('../api', async original => ({ ...await original<typeof import('../api')>(), api: {
  worldGenerationTarget: vi.fn(), generateWorld: vi.fn(), finalizeWorldGeneration: vi.fn(), operation: vi.fn(),
  startFirstManagedWorld: vi.fn(), stopFirstManagedWorld: vi.fn(),
} }));
const id = '123e4567-e89b-42d3-a456-426614174000';
const target = { preparationOperationId: id, preparationTransactionId: id, worldId: `worldv2-${id}`,
  preparedRecordDigest: 'a'.repeat(64), registeredExecutionDigest: 'b'.repeat(64) };
const meta = { requestId: 'test', generatedAt: '2026-11-05T00:00:00Z', mode: 'local' as const };
const operation = { id, serverId: 'test', kind: 'world-create', state: 'succeeded', step: 'completed', error: null };
function show(serverId = 'test') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><WorldGeneration serverId={serverId} /></QueryClientProvider>);
}
async function prepare() {
  fireEvent.click(screen.getByRole('button', { name: '读取已准备的生成目标' }));
  const button = await screen.findByRole('button', { name: '确认生成并停服' });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  return button;
}
beforeEach(async () => {
  await i18n.changeLanguage('zh-CN');
  vi.mocked(api.worldGenerationTarget).mockResolvedValue({ data: target, meta });
  vi.mocked(api.generateWorld).mockResolvedValue({ data: { operation }, meta } as never);
  vi.mocked(api.operation).mockResolvedValue({ data: operation, meta } as never);
  vi.mocked(api.finalizeWorldGeneration).mockResolvedValue({ data: { serverId: 'test', operationId: id, worldId: target.worldId,
    inspectionOnly: true, recoveryRequired: true }, meta });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); sessionStorage.clear(); vi.restoreAllMocks(); });

describe('explicit world generation', () => {
  it.each(['running', 'start-sent', 'stop-sent'])('restores the managed %s state after refresh and instance switching', async phase => {
    sessionStorage.setItem('lt.pendingWorldGeneration.test', JSON.stringify({ version: 1, serverId: 'test', key: id, target, operationId: id }));
    sessionStorage.setItem(`lt.firstManagedWorld.test.${id}`, JSON.stringify({ phase, key: id, startOperationId: id }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const view = (serverId: string) => <QueryClientProvider client={client}><WorldGeneration serverId={serverId} /></QueryClientProvider>;
    const page = render(view('test'));
    const assertRestored = async () => {
      if (phase === 'running') expect(await screen.findByRole('button', { name: '正常停止此世界' })).toBeVisible();
      else expect(await screen.findByText('操作结果待核查，请检查实例和操作记录。页面不会自动重发。')).toBeVisible();
      expect(screen.queryByRole('button', { name: '启动已核验的新世界' })).not.toBeInTheDocument();
    };
    try {
      await assertRestored();
      page.rerender(view('other'));
      expect(screen.queryByRole('button', { name: '正常停止此世界' })).not.toBeInTheDocument();
      page.rerender(view('test'));
      await assertRestored();
      expect(api.finalizeWorldGeneration).not.toHaveBeenCalled();
      expect(api.startFirstManagedWorld).not.toHaveBeenCalled();
      expect(api.stopFirstManagedWorld).not.toHaveBeenCalled();
    } finally { page.unmount(); client.clear(); }
  });
  it('does not dispatch before confirmation and retains recovery after finalization', async () => {
    show(); expect(api.worldGenerationTarget).not.toHaveBeenCalled();
    const button = await prepare();
    expect(api.generateWorld).not.toHaveBeenCalled();
    fireEvent.click(button); fireEvent.click(button);
    const verify = await screen.findByRole('button', { name: '核验已保存的生成结果' });
    expect(api.generateWorld).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem('lt.pendingWorldGeneration.test')!).operationId).toBe(id);
    expect(api.finalizeWorldGeneration).not.toHaveBeenCalled();
    fireEvent.click(verify);
    expect(await screen.findByText(/生成结果已核验，恢复门控仍保留/)).toBeInTheDocument();
    expect(api.finalizeWorldGeneration).toHaveBeenCalledWith('test', id);
    expect(verify).toBeDisabled();
  });

  it('persists the exact target before sending and never retries after response loss or remount', async () => {
    vi.mocked(api.generateWorld).mockImplementation(async (_server, sent, key) => {
      expect(JSON.parse(sessionStorage.getItem('lt.pendingWorldGeneration.test')!)).toMatchObject({ serverId: 'test', key, target: sent });
      throw new ApiClientError('connection lost', 'network');
    });
    const first = show(); fireEvent.click(await prepare());
    await screen.findByText('connection lost');
    first.unmount(); show();
    expect(await screen.findByText(/生成请求结果未知/)).toBeInTheDocument();
    expect(api.generateWorld).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '确认生成并停服' })).not.toBeInTheDocument();
  });

  it('blocks corrupt local records without deleting them', () => {
    sessionStorage.setItem('lt.pendingWorldGeneration.test', '{bad');
    show(); expect(screen.getByRole('alert')).toHaveTextContent('无法确认本地待处理记录');
    expect(screen.getByRole('button', { name: '读取已准备的生成目标' })).toBeDisabled();
    expect(sessionStorage.getItem('lt.pendingWorldGeneration.test')).toBe('{bad');
  });

  it('refuses dispatch if storage fails', async () => {
    show(); const button = await prepare();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('无法确认本地待处理记录');
    expect(api.generateWorld).not.toHaveBeenCalled();
  });

  it('does not accept an operation from another instance', async () => {
    vi.mocked(api.generateWorld).mockResolvedValue({ data: { operation: { ...operation, serverId: 'other' } }, meta } as never);
    show(); fireEvent.click(await prepare());
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(api.operation).not.toHaveBeenCalled();
    expect(api.finalizeWorldGeneration).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem('lt.pendingWorldGeneration.test')!).operationId).toBeUndefined();
  });

  it('rejects a mismatched finalization world without claiming success', async () => {
    vi.mocked(api.finalizeWorldGeneration).mockResolvedValue({ data: { serverId: 'test', operationId: id,
      worldId: 'worldv2-223e4567-e89b-42d3-a456-426614174000', inspectionOnly: true, recoveryRequired: true }, meta });
    show(); fireEvent.click(await prepare());
    fireEvent.click(await screen.findByRole('button', { name: '核验已保存的生成结果' }));
    await screen.findByRole('alert');
    expect(screen.queryByText(/生成结果已核验，恢复门控仍保留/)).not.toBeInTheDocument();
  });

  it('isolates late dispatch responses when the selected instance changes', async () => {
    let finish!: (value: Awaited<ReturnType<typeof api.generateWorld>>) => void;
    vi.mocked(api.generateWorld).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><WorldGeneration serverId="test" /></QueryClientProvider>);
    fireEvent.click(await prepare());
    await waitFor(() => expect(api.generateWorld).toHaveBeenCalledTimes(1));
    view.rerender(<QueryClientProvider client={client}><WorldGeneration serverId="other" /></QueryClientProvider>);
    finish({ data: { operation }, meta } as never);
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem('lt.pendingWorldGeneration.test')!).operationId).toBe(id));
    expect(sessionStorage.getItem('lt.pendingWorldGeneration.other')).toBeNull();
    expect(api.operation).not.toHaveBeenCalled();
    expect(screen.queryByText(target.worldId)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '读取已准备的生成目标' })).toBeEnabled();
  });

  it('retains confirmation through a language change without dispatching', async () => {
    show(); await prepare();
    await i18n.changeLanguage('ja');
    await waitFor(() => expect(screen.getByRole('button', { name: '生成して停止' })).toBeEnabled());
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(api.generateWorld).not.toHaveBeenCalled();
    expect(screen.getByText(target.worldId)).toBeInTheDocument();
  });
});
