import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrashAnalysisResponse, ServersResponse } from '@mcsm/contracts';
import { api } from '../api';
import { CrashAnalysisPage } from './CrashAnalysis';
vi.mock('../api', async (load) => ({ ...(await load<typeof import('../api')>()), api: { crashAnalysis: vi.fn() } }));
const response: CrashAnalysisResponse = { meta: { mode: 'local', requestId: 'test', generatedAt: '2026-10-08T00:00:00Z' },
  data: { status: 'available', reason: null, sampledAt: '2026-10-08T00:00:00Z', minimumIntervalMs: 5000,
    findings: [], sources: [], incomplete: false, conclusion: 'no-rule-match', limitations: [] } };
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const content = (id: string) => <QueryClientProvider client={client}>
    <CrashAnalysisPage key={id} server={{ server: { id } } as ServersResponse['data']['items'][number]} /></QueryClientProvider>;
  const view = render(content('test'));
  return { ...view, select: (id: string) => view.rerender(content(id)) };
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('manual crash evidence', () => {
  it('does not scan until click and does not imply no-match means healthy', async () => {
    vi.mocked(api.crashAnalysis).mockResolvedValue(response); show();
    expect(api.crashAnalysis).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: '读取崩溃证据' }));
    expect(await screen.findByText(/未匹配已知规则，不代表服务器健康/)).toBeInTheDocument();
    expect(api.crashAnalysis).toHaveBeenCalledTimes(1);
  });
  it('shows incomplete coverage without invented snippets', async () => {
    vi.mocked(api.crashAnalysis).mockResolvedValue({ ...response, data: { ...response.data, incomplete: true,
      conclusion: 'insufficient-evidence', sources: [{ id: 'latest-log', source: 'latest-log', truncated: true }] } }); show();
    fireEvent.click(screen.getByRole('button', { name: '读取崩溃证据' }));
    expect(await screen.findByText('证据不足，无法给出可能原因。')).toBeInTheDocument();
    expect(screen.getByText(/截断：未分析/)).toBeInTheDocument();
  });
  it('renders evidence as text, labels sanitized coordinates and uncertainty', async () => {
    vi.mocked(api.crashAnalysis).mockResolvedValue({ ...response, data: { ...response.data, conclusion: 'possible-causes',
      findings: [{ code: 'out-of-memory', confidence: 'possible', title: '可能内存不足', guidance: '核对完整异常',
        evidence: [{ sourceId: 'latest-log', excerptLine: 2, snippet: '<script>OutOfMemoryError</script>' }] }] } }); show();
    fireEvent.click(screen.getByRole('button', { name: '读取崩溃证据' }));
    expect(await screen.findByText('<script>OutOfMemoryError</script>')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull(); expect(screen.getByText(/不是完整文件行号/)).toBeInTheDocument();
  });
  it('shows unavailable mock', async () => {
    vi.mocked(api.crashAnalysis).mockResolvedValue({ ...response, data: { ...response.data, status: 'unavailable',
      reason: 'local-instance-required', sampledAt: null, conclusion: 'unavailable' } }); show();
    fireEvent.click(screen.getByRole('button', { name: '读取崩溃证据' })); expect(await screen.findByText('分析不可用')).toBeInTheDocument();
  });
  it('hides previous evidence when manual refresh fails without automatic retry', async () => {
    vi.mocked(api.crashAnalysis).mockResolvedValueOnce(response).mockRejectedValueOnce(new Error('failed'));
    show(); fireEvent.click(screen.getByRole('button', { name: '读取崩溃证据' }));
    expect(await screen.findByRole('region', { name: '崩溃分析结果' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '读取崩溃证据' }));
    expect(await screen.findByText('发生未知错误，请稍后重试。')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '崩溃分析结果' })).not.toBeInTheDocument();
    expect(api.crashAnalysis).toHaveBeenCalledTimes(2);
  });
  it('keeps a completed prior-instance scan out of the newly selected page', async () => {
    let resolve!: (value: CrashAnalysisResponse) => void;
    vi.mocked(api.crashAnalysis).mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = show(); fireEvent.click(screen.getByRole('button', { name: '读取崩溃证据' }));
    view.select('other'); await act(async () => { resolve(response); });
    expect(screen.queryByRole('region', { name: '崩溃分析结果' })).not.toBeInTheDocument();
    expect(api.crashAnalysis).toHaveBeenCalledTimes(1);
  });
});
