import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldInfo } from '@mcsm/contracts';
import { api, ApiClientError } from '../api';
import { WorldArchiveAction, WorldArchiveList } from './WorldArchiveAction';
vi.mock('../api',async (load) => ({ ...(await load<typeof import('../api')>()),api:{ archiveWorld:vi.fn(),operation:vi.fn(),worldArchives:vi.fn() } }));
const meta = { mode:'local',requestId:'test',generatedAt:'2026-10-04T00:00:00.000Z' };
const world = { worldId:'world-' + '1'.repeat(24),worldRevision:'2'.repeat(64),name:{ status:'available',value:'world' },minecraftVersion:{ status:'available',value:'26.3' } } as WorldInfo;
const opId = '123e4567-e89b-42d3-a456-426614174000';
function renderAction(current = world) {
  const client = new QueryClient({ defaultOptions:{ queries:{ retry:false },mutations:{ retry:false } } });
  return render(<QueryClientProvider client={client}><WorldArchiveAction serverId="archive-test" world={current} running={false} allowed /></QueryClientProvider>);
}
const confirm = async () => {
  fireEvent.change(await screen.findByLabelText('输入世界名确认归档'),{ target:{ value:'world' } });
  fireEvent.click(screen.getByLabelText('我确认归档完整世界集，并允许必要停服'));
};
beforeEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks(); });
describe('明确归档完整世界集',() => {
  it('requires both exact name and explicit approval, submits a bound revision and reports none',async () => {
    vi.mocked(api.archiveWorld).mockResolvedValue({ data:{ operation:{ id:opId } },meta } as never);
    vi.mocked(api.operation).mockResolvedValue({ data:{ state:'succeeded',error:null },meta } as never);
    renderAction(); const button = screen.getByRole('button',{ name:'确认归档并保持停服' }); expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('输入世界名确认归档'),{ target:{ value:'world' } }); expect(button).toBeDisabled();
    fireEvent.click(screen.getByLabelText('我确认归档完整世界集，并允许必要停服')); fireEvent.click(button);
    await waitFor(() => expect(api.archiveWorld).toHaveBeenCalledWith('archive-test',{ worldId:world.worldId,worldRevision:world.worldRevision,confirmWorldName:'world',intent:'archive-world-set',allowStop:true },expect.any(String)));
    expect(await screen.findByText('世界归档完成；当前没有活动世界，服务器保持停止。')).toBeInTheDocument();
    expect(sessionStorage.getItem('mcsm.pendingWorldArchive.archive-test')).toBeNull();
  });
  it('preserves uncertain network payload/key across refresh even when inventory is empty',async () => {
    vi.mocked(api.archiveWorld).mockRejectedValue(new ApiClientError('断线','network'));
    const first = renderAction(); await confirm(); fireEvent.click(screen.getByRole('button',{ name:'确认归档并保持停服' }));
    await screen.findByRole('alert'); const sent = vi.mocked(api.archiveWorld).mock.calls[0]!; first.unmount();
    const client = new QueryClient({ defaultOptions:{ queries:{ retry:false } } });
    render(<QueryClientProvider client={client}><WorldArchiveAction serverId="archive-test" world={undefined} running={false} allowed={false} /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button',{ name:'确认未完成的归档请求' }));
    await waitFor(() => expect(api.archiveWorld).toHaveBeenCalledTimes(2)); expect(vi.mocked(api.archiveWorld).mock.calls[1]).toEqual(sent);
  });
  it('does not inherit confirmation after definitive revision conflict',async () => {
    vi.mocked(api.archiveWorld).mockRejectedValue(new ApiClientError('世界变化','http',409,'WORLD_REVISION_CONFLICT'));
    renderAction(); await confirm(); fireEvent.click(screen.getByRole('button',{ name:'确认归档并保持停服' }));
    await screen.findByRole('alert'); expect(screen.getByLabelText('输入世界名确认归档')).toHaveValue('');
    expect(screen.getByLabelText('我确认归档完整世界集，并允许必要停服')).not.toBeChecked();
    expect(screen.getByRole('button',{ name:'确认归档并保持停服' })).toBeDisabled();
  });
  it('restores an accepted operation query without resubmitting',async () => {
    sessionStorage.setItem('mcsm.pendingWorldArchive.archive-test',JSON.stringify({ key:opId,savedAt:Date.now(),body:{ worldId:world.worldId,worldRevision:world.worldRevision,confirmWorldName:'world',intent:'archive-world-set',allowStop:false },operationId:opId }));
    vi.mocked(api.operation).mockResolvedValue({ data:{ state:'interrupted',step:'recovery-required',error:{ message:'需要人工恢复' } },meta } as never);
    renderAction(); expect(await screen.findByText('需要人工恢复')).toBeInTheDocument(); expect(api.archiveWorld).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('mcsm.pendingWorldArchive.archive-test')).not.toBeNull();
  });
  it('allows fresh confirmation and key after an accepted operation definitively fails',async () => {
    vi.mocked(api.archiveWorld).mockResolvedValueOnce({ data:{ operation:{ id:opId } },meta } as never)
      .mockResolvedValueOnce({ data:{ operation:{ id:'123e4567-e89b-42d3-a456-426614174001' } },meta } as never);
    vi.mocked(api.operation).mockResolvedValueOnce({ data:{ state:'failed',step:'failed',error:{ code:'WORLD_REVISION_CONFLICT',message:'世界已变化，请重新确认' } },meta } as never)
      .mockResolvedValue({ data:{ state:'queued',step:'queued',error:null },meta } as never);
    const action = renderAction(); await confirm(); fireEvent.click(screen.getByRole('button',{ name:'确认归档并保持停服' }));
    await waitFor(() => expect(screen.getByText('世界已变化，请重新确认')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText('输入世界名确认归档')).toHaveValue(''));
    expect(screen.getByLabelText('我确认归档完整世界集，并允许必要停服')).not.toBeChecked();
    expect(screen.getByRole('button',{ name:'确认归档并保持停服' })).toBeDisabled();
    expect(sessionStorage.getItem('mcsm.pendingWorldArchive.archive-test')).toBeNull();
    const first = vi.mocked(api.archiveWorld).mock.calls[0]!;
    await confirm(); fireEvent.click(screen.getByRole('button',{ name:'确认归档并保持停服' }));
    await waitFor(() => expect(api.archiveWorld).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.archiveWorld).mock.calls[1]![2]).not.toBe(first[2]);
    expect(vi.mocked(api.archiveWorld).mock.calls[1]![1]).toEqual(first[1]);
    action.unmount();
  });
  it('preserves an accepted recovery-required failure without enabling resubmission',async () => {
    sessionStorage.setItem('mcsm.pendingWorldArchive.archive-test',JSON.stringify({ key:opId,savedAt:Date.now(),body:{ worldId:world.worldId,worldRevision:world.worldRevision,confirmWorldName:'world',intent:'archive-world-set',allowStop:false },operationId:opId }));
    vi.mocked(api.operation).mockResolvedValue({ data:{ state:'failed',step:'failed',error:{ code:'RECOVERY_REQUIRED',message:'保留现场' } },meta } as never);
    renderAction(); expect(await screen.findByText('保留现场')).toBeInTheDocument();
    expect(screen.queryByLabelText('输入世界名确认归档')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('mcsm.pendingWorldArchive.archive-test')).not.toBeNull(); expect(api.archiveWorld).not.toHaveBeenCalled();
  });
  it('shows verified archives independently from active inventory',async () => {
    vi.mocked(api.worldArchives).mockResolvedValue({ data:{ items:[{ id:opId,name:'archived-world',minecraftVersion:'26.3',fileCount:17,sizeBytes:100,createdAt:meta.generatedAt }] },meta } as never);
    const client = new QueryClient({ defaultOptions:{ queries:{ retry:false } } });
    render(<QueryClientProvider client={client}><WorldArchiveList serverId="archive-test" /></QueryClientProvider>);
    expect(await screen.findByRole('heading',{ name:'archived-world' })).toBeInTheDocument(); expect(screen.getByText(/17 个文件/)).toBeInTheDocument();
  });
});
