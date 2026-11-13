import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorldLibraryResponse } from '@mcsm/contracts';
import { api, ApiClientError } from '../api';
import { i18n } from '../i18n';
import { WorldActivation } from './WorldActivation';

vi.mock('../api', async load => ({ ...await load<typeof import('../api')>(), api: { worldActivationPlan: vi.fn(), activateWorld: vi.fn(), operation: vi.fn(), worldLibrary: vi.fn() } }));
const id = 'worldv2-44444444-4444-4444-8444-444444444444';
const library: WorldLibraryResponse['data'] = { serverId: 'server-a', state: 'ready', reason: null,
  revision: 'a'.repeat(64), activeWorldId: 'worldv2-33333333-3333-4333-8333-333333333333',
  mutationsAvailable: true, items: [{ worldId: id, levelName: 'Independent', state: 'present', origin: 'import',
    createdAt: '2026-10-26T00:00:00.000Z', legacySlotId: null, legacyBackupAssociation: 'unverified' }] };
const meta = { requestId: 'test', generatedAt: '2026-10-26T00:00:00.000Z', mode: 'local' as const };
const plan = { serverId: 'server-a', worldId: id, libraryRevision: library.revision!, currentWorldId: library.activeWorldId!,
  currentWorldRevision: 'b'.repeat(64), targetWorldRevision: 'c'.repeat(64), currentContentRevision: 'd'.repeat(64),
  targetContentRevision: 'e'.repeat(64), propertiesRevision: 'f'.repeat(64), levelName: 'Independent', serverMustBeStopped: true as const,
  loadVerified: false as const, executionAvailable: true, unavailableReason: null };
const body = { worldId: plan.worldId, libraryRevision: plan.libraryRevision, currentWorldId: plan.currentWorldId,
  currentWorldRevision: plan.currentWorldRevision, targetWorldRevision: plan.targetWorldRevision,
  currentContentRevision: plan.currentContentRevision, targetContentRevision: plan.targetContentRevision,
  propertiesRevision: plan.propertiesRevision, confirmWorldName: 'Independent' };
const operationId = '22222222-2222-4222-8222-222222222222';
const operation = { id: operationId, serverId: 'server-a', kind: 'world-activate' as const, state: 'succeeded' as const,
  step: 'completed', progress: 100, createdAt: meta.generatedAt, updatedAt: meta.generatedAt,
  result: { resourceId: id, rollbackAvailable: false }, error: null };
const storageKey = 'lt.pendingWorldActivation.server-a';
const clients: QueryClient[] = [];
function view(data = library) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  return { client, ...render(<QueryClientProvider client={client}><WorldActivation library={data} /></QueryClientProvider>) };
}
async function prepare() {
  fireEvent.change(screen.getByRole('combobox'), { target: { value: id } });
  fireEvent.click(screen.getByRole('button', { name: 'Check activation plan' }));
  await screen.findByText(/Read-only checks completed/);
  fireEvent.change(screen.getByLabelText('Type the target world name to confirm'), { target: { value: 'Independent' } });
}
beforeEach(async () => {
  sessionStorage.clear(); await i18n.changeLanguage('en');
  vi.mocked(api.worldActivationPlan).mockResolvedValue({ data: plan, meta });
  vi.mocked(api.activateWorld).mockResolvedValue({ data: { operation }, meta });
  vi.mocked(api.operation).mockResolvedValue({ data: operation, meta });
  vi.mocked(api.worldLibrary).mockResolvedValue({ data: { ...library, activeWorldId: id }, meta });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); vi.clearAllMocks(); sessionStorage.clear(); });
