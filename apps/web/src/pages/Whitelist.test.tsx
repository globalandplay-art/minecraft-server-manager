import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ServersResponse, WhitelistResponse, Operation } from '@mcsm/contracts';
import { api } from '../api';
import { WhitelistPage } from './Whitelist';
vi.mock('../api', async load => { const actual = await load<typeof import('../api')>(); return { ...actual, api: { ...actual.api, whitelist: vi.fn(),
  changeWhitelistMember: vi.fn(), recoverWhitelist: vi.fn(), operation: vi.fn() } }; });
const payload: WhitelistResponse = { meta: { requestId: 'test', generatedAt: '2026-10-14T00:00:00Z', mode: 'local' }, data: {
  availability: 'available', reason: null, configuredEnabled: true, configuredEnforced: false, effectiveEnabled: null,
  sampledAt: '2026-10-14T00:00:00Z', source: 'whitelist-json', membershipWritable: false, writeReason: 'MEMBER_RULE_UNAVAILABLE',
  items: [{ name: 'Player_One', uuid: '123e4567-e89b-42d3-a456-426614174000' }] } };
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function show(server = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(<QueryClientProvider client={client}><WhitelistPage server={server ? { server: { id: 'test' } } as ServersResponse['data']['items'][number] : undefined} /></QueryClientProvider>);
  return { ...result, client };
}
it('shows saved members without pretending UUID verification or effective whitelist state', async () => {
  vi.mocked(api.whitelist).mockResolvedValue(payload); const f = show();
  try {
    await screen.findByText('Player_One'); expect(screen.getByText('运行时是否生效：未核验')).toBeInTheDocument();
    expect(screen.getByText(/未经账号查询验证/)).toBeInTheDocument(); expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
    expect(screen.getByText(/专用 RCON 执行链尚未接入/)).toBeInTheDocument();
    expect(screen.getByText(/不支持停服编辑、批量操作或自动重启/)).toBeInTheDocument();
    expect(api.whitelist).toHaveBeenCalledOnce(); fireEvent.click(screen.getByRole('button', { name: '刷新白名单' }));
    await waitFor(() => expect(api.whitelist).toHaveBeenCalledTimes(2));
  } finally { f.unmount(); f.client.clear(); }
});
it('does not equate missing membership with a confirmed empty list', async () => {
  vi.mocked(api.whitelist).mockResolvedValue({ ...payload, data: { ...payload.data, availability: 'unavailable', source: null, reason: 'whitelist-file-missing', items: [] } });
  const f = show(); try { await screen.findByText(/没有已保存的白名单文件/); expect(screen.queryByText('已确认保存的名单为空。')).not.toBeInTheDocument(); }
  finally { f.unmount(); f.client.clear(); }
});
it('marks retained data stale after a failed manual refresh', async () => {
  vi.mocked(api.whitelist).mockResolvedValueOnce(payload).mockRejectedValue(new Error('synthetic failure'));
  const f = show(); try { await screen.findByText('Player_One'); fireEvent.click(screen.getByRole('button', { name: '刷新白名单' }));
    await screen.findByText('下面是旧快照，尚未取得更新结果。'); expect(screen.getByText('Player_One')).toBeInTheDocument(); }
  finally { f.unmount(); f.client.clear(); }
});
it('does not query without a selected server', async () => {
  const f = show(false); try { expect(screen.getByText('请选择服务器')).toBeInTheDocument(); expect(api.whitelist).not.toHaveBeenCalled(); }
  finally { f.unmount(); f.client.clear(); }
});
const op: Operation = { id: '123e4567-e89b-42d3-a456-426614174020', serverId: 'test', kind: 'whitelist-change', state: 'succeeded',
  step: 'completed', progress: null, createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z', result: null, error: null };
function writable(): WhitelistResponse {
  return { ...payload, data: { ...payload.data, membershipWritable: true, writeReason: null, revision: 'a'.repeat(64) } };
}
it.each(['add', 'remove'] as const)('confirms %s once and observes operation success instead of assuming 202 is success', async action => {
  vi.mocked(api.whitelist).mockResolvedValue(writable());
  vi.mocked(api.changeWhitelistMember).mockResolvedValue({ data: { operation: { ...op, state: 'queued' } }, meta: payload.meta });
  vi.mocked(api.operation).mockResolvedValue({ data: op, meta: payload.meta });
  const f = show();
  try {
    await screen.findByText('Player_One');
    if (action === 'add') {
      fireEvent.change(screen.getByLabelText('玩家名称'), { target: { value: 'bad;stop' } });
      expect(screen.getByRole('button', { name: '添加玩家' })).toBeDisabled();
      fireEvent.change(screen.getByLabelText('玩家名称'), { target: { value: 'Player_Two' } });
      fireEvent.click(screen.getByRole('button', { name: '添加玩家' }));
    } else fireEvent.click(screen.getByRole('button', { name: '删除 Player_One' }));
    expect(api.changeWhitelistMember).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: '确认执行' }); fireEvent.click(confirm); fireEvent.click(confirm);
    await screen.findByText('白名单操作已确认成功。');
    expect(api.changeWhitelistMember).toHaveBeenCalledTimes(1);
    expect(api.changeWhitelistMember).toHaveBeenCalledWith('test', { action, name: action === 'add' ? 'Player_Two' : 'Player_One',
      revision: 'a'.repeat(64), confirm: true }, expect.stringMatching(/^[a-f0-9-]{36}$/u));
  } finally { f.unmount(); f.client.clear(); }
});
it('keeps writes disabled on readonly capability and after an uncertain submission', async () => {
  vi.mocked(api.whitelist).mockResolvedValue(writable());
  vi.mocked(api.changeWhitelistMember).mockRejectedValue(new Error('response-lost'));
  const f = show();
  try {
    await screen.findByText('Player_One'); fireEvent.change(screen.getByLabelText('玩家名称'), { target: { value: 'Player_Two' } });
    fireEvent.click(screen.getByRole('button', { name: '添加玩家' })); fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
    await screen.findByText(/请求结果尚未确认/);
    expect(screen.getByRole('button', { name: '添加玩家' })).toBeDisabled();
    expect(api.changeWhitelistMember).toHaveBeenCalledTimes(1); expect(api.operation).not.toHaveBeenCalled();
  } finally { f.unmount(); f.client.clear(); }
});
it('confirms evidence-only recovery and refreshes both operation and saved list without resending', async () => {
  vi.mocked(api.whitelist).mockResolvedValue(writable());
  vi.mocked(api.changeWhitelistMember).mockResolvedValue({ data: { operation: { ...op, state: 'queued' } }, meta: payload.meta });
  vi.mocked(api.operation).mockResolvedValue({ data: { ...op, state: 'interrupted' }, meta: payload.meta });
  vi.mocked(api.recoverWhitelist).mockImplementation(async () => {
    vi.mocked(api.operation).mockResolvedValue({ data: op, meta: payload.meta });
    return { data: { operation: op }, meta: payload.meta };
  });
  const f = show();
  try {
    await screen.findByText('Player_One'); fireEvent.change(screen.getByLabelText('玩家名称'), { target: { value: 'Player_Two' } });
    fireEvent.click(screen.getByRole('button', { name: '添加玩家' })); fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
    await screen.findByText('结果不确定，需要恢复检查；不会自动重发。');
    const count = vi.mocked(api.whitelist).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '核验已保存结果' }));
    expect(api.recoverWhitelist).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: '确认核验' }));
    await screen.findByText('白名单操作已确认成功。');
    await waitFor(() => expect(vi.mocked(api.whitelist).mock.calls.length).toBeGreaterThan(count));
    expect(api.recoverWhitelist).toHaveBeenCalledWith('test', op.id); expect(api.changeWhitelistMember).toHaveBeenCalledTimes(1);
  } finally { f.unmount(); f.client.clear(); }
});
