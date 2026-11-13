import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { i18n } from '../i18n';
import { WorldReplacement } from './WorldReplacement';

vi.mock('../api', async load => ({ ...await load<typeof import('../api')>(), api: {
  worldReplacementPlan: vi.fn(), replaceWorld: vi.fn(), verifyWorldReplacement: vi.fn(), operation: vi.fn(), worldLibrary: vi.fn()
} }));
const uploadId = '11111111-1111-4111-8111-111111111111', operationId = '22222222-2222-4222-8222-222222222222';
const previousId = 'worldv2-33333333-3333-4333-8333-333333333333', nextId = 'worldv2-44444444-4444-4444-8444-444444444444';
const meta = { requestId: 'test', generatedAt: '2026-10-27T00:00:00.000Z', mode: 'local' as const };
const plan = { mode: 'replace' as const, uploadId, uploadRevision: 'a'.repeat(64), libraryRevision: 'b'.repeat(64),
  currentWorldId: previousId, currentWorldName: 'world', currentWorldRevision: 'c'.repeat(64), currentContentRevision: 'd'.repeat(64),
  propertiesRevision: 'e'.repeat(64), minecraftVersion: '26.3', fileCount: 1, sizeBytes: 128, executionAvailable: true,
  unavailableReason: null, serverMustBeStopped: true as const, requiresProtectedBackup: true as const };
const body = { uploadId, uploadRevision: plan.uploadRevision, libraryRevision: plan.libraryRevision, currentWorldId: previousId,
  currentWorldRevision: plan.currentWorldRevision, currentContentRevision: plan.currentContentRevision, propertiesRevision: plan.propertiesRevision, confirmWorldName: 'world' };
const operation = { id: operationId, serverId: 'server-a', kind: 'world-replace' as const, state: 'succeeded' as const, step: 'committed',
  progress: 100, createdAt: meta.generatedAt, updatedAt: meta.generatedAt, result: { resourceId: nextId, rollbackAvailable: false }, error: null };
const library = { serverId: 'server-a', state: 'ready' as const, reason: null, revision: 'f'.repeat(64), activeWorldId: nextId, mutationsAvailable: false,
  items: [{ worldId: nextId, levelName: 'world', state: 'present' as const, origin: 'import' as const, createdAt: meta.generatedAt, legacySlotId: null, legacyBackupAssociation: 'unverified' as const },
    { worldId: previousId, levelName: 'world', state: 'retired' as const, origin: 'legacy-observation' as const, createdAt: meta.generatedAt, legacySlotId: null, legacyBackupAssociation: 'unverified' as const }] };
const storageKey = 'lt.pendingWorldReplacement.server-a', clients: QueryClient[] = [];
function view(serverId = 'server-a') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  const wrap = (id: string) => <QueryClientProvider client={client}><WorldReplacement serverId={id} uploadId={uploadId} /></QueryClientProvider>;
  return { ...render(wrap(serverId)), wrap };
}
async function prepare() {
  fireEvent.click(screen.getByText('Replace current world (confirmation required)'));
  fireEvent.click(screen.getByRole('button', { name: 'Check replacement plan' }));
  await screen.findByLabelText('Type the current world name to confirm replacement');
  fireEvent.change(screen.getByLabelText('Type the current world name to confirm replacement'), { target: { value: 'world' } });
}
async function submit() { await prepare(); fireEvent.click(screen.getByRole('button', { name: 'Confirm world replacement' })); }
beforeEach(async () => {
  sessionStorage.clear(); await i18n.changeLanguage('en');
  vi.mocked(api.worldReplacementPlan).mockResolvedValue({ data: plan, meta });
  vi.mocked(api.replaceWorld).mockResolvedValue({ data: { operation }, meta });
  vi.mocked(api.operation).mockResolvedValue({ data: operation, meta });
  vi.mocked(api.verifyWorldReplacement).mockResolvedValue({ data: operation, meta });
  vi.mocked(api.worldLibrary).mockResolvedValue({ data: library, meta });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); vi.clearAllMocks(); sessionStorage.clear(); });
