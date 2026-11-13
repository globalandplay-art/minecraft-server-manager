import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { i18n } from '../i18n';
import { WorldLibraryList } from './WorldLibraryList';

vi.mock('../api', async load => ({ ...await load<typeof import('../api')>(), api: {
  worldLibrary: vi.fn(), worldActivationPlan: vi.fn(), activateWorld: vi.fn(), operation: vi.fn(), inspectStoppedWorldRevision: vi.fn()
} }));
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); sessionStorage.clear(); vi.clearAllMocks(); });
it.each([['zh-CN', '待验证'], ['en', 'Pending verification'], ['ja', '検証待ち']])('shows a generated UUID pending without mutation controls in %s', async (language, label) => {
  sessionStorage.clear(); await i18n.changeLanguage(language);
  vi.mocked(api.worldLibrary).mockResolvedValue({ data: { serverId: 'server-a', state: 'inspection-required', reason: 'identity-unverified',
    revision: 'a'.repeat(64), activeWorldId: null, mutationsAvailable: false, activationAvailable: false,
    items: [{ worldId: 'worldv2-11111111-1111-4111-8111-111111111111', levelName: 'Generated-V2', state: 'present', origin: 'generation',
      createdAt: '2026-10-29T00:00:00.000Z', legacySlotId: null, legacyBackupAssociation: 'unverified' }] },
    meta: { requestId: 'test', generatedAt: '2026-10-29T00:00:00.000Z', mode: 'local' } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><WorldLibraryList serverId="server-a" /></QueryClientProvider>);
  expect(await screen.findByText('Generated-V2', { selector: 'strong' })).toBeVisible(); expect(screen.getByText(label)).toBeVisible();
  expect(screen.getByRole('combobox')).toBeDisabled(); expect(api.activateWorld).not.toHaveBeenCalled();
  expect(api.inspectStoppedWorldRevision).not.toHaveBeenCalled();
});

it('explicitly records a generated-world stop verification and discards a response after switching instances', async () => {
  await i18n.changeLanguage('en');
  const worldId = 'worldv2-11111111-1111-4111-8111-111111111111', serverId = 'server-a';
  const meta = { requestId: 'test', generatedAt: '2026-11-06T00:00:00.000Z', mode: 'local' as const };
  vi.mocked(api.worldLibrary).mockImplementation(async id => ({ data: { serverId: id, state: 'inspection-required', reason: 'identity-unverified',
    revision: 'a'.repeat(64), activeWorldId: null,
    mutationsAvailable: false, activationAvailable: false, stoppedRevisionInspectionAvailable: true,
    stoppedRevisionInspectionWorldId: worldId,
    items: [{ worldId, levelName: 'world', state: 'present', origin: 'generation', createdAt: meta.generatedAt,
      legacySlotId: null, legacyBackupAssociation: 'unverified' }] }, meta }));
  const operationId = '11111111-1111-4111-8111-111111111111';
  const response = { data: { serverId, worldId, operationId, inspectionOnly: true, recoveryRequired: true, confirmationRecorded: false }, meta } as const;
  const recorded = { ...response, data: { ...response.data, confirmationRecorded: true } };
  const inspect = vi.mocked(api.inspectStoppedWorldRevision);
  inspect.mockResolvedValue(response);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  const view = (id: string) => <QueryClientProvider client={client}><WorldLibraryList serverId={id} /></QueryClientProvider>;
  const { rerender } = render(view(serverId));
  const button = await screen.findByRole('button', { name: 'Inspect stopped world' });
  expect(api.inspectStoppedWorldRevision).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(await screen.findByText('The stopped world matches the record. Recovery inspection is still required.')).toBeVisible();
  expect(api.inspectStoppedWorldRevision).toHaveBeenCalledExactlyOnceWith(serverId);
  inspect.mockResolvedValueOnce(recorded);
  fireEvent.click(screen.getByRole('button', { name: 'Record stop verification' }));
  expect(await screen.findByText('Stop verification recorded. The recovery lock remains active.')).toBeVisible();
  expect(inspect).toHaveBeenLastCalledWith(serverId, operationId);

  fireEvent.click(button);
  const confirm = await screen.findByRole('button', { name: 'Record stop verification' });
  let complete!: (value: typeof recorded) => void;
  inspect.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  fireEvent.click(confirm);
  await waitFor(() => expect(confirm).toBeDisabled());
  rerender(view('server-b'));
  await screen.findByRole('button', { name: 'Inspect stopped world' });
  await act(async () => { complete(recorded); });
  expect(screen.queryByText('Stop verification recorded. The recovery lock remains active.')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Record stop verification' })).not.toBeInTheDocument();
  inspect.mockResolvedValueOnce({ ...recorded, data: { ...recorded.data, serverId: 'server-b' } });
  fireEvent.click(screen.getByRole('button', { name: 'Inspect stopped world' }));
  expect(await screen.findByText('Stop verification recorded. The recovery lock remains active.')).toBeVisible();
  expect(inspect).toHaveBeenLastCalledWith('server-b');
  expect(screen.queryByRole('button', { name: 'Record stop verification' })).not.toBeInTheDocument();
});
