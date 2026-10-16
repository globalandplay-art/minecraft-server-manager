import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ServersResponse, WhitelistResponse } from '@mcsm/contracts';
import { api } from '../api';
import { WhitelistPage } from './Whitelist';
vi.mock('../api', async load => { const actual = await load<typeof import('../api')>(); return { ...actual, api: { ...actual.api, whitelist: vi.fn() } }; });
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