it('keeps replacement disabled when the backend only offers preview', async () => {
  vi.mocked(api.worldReplacementPlan).mockResolvedValue({ data: { ...plan, executionAvailable: false, unavailableReason: 'REPLACEMENT_TRANSACTION_PENDING' }, meta });
  view(); fireEvent.click(screen.getByText('Replace current world (confirmation required)'));
  fireEvent.click(screen.getByRole('button', { name: 'Check replacement plan' }));
  await screen.findByText(/Replacement execution is not enabled/);
  expect(screen.queryByRole('button', { name: 'Confirm world replacement' })).not.toBeInTheDocument(); expect(api.replaceWorld).not.toHaveBeenCalled();
});
it('requires exact name, persists the immutable request before sending once and verifies explicitly', async () => {
  vi.mocked(api.replaceWorld).mockImplementation(async (serverId, approval, key) => {
    expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual({ version: 1, serverId, body: approval, key }); return { data: { operation }, meta };
  });
  view(); await prepare();
  fireEvent.change(screen.getByLabelText('Type the current world name to confirm replacement'), { target: { value: 'World' } });
  expect(screen.getByRole('button', { name: 'Confirm world replacement' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Type the current world name to confirm replacement'), { target: { value: 'world' } });
  const button = screen.getByRole('button', { name: 'Confirm world replacement' }); fireEvent.click(button); fireEvent.click(button);
  const verify = await screen.findByRole('button', { name: 'Verify saved replacement result' });
  expect(api.replaceWorld).toHaveBeenCalledTimes(1); expect(api.verifyWorldReplacement).not.toHaveBeenCalled();
  expect(vi.mocked(api.replaceWorld).mock.calls[0]!.slice(0, 2)).toEqual(['server-a', body]);
  expect(screen.queryByText(/Replacement and the new world identity were verified/)).not.toBeInTheDocument();
  fireEvent.click(verify); fireEvent.click(verify); await screen.findByText(/Replacement and the new world identity were verified/);
  expect(api.verifyWorldReplacement).toHaveBeenCalledTimes(1);
  expect(api.verifyWorldReplacement).toHaveBeenCalledWith('server-a', operationId);
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('world'));
});
it('keeps an uncertain request across remount and only resends the same key on explicit action', async () => {
  vi.mocked(api.replaceWorld).mockRejectedValueOnce(new Error('Response lost'));
  const first = view(); await submit(); expect(await screen.findByRole('alert')).toHaveTextContent('An unknown error occurred. Try again later.');
  const saved = JSON.parse(sessionStorage.getItem(storageKey)!); first.unmount();
  view(); expect(api.replaceWorld).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: /Confirm original request/ }));
  await screen.findByRole('button', { name: 'Verify saved replacement result' });
  expect(vi.mocked(api.replaceWorld).mock.calls[1]).toEqual(['server-a', saved.body, saved.key]);
});
it('does not show success for a foreign operation or an unretired old identity', async () => {
  vi.mocked(api.worldLibrary).mockResolvedValue({ data: { ...library, items: library.items.filter(item => item.worldId === nextId) }, meta });
  view(); await submit(); fireEvent.click(await screen.findByRole('button', { name: 'Verify saved replacement result' }));
  await waitFor(() => expect(api.worldLibrary).toHaveBeenCalled());
  expect(screen.queryByText(/Replacement and the new world identity were verified/)).not.toBeInTheDocument();
});
it('does not verify a receipt for another instance', async () => {
  vi.mocked(api.operation).mockResolvedValue({ data: { ...operation, serverId: 'server-b' }, meta });
  view(); await submit(); await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Verify saved replacement result' })).not.toBeInTheDocument(); expect(api.verifyWorldReplacement).not.toHaveBeenCalled();
});
it('preserves typed confirmation on language switch without sending a request', async () => {
  view(); await prepare(); await act(async () => { await i18n.changeLanguage('ja'); });
  expect(screen.getByRole('textbox')).toHaveValue('world'); expect(api.replaceWorld).not.toHaveBeenCalled();
  await act(async () => { await i18n.changeLanguage('zh-CN'); }); expect(screen.getByRole('textbox')).toHaveValue('world');
});
it('blocks corrupted pending evidence instead of clearing it or starting a new request', () => {
  sessionStorage.setItem(storageKey, '{broken'); view();
  fireEvent.click(screen.getByText('Replace current world (confirmation required)'));
  expect(screen.getByRole('button', { name: 'Check replacement plan' })).toBeDisabled(); expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(sessionStorage.getItem(storageKey)).toBe('{broken'); expect(api.replaceWorld).not.toHaveBeenCalled();
});
it('does not apply a late plan from the old selected instance', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof api.worldReplacementPlan>>) => void;
  vi.mocked(api.worldReplacementPlan).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const rendered = view(); fireEvent.click(screen.getByText('Replace current world (confirmation required)'));
  fireEvent.click(screen.getByRole('button', { name: 'Check replacement plan' }));
  await waitFor(() => expect(resolve).toBeTypeOf('function'));
  rendered.rerender(rendered.wrap('server-b'));
  await act(async () => { resolve({ data: plan, meta }); });
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); expect(api.replaceWorld).not.toHaveBeenCalled();
});
it('preserves a conflicting stored operation identity instead of overwriting it with a response', async () => {
  const conflict = '55555555-5555-4555-8555-555555555555';
  vi.mocked(api.replaceWorld).mockImplementation(async () => {
    const saved = JSON.parse(sessionStorage.getItem(storageKey)!);
    sessionStorage.setItem(storageKey, JSON.stringify({ ...saved, operationId: conflict })); return { data: { operation }, meta };
  });
  view(); await submit(); await screen.findByRole('alert');
  expect(JSON.parse(sessionStorage.getItem(storageKey)!).operationId).toBe(conflict);
  expect(api.verifyWorldReplacement).not.toHaveBeenCalled();
});
it('preserves a conflicting stored operation identity when finishing an already verified result', async () => {
  view(); await submit(); fireEvent.click(await screen.findByRole('button', { name: 'Verify saved replacement result' }));
  await screen.findByText(/Replacement and the new world identity were verified/);
  const conflict = '55555555-5555-4555-8555-555555555555', saved = JSON.parse(sessionStorage.getItem(storageKey)!);
  sessionStorage.setItem(storageKey, JSON.stringify({ ...saved, operationId: conflict }));
  fireEvent.click(screen.getByRole('button', { name: 'Done' })); await screen.findByRole('alert');
  expect(JSON.parse(sessionStorage.getItem(storageKey)!).operationId).toBe(conflict); expect(api.replaceWorld).toHaveBeenCalledTimes(1);
});
