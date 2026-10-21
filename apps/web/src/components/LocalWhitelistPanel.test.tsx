import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ServersResponse, WhitelistResponse, WhitelistCandidatesResponse, WhitelistMutationResponse } from '@mcsm/contracts';
import { LocalWhitelistPanel } from './LocalWhitelistPanel';
import { WhitelistPage } from '../pages/Whitelist';
import { api } from '../api';
vi.mock('../api', async load => { const actual = await load<typeof import('../api')>(); return { ...actual,
  api: { ...actual.api, whitelist: vi.fn(), whitelistCandidates: vi.fn(), mutateWhitelistMember: vi.fn() } }; });
const meta = { requestId: 'test', generatedAt: '2026-10-21T00:00:00Z', mode: 'local' as const };
const data: WhitelistResponse['data'] = { executionMode: 'direct-rcon', availability: 'available', reason: null,
  configuredEnabled: true, configuredEnforced: false, effectiveEnabled: null, items: [{ name: 'Player_One', uuid: '123e4567-e89b-42d3-a456-426614174000' }],
  sampledAt: meta.generatedAt, source: 'whitelist-json', membershipWritable: true, writeReason: null, revision: 'a'.repeat(64),
  runtime: { available: true, reason: null, names: ['Player_One'], consistent: true } };
const candidates: WhitelistCandidatesResponse['data'] = { availability: 'available', reason: null, sampledAt: meta.generatedAt,
  items: [{ name: 'Player_Two', uuid: '123e4567-e89b-42d3-a456-426614174001', source: 'usercache', identityVerified: false }] };
const reply = (outcome: WhitelistMutationResponse['data']['outcome'], action: 'add' | 'remove', name: string): WhitelistMutationResponse => ({ meta,
  data: { serverId: 'test', action, name, outcome, code: outcome === 'succeeded' ? 'WHITELIST_UPDATED' : 'WHITELIST_RESULT_UNKNOWN',
    message: outcome === 'succeeded' ? '名单已核实' : '响应无法确认', relatedErrorObserved: false } });
