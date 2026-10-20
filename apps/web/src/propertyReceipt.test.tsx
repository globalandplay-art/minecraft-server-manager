import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { authState } from './authState';
import { usePropertyReceipt, type PropertyReceipt } from './propertyReceipt';
afterEach(() => { cleanup(); vi.useRealTimers(); });
const receipt: PropertyReceipt = { body: { changes: { pvp: 'false' }, confirmOfflineIdentity: false }, revision: 'a'.repeat(64), key: 'synthetic-key' };
function setup(client = new QueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, hook: renderHook(() => usePropertyReceipt('test'), { wrapper }) };
}
it('does not let stale authentication completions restore an old request', () => {
  const { hook } = setup();
  act(() => hook.result.current.update(receipt));
  const oldUpdate = hook.result.current.update;
  act(() => authState.checking());
  act(() => oldUpdate({ ...receipt, operationId: 'old-operation' }, receipt));
  expect(hook.result.current.receipt).toBeUndefined();
});
it('does not overwrite a newer request with an older response', () => {
  const { hook, client } = setup();
  act(() => hook.result.current.update({ ...receipt, key: 'new-key' }));
  act(() => hook.result.current.update({ ...receipt, operationId: 'old-operation' }, receipt));
  expect(client.getQueryData<PropertyReceipt>(['properties-pending-receipt', authState.snapshot().generation, 'test'])?.key).toBe('new-key');
});
it('atomically refuses a second different request while an uncertain receipt exists', () => {
  const { hook, client } = setup();
  act(() => { expect(hook.result.current.update(receipt)).toBe(true); });
  act(() => { expect(hook.result.current.update({ ...receipt, key: 'different-key' })).toBe(false); });
  expect(client.getQueryData<PropertyReceipt>(['properties-pending-receipt', authState.snapshot().generation, 'test'])?.key).toBe(receipt.key);
});
it('does not silently expire an uncertain receipt during navigation', () => {
  vi.useFakeTimers();
  const { hook, client } = setup();
  act(() => hook.result.current.update(receipt));
  hook.unmount(); act(() => vi.advanceTimersByTime(24 * 60 * 60_000));
  const next = setup(client);
  expect(next.hook.result.current.receipt).toEqual(receipt);
});

it('preserves a replay reservation and acceptance against a late original rejection', () => {
  const { hook, client } = setup();
  act(() => { hook.result.current.update(receipt); });
  const replay = { ...receipt, attempt: 1 };
  act(() => { hook.result.current.update(replay, receipt); });
  act(() => { expect(hook.result.current.update(undefined, receipt)).toBe(false); });
  expect(client.getQueryData(["properties-pending-receipt", authState.snapshot().generation, "test"])).toEqual(replay);
  act(() => { hook.result.current.update({ ...replay, operationId: 'accepted' }, replay); });
  act(() => { expect(hook.result.current.update(undefined, receipt)).toBe(false); });
  expect(client.getQueryData<PropertyReceipt>(['properties-pending-receipt', authState.snapshot().generation, 'test'])?.operationId).toBe('accepted');
});
it('merges late acceptance monotonically and rejects conflicting operation IDs', () => {
  const { hook, client } = setup();
  act(() => { hook.result.current.update(receipt); });
  act(() => { hook.result.current.update({ ...receipt, attempt: 1 }, receipt); });
  act(() => { hook.result.current.update({ ...receipt, operationId: 'accepted' }, receipt); });
  expect(client.getQueryData(['properties-pending-receipt', authState.snapshot().generation, 'test'])).toMatchObject({ attempt: 1, operationId: 'accepted' });
  act(() => { expect(hook.result.current.update({ ...receipt, operationId: 'conflicting' }, receipt)).toBe(false); });
});
