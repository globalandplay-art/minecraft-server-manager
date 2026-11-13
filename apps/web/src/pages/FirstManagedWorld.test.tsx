import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { i18n } from '../i18n';
import { FirstManagedWorld } from './FirstManagedWorld';

vi.mock('../api', async load => ({ ...await load<typeof import('../api')>(), api: {
  startFirstManagedWorld: vi.fn(), stopFirstManagedWorld: vi.fn()
} }));
const execution = '11111111-1111-4111-8111-111111111111', start = '22222222-2222-4222-8222-222222222222';
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); sessionStorage.clear(); vi.resetAllMocks(); });
function show(serverId = 'a') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const view = (server: string) => <QueryClientProvider client={client}>
    <FirstManagedWorld key={server} serverId={server} executionOperationId={execution} />
  </QueryClientProvider>;
  return { ...render(view(serverId)), view };
}
it('persists before sending and performs the matching stop only on explicit action', async () => {
  await i18n.changeLanguage('en');
  vi.mocked(api.startFirstManagedWorld).mockImplementation(async (_server, _execution, key) => {
    expect(JSON.parse(sessionStorage.getItem(`lt.firstManagedWorld.a.${execution}`)!)).toMatchObject({ phase: 'start-sent', key });
    return { data: { operation: { id: start, serverId: 'a', kind: 'start' } } } as never;
  });
  vi.mocked(api.stopFirstManagedWorld).mockResolvedValue({ data: { operation: { id: execution, serverId: 'a', kind: 'stop' } } } as never);
  show();
  expect(api.startFirstManagedWorld).not.toHaveBeenCalled();
  const button = screen.getByRole('button', { name: 'Start verified new world' });
  fireEvent.click(button); fireEvent.click(button);
  const stop = await screen.findByRole('button', { name: 'Stop this world normally' });
  expect(api.startFirstManagedWorld).toHaveBeenCalledTimes(1);
  expect(api.stopFirstManagedWorld).not.toHaveBeenCalled();
  fireEvent.click(stop); fireEvent.click(stop);
  expect(await screen.findByText('Normal stop and saved-world evidence recorded. Recovery verification is still required.')).toBeVisible();
  expect(api.stopFirstManagedWorld).toHaveBeenCalledExactlyOnceWith('a', start, expect.any(String));
});
it('keeps a lost response blocked across remount without another send', async () => {
  await i18n.changeLanguage('en');
  vi.mocked(api.startFirstManagedWorld).mockRejectedValue(new Error('response lost'));
  const first = show();
  fireEvent.click(screen.getByRole('button', { name: 'Start verified new world' }));
  expect(await screen.findByText('The result needs inspection. Check the instance and operation records. This page will not resend automatically.')).toBeVisible();
  first.unmount();
  show();
  expect(screen.queryByRole('button', { name: 'Start verified new world' })).not.toBeInTheDocument();
  expect(api.startFirstManagedWorld).toHaveBeenCalledTimes(1);
});
it('discards a late start response after switching instances', async () => {
  await i18n.changeLanguage('en');
  let resolve!: (value: Awaited<ReturnType<typeof api.startFirstManagedWorld>>) => void;
  vi.mocked(api.startFirstManagedWorld).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const page = show();
  fireEvent.click(screen.getByRole('button', { name: 'Start verified new world' }));
  await waitFor(() => expect(api.startFirstManagedWorld).toHaveBeenCalledTimes(1));
  page.rerender(page.view('b'));
  await act(async () => { resolve({ data: { operation: { id: start, serverId: 'a', kind: 'start' } } } as never); });
  expect(screen.getByRole('button', { name: 'Start verified new world' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Stop this world normally' })).not.toBeInTheDocument();
  expect(sessionStorage.getItem(`lt.firstManagedWorld.b.${execution}`)).toBeNull();
});
