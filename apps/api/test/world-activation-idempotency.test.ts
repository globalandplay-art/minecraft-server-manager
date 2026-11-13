import { createHash, randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { OperationService } from '../src/services/operation-service.js';
import { MemoryOperationStore, type StoredOperation } from '../src/services/operation-store.js';

const serverId = 'server-a', key = randomUUID(), body = '{"approved":"original"}';
const now = new Date('2026-10-26T00:00:00.000Z');
const clock = { now: () => now };
function record(state: StoredOperation['operation']['state']): StoredOperation {
  return { operation: { id: randomUUID(), serverId, kind: 'world-activate', state, step: 'test', progress: null,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', result: null,
    error: state === 'interrupted' ? { code: 'RECOVERY_REQUIRED', message: 'Inspection required' } : null },
  idempotencyKey: key, requestFingerprint: createHash('sha256').update(`${serverId}\nworld-activate\n${body}`).digest('hex'),
  expiresAt: '2026-10-02T00:00:00.000Z' };
}
it.each(['queued', 'failed', 'interrupted', 'succeeded'] as const)('retains an expired %s activation key after service reload without new preflight or execution', async state => {
  const store = new MemoryOperationStore(), saved = record(state); await store.save(saved);
  for (let reload = 0; reload < 2; reload++) {
    const service = new OperationService(store, clock); await service.initialize();
    const before = await store.list(), execute = vi.fn(async () => {}), preflight = vi.fn(async () => {});
    const replay = await service.requestBackup(serverId, key, body, execute, preflight, 'world-activate');
    expect(replay.id).toBe(saved.operation.id); expect(execute).not.toHaveBeenCalled(); expect(preflight).not.toHaveBeenCalled();
    await expect(service.requestBackup(serverId, key, '{"approved":"different"}', execute, preflight, 'world-activate'))
      .rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    expect(await store.list()).toEqual(before);
  }
});
it('retains a live service key beyond expiry while other operation kinds keep the existing window', async () => {
  let timestamp = new Date('2026-10-01T00:00:00.000Z');
  const store = new MemoryOperationStore(), service = new OperationService(store, { now: () => timestamp }); await service.initialize();
  const execute = vi.fn(async () => {}), preflight = vi.fn(async () => {});
  const first = await service.requestBackup(serverId, key, body, execute, preflight, 'world-activate');
  await vi.waitFor(() => expect(service.get(first.id)?.state).toBe('succeeded'));
  timestamp = new Date('2026-11-01T00:00:00.000Z');
  expect((await service.requestBackup(serverId, key, body, execute, preflight, 'world-activate')).id).toBe(first.id);
  expect(execute).toHaveBeenCalledTimes(1); expect(preflight).toHaveBeenCalledTimes(1);
  const backup1 = await service.requestBackup(serverId, key, body, async () => {});
  await vi.waitFor(() => expect(service.get(backup1.id)?.state).toBe('succeeded'));
  timestamp = new Date('2026-12-01T00:00:00.000Z');
  const backup2 = await service.requestBackup(serverId, key, body, async () => {});
  expect(backup2.id).not.toBe(backup1.id);
  await vi.waitFor(() => expect(service.get(backup2.id)?.state).toBe('succeeded'));
});
it('rejects ambiguous historical activation keys instead of selecting an arbitrary old operation', async () => {
  const store = new MemoryOperationStore(); await store.save(record('failed')); await store.save(record('failed'));
  const before = await store.list();
  await expect(new OperationService(store, clock).initialize()).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
  expect(await store.list()).toEqual(before);
});