it('does not infer activation permission from import permission or an absent capability', () => {
  view(); expect(screen.getByRole('combobox')).toBeDisabled();
  expect(api.worldActivationPlan).not.toHaveBeenCalled(); expect(api.activateWorld).not.toHaveBeenCalled();
});
it('does not resend a saved activation when the generated catalog is pending verification', () => {
  sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, serverId: 'server-a', key: operationId, body }));
  view({ ...library, state: 'inspection-required', reason: 'identity-unverified', activeWorldId: null,
    activationAvailable: false, mutationsAvailable: false, items: [{ ...library.items[0]!, origin: 'generation' }] });
  expect(screen.getByRole('button', { name: 'Confirm original request' })).toBeDisabled();
  expect(api.activateWorld).not.toHaveBeenCalled();
});
it('shows a read-only plan and retains the selected world across language changes without sending a mutation', async () => {
  vi.mocked(api.worldActivationPlan).mockResolvedValue({ data: { serverId: 'server-a', worldId: id,
    libraryRevision: library.revision!, currentWorldId: library.activeWorldId!, currentWorldRevision: 'b'.repeat(64),
    targetWorldRevision: 'c'.repeat(64), currentContentRevision: 'd'.repeat(64), targetContentRevision: 'e'.repeat(64),
    propertiesRevision: 'f'.repeat(64), levelName: 'Independent', serverMustBeStopped: true, loadVerified: false,
    executionAvailable: true, unavailableReason: null }, meta: { requestId: 'test', generatedAt: '2026-10-26T00:00:00.000Z', mode: 'local' } });
  view({ ...library, activationAvailable: true });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: id } });
  fireEvent.click(screen.getByRole('button', { name: 'Check activation plan' }));
  await screen.findByText(/Read-only checks completed/);
  await act(async () => { await i18n.changeLanguage('ja'); });
  expect(screen.getByRole('combobox')).toHaveValue(id); expect(api.activateWorld).not.toHaveBeenCalled();
});
it('requires an exact name and dialog confirmation, saves approval before sending and verifies the active world', async () => {
  vi.mocked(api.activateWorld).mockImplementation(async (server, approval, key) => {
    expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual({ version: 1, serverId: server, key, body: approval });
    return { data: { operation }, meta };
  });
  view({ ...library, activationAvailable: true });
  await prepare();
  fireEvent.change(screen.getByLabelText('Type the target world name to confirm'), { target: { value: 'independent' } });
  expect(screen.getByRole('button', { name: 'Confirm world activation' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Type the target world name to confirm'), { target: { value: 'Independent' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm world activation' }));
  await screen.findByText(/World activation completed/);
  expect(api.activateWorld).toHaveBeenCalledTimes(1);
  expect(vi.mocked(api.activateWorld).mock.calls[0]!.slice(0, 2)).toEqual(['server-a', body]);
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Independent'));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(sessionStorage.getItem(storageKey)).toBeNull();
});
it('does not send when the confirmation dialog is cancelled', async () => {
  vi.mocked(window.confirm).mockReturnValue(false);
  view({ ...library, activationAvailable: true }); await prepare();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm world activation' }));
  expect(api.activateWorld).not.toHaveBeenCalled(); expect(sessionStorage.getItem(storageKey)).toBeNull();
});
it('retains typed confirmation across language switching without submitting', async () => {
  view({ ...library, activationAvailable: true }); await prepare();
  await act(async () => { await i18n.changeLanguage('ja'); });
  expect(screen.getByLabelText(i18n.t('worldv2.activationName'))).toHaveValue('Independent');
  expect(api.activateWorld).not.toHaveBeenCalled();
});
it('does not announce success from HTTP202 while the operation is still running', async () => {
  vi.mocked(api.operation).mockResolvedValue({ data: { ...operation, state: 'running', result: null }, meta });
  view({ ...library, activationAvailable: true }); await prepare();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm world activation' }));
  await screen.findByText('Running');
  expect(screen.queryByText(/World activation completed/)).not.toBeInTheDocument();
  expect(api.worldLibrary).not.toHaveBeenCalled();
});
it('keeps lost responses across remount and manually reuses the exact key and approval without automatic POST', async () => {
  vi.mocked(api.activateWorld).mockRejectedValueOnce(new ApiClientError('response lost', 'network'));
  const first = view({ ...library, activationAvailable: true }); await prepare();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm world activation' }));
  await screen.findByRole('button', { name: 'Confirm original request' });
  const original = vi.mocked(api.activateWorld).mock.calls[0]!;
  expect(api.activateWorld).toHaveBeenCalledTimes(1);
  first.unmount(); view({ ...library, activationAvailable: true });
  expect(api.activateWorld).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm original request' }));
  await screen.findByText(/World activation completed/);
  expect(vi.mocked(api.activateWorld).mock.calls).toEqual([original, original]);
});
it.each(['failed', 'interrupted'] as const)('preserves %s operations for inspection without replay', async state => {
  vi.mocked(api.operation).mockResolvedValue({ data: { ...operation, state, result: null }, meta });
  view({ ...library, activationAvailable: true }); await prepare();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm world activation' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent(/Inspection required/);
  expect(api.activateWorld).toHaveBeenCalledTimes(1); expect(sessionStorage.getItem(storageKey)).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
});
it.each(['active', 'server', 'resource'] as const)('rejects an inconsistent final %s identity', async kind => {
  if (kind === 'resource') vi.mocked(api.operation).mockResolvedValue({ data: { ...operation, result: { ...operation.result, resourceId: library.activeWorldId } }, meta });
  else vi.mocked(api.worldLibrary).mockResolvedValue({ data: { ...library, activeWorldId: kind === 'active' ? library.activeWorldId : id,
    serverId: kind === 'server' ? 'server-b' : 'server-a' }, meta });
  view({ ...library, activationAvailable: true }); await prepare();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm world activation' }));
  await screen.findByText(/Inspection required/);
  expect(screen.queryByText(/World activation completed/)).not.toBeInTheDocument();
});
it('restores known operations using GET only', async () => {
  sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, serverId: 'server-a', key: operationId, body, operationId }));
  view(); await screen.findByText(/World activation completed/);
  expect(api.activateWorld).not.toHaveBeenCalled(); expect(api.worldActivationPlan).not.toHaveBeenCalled();
});
it('fails closed on a corrupt stored request and preserves the evidence', () => {
  sessionStorage.setItem(storageKey, '{broken'); view({ ...library, activationAvailable: true });
  expect(screen.getByRole('combobox')).toBeDisabled(); expect(screen.getByRole('alert')).toHaveTextContent(/cannot be safely read or saved/);
  expect(sessionStorage.getItem(storageKey)).toBe('{broken'); expect(api.activateWorld).not.toHaveBeenCalled();
});
it('does not send if request persistence fails', async () => {
  view({ ...library, activationAvailable: true }); await prepare();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm world activation' }));
  await screen.findByRole('alert'); expect(api.activateWorld).not.toHaveBeenCalled();
});
it('discards late plans after switching servers', async () => {
  let finish!: (response: Awaited<ReturnType<typeof api.worldActivationPlan>>) => void;
  vi.mocked(api.worldActivationPlan).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const rendered = view({ ...library, activationAvailable: true });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: id } });
  fireEvent.click(screen.getByRole('button', { name: 'Check activation plan' }));
  rendered.rerender(<QueryClientProvider client={rendered.client}><WorldActivation library={{ ...library, serverId: 'server-b', activationAvailable: true }} /></QueryClientProvider>);
  await act(async () => { finish({ data: plan, meta }); });
  expect(screen.getByRole('combobox')).toHaveValue(''); expect(screen.queryByRole('button', { name: 'Confirm world activation' })).not.toBeInTheDocument();
  expect(api.activateWorld).not.toHaveBeenCalled();
});
it('does not accept a successful operation belonging to another instance', async () => {
  vi.mocked(api.operation).mockResolvedValue({ data: { ...operation, serverId: 'server-b' }, meta });
  view({ ...library, activationAvailable: true }); await prepare();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm world activation' }));
  await screen.findByText(/Inspection required/); expect(api.worldLibrary).not.toHaveBeenCalled();
});
it('keeps cached success from releasing pending evidence while the current operation GET is pending or fails', async () => {
  sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, serverId: 'server-a', key: operationId, body, operationId }));
  let reject!: (reason: Error) => void;
  vi.mocked(api.operation).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  client.setQueryData(['world-activation-operation', 'server-a', operationId], { data: operation, meta });
  client.setQueryData(['world-activation-final-list', 'server-a', operationId], { data: { ...library, activeWorldId: id }, meta });
  render(<QueryClientProvider client={client}><WorldActivation library={library} /></QueryClientProvider>);
  expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  expect(api.worldLibrary).not.toHaveBeenCalled();
  await act(async () => { reject(new ApiClientError('current operation unavailable', 'http', 403)); });
  await screen.findByText('current operation unavailable');
  expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  expect(sessionStorage.getItem(storageKey)).not.toBeNull(); expect(api.activateWorld).not.toHaveBeenCalled();
});
it('prevents a second POST from rapid duplicate clicks and retains the original key', async () => {
  let finish!: (response: Awaited<ReturnType<typeof api.activateWorld>>) => void;
  vi.mocked(api.activateWorld).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  view({ ...library, activationAvailable: true }); await prepare();
  const submit = screen.getByRole('button', { name: 'Confirm world activation' });
  fireEvent.click(submit); fireEvent.click(submit);
  await waitFor(() => expect(api.activateWorld).toHaveBeenCalledTimes(1));
  await act(async () => { finish({ data: { operation }, meta }); });
  await screen.findByText(/World activation completed/);
});
it('does not replace another instance UI when an old submission responds after switching', async () => {
  let finish!: (response: Awaited<ReturnType<typeof api.activateWorld>>) => void;
  vi.mocked(api.activateWorld).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const rendered = view({ ...library, activationAvailable: true }); await prepare();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm world activation' }));
  await waitFor(() => expect(api.activateWorld).toHaveBeenCalledTimes(1));
  rendered.rerender(<QueryClientProvider client={rendered.client}><WorldActivation library={{ ...library, serverId: 'server-b', activationAvailable: true }} /></QueryClientProvider>);
  await act(async () => { finish({ data: { operation }, meta }); });
  expect(screen.getByRole('combobox')).toHaveValue('');
  expect(sessionStorage.getItem('lt.pendingWorldActivation.server-b')).toBeNull();
  expect(JSON.parse(sessionStorage.getItem(storageKey)!).operationId).toBe(operationId);
  expect(api.operation).not.toHaveBeenCalled(); expect(api.activateWorld).toHaveBeenCalledTimes(1);
});
it('invalidates approval when the catalog revision changes before submission', async () => {
  const rendered = view({ ...library, activationAvailable: true }); await prepare();
  rendered.rerender(<QueryClientProvider client={rendered.client}><WorldActivation library={{ ...library, activationAvailable: true, revision: '9'.repeat(64) }} /></QueryClientProvider>);
  expect(screen.queryByRole('button', { name: 'Confirm world activation' })).not.toBeInTheDocument();
  expect(api.activateWorld).not.toHaveBeenCalled();
});