const server = (id: string) => ({ server: { id } }) as ServersResponse['data']['items'][number];
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });
function show(extra: Partial<Parameters<typeof LocalWhitelistPanel>[0]> = {}) {
  const refresh = vi.fn(async () => true);
  return { refresh, ...render(<LocalWhitelistPanel serverId="test" data={data} candidates={candidates} candidatesStale={false}
    stale={false} fetching={false} refresh={refresh} {...extra} />) };
}
it.each(['manual', 'candidate', 'remove'] as const)('uses one common backend for %s with single-click adds, delete confirmation and duplicate protection', async mode => {
  const action = mode === 'remove' ? 'remove' : 'add', name = mode === 'remove' ? 'Player_One' : 'Player_Two';
  vi.mocked(api.mutateWhitelistMember).mockResolvedValue(reply('succeeded', action, name));
  const f = show();
  if (mode === 'manual') {
    fireEvent.change(screen.getByLabelText('玩家名称'), { target: { value: 'bad;stop' } }); expect(screen.getByRole('button', { name: '添加玩家' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('玩家名称'), { target: { value: name } });
  }
  const button = screen.getByRole('button', { name: mode === 'manual' ? '添加玩家' : mode === 'candidate' ? '添加 Player_Two' : '删除 Player_One' });
  fireEvent.click(button); fireEvent.click(button);
  if (mode === 'remove') {
    expect(api.mutateWhitelistMember).not.toHaveBeenCalled(); expect(screen.getByRole('dialog')).toHaveTextContent('目标服务器：test');
    const confirm = screen.getByRole('button', { name: '确认执行' }); fireEvent.click(confirm); fireEvent.click(confirm);
  } else expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await screen.findByText(/成功：名单已核实/); expect(api.mutateWhitelistMember).toHaveBeenCalledOnce();
  expect(api.mutateWhitelistMember).toHaveBeenCalledWith('test', { action, name, revision: 'a'.repeat(64), confirm: true }, expect.any(String));
  expect(f.refresh).toHaveBeenCalledOnce();
});
it.each(['response', 'network'] as const)('holds UNKNOWN after %s loss and never auto-submits again', async mode => {
  if (mode === 'response') vi.mocked(api.mutateWhitelistMember).mockResolvedValue(reply('unknown', 'add', 'Player_Two'));
  else vi.mocked(api.mutateWhitelistMember).mockRejectedValue(new Error('lost-response'));
  show(); fireEvent.click(screen.getByRole('button', { name: '添加 Player_Two' }));
  await screen.findByText(/结果未知：/); expect(screen.getByRole('button', { name: '添加玩家' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '刷新白名单' })); await waitFor(() => expect(screen.getByLabelText('玩家名称')).not.toBeDisabled());
  expect(api.mutateWhitelistMember).toHaveBeenCalledOnce();
});
it('keeps manual input available when candidates fail, but disables stale candidate approval', () => {
  show({ candidatesStale: true }); expect(screen.getByText(/候选可能已过期/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '添加 Player_Two' })).toBeDisabled(); expect(screen.getByLabelText('玩家名称')).not.toBeDisabled();
});
it('distinguishes saved/live mismatches, missing lists, and unknown runtime enabled state', () => {
  show({ data: { ...data, membershipWritable: false, writeReason: 'MEMBER_RULE_UNAVAILABLE', writeUnavailableReason: 'runtime-saved-mismatch',
    availability: 'unavailable', runtime: { available: true, reason: null, names: ['Other_Name'], consistent: false } } });
  expect(screen.getByText(/运行时与保存名单不一致/)).toBeInTheDocument(); expect(screen.getByText(/不能视为空名单/)).toBeInTheDocument();
  expect(screen.getByText(/运行时开关：未知/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: '添加玩家' })).toBeDisabled();
});
it('keeps the cancel button reachable by keyboard while background refresh disables confirmation', () => {
  const refresh = vi.fn(async () => true), f = show({ refresh });
  fireEvent.click(screen.getByRole('button', { name: '删除 Player_One' }));
  f.rerender(<LocalWhitelistPanel serverId="test" data={data} candidates={candidates} candidatesStale={false}
    stale={false} fetching={true} refresh={refresh} />);
  const dialog = screen.getByRole('dialog'); dialog.focus(); fireEvent.keyDown(dialog, { key: 'Tab' });
  expect(screen.getByRole('button', { name: '取消' })).toHaveFocus(); expect(screen.getByRole('button', { name: '确认执行' })).toBeDisabled();
});
it('does not apply an old-instance read after switching servers and aborts the obsolete request', async () => {
  let finish!: (value: WhitelistResponse) => void; let oldSignal: AbortSignal | undefined;
  vi.mocked(api.whitelist).mockImplementation((id, signal) => id === 'test' ? (oldSignal = signal, new Promise(resolve => { finish = resolve; })) :
    Promise.resolve({ data: { ...data, items: [{ name: 'Other_Name', uuid: candidates.items[0]!.uuid }] }, meta }));
  vi.mocked(api.whitelistCandidates).mockResolvedValue({ data: { ...candidates, items: [] }, meta });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const f = render(<QueryClientProvider client={client}><WhitelistPage server={server('test')} /></QueryClientProvider>);
  try {
    await waitFor(() => expect(api.whitelist).toHaveBeenCalledOnce());
    f.rerender(<QueryClientProvider client={client}><WhitelistPage server={server('other')} /></QueryClientProvider>);
    await screen.findByText('Other_Name'); expect(oldSignal?.aborted).toBe(true);
    await act(async () => { finish({ data, meta }); }); expect(screen.queryByText('Player_One')).not.toBeInTheDocument();
    expect(screen.getByText('目标服务器：other')).toBeInTheDocument();
  } finally { f.unmount(); client.clear(); }
});
it('refreshes sequentially on a five-second tick and pauses timers while the page is hidden', async () => {
  let hidden = false; vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible');
  const intervals = vi.spyOn(globalThis, 'setInterval'), clears = vi.spyOn(globalThis, 'clearInterval');
  vi.mocked(api.whitelist).mockResolvedValue({ data, meta }); vi.mocked(api.whitelistCandidates).mockResolvedValue({ data: candidates, meta });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const f = render(<QueryClientProvider client={client}><WhitelistPage server={server('test')} /></QueryClientProvider>);
  try {
    await screen.findByRole('button', { name: '添加 Player_Two' });
    let index = -1;
    intervals.mock.calls.forEach((row, current) => { if (row[1] === 5000) index = current; });
    expect(index).toBeGreaterThanOrEqual(0);
    const callback = intervals.mock.calls[index]![0] as () => void, handle = intervals.mock.results[index]!.value;
    await act(async () => { callback(); }); await waitFor(() => expect(api.whitelist).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.whitelistCandidates).mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(api.whitelist).mock.invocationCallOrder[0]!);
    act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    expect(clears).toHaveBeenCalledWith(handle);
  } finally { f.unmount(); client.clear(); }
});
