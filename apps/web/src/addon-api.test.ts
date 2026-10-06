import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

const meta = { requestId: 'p54-test', generatedAt: '2026-10-06T00:00:00.000Z', mode: 'local' as const };

describe('P5.4 addon upload API contract', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts a valid upload receipt containing its UUID staging identifier', async () => {
    const payload = { data: { id: 'e5cbbfa0-836a-4f57-a8b8-1a6772947c01', kind: 'plugin', filename: 'validated.jar', sizeBytes: 512,
      checksumSha256: 'd'.repeat(64), revision: 'a'.repeat(64), name: 'Validated', version: '1.0', loader: 'paper',
      minecraftConstraint: ['26.2'], state: 'validated', executionAvailable: false }, meta };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.uploadAddon('paper-local', new File(['jar'], 'validated.jar', { type: 'application/java-archive' }));

    expect(result.data.id).toBe(payload.data.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
