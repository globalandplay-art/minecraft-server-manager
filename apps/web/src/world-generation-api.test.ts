import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

const operationId = '123e4567-e89b-42d3-a456-426614174000';
const worldId = `worldv2-${operationId}`;
const meta = { requestId: 'generation-client', generatedAt: '2026-11-05T00:00:00.000Z', mode: 'local' };
const target = { preparationOperationId: operationId, preparationTransactionId: operationId,
  worldId, preparedRecordDigest: 'a'.repeat(64), registeredExecutionDigest: 'b'.repeat(64) };
const finalized = { serverId: 'test', operationId, worldId, inspectionOnly: true, recoveryRequired: true };

function respond(data: unknown, status = 200) {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data, meta }), {
    status, headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('world generation client contracts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the server-issued target with an empty body and encoded instance scope', async () => {
    const fetchMock = respond(target);
    expect((await api.worldGenerationTarget('instance/a')).data).toEqual(target);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/servers/instance%2Fa/worlds/generation-target');
    expect(init).toMatchObject({ method: 'POST', body: '{}' });
    expect(new Headers(init.headers).get('X-Manager-Intent')).toBe('local-ui');
  });

  it('does not resend an uncertain generation dispatch', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('connection lost'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.generateWorld('test', target, operationId)).rejects.toMatchObject({ kind: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1];
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify(target) });
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe(operationId);
    expect(new Headers(init.headers).get('X-Manager-Intent')).toBe('local-ui');
  });

  it('preserves inspection-only and recovery-required confirmation', async () => {
    const fetchMock = respond(finalized);
    expect((await api.finalizeWorldGeneration('test', operationId)).data).toEqual(finalized);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST', body: JSON.stringify({ executionOperationId: operationId }) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['inspectionOnly', 'recoveryRequired'] as const)('rejects an unexpected ready projection: %s', async (flag) => {
    respond({ ...finalized, [flag]: false });
    await expect(api.finalizeWorldGeneration('test', operationId)).rejects.toMatchObject({ kind: 'schema', code: 'SCHEMA_INVALID' });
  });

  it('retains an explicit recovery refusal without retries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'RECOVERY_REQUIRED', message: 'inspection needed' } }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.finalizeWorldGeneration('test', operationId)).rejects.toMatchObject({ kind: 'http', code: 'RECOVERY_REQUIRED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
