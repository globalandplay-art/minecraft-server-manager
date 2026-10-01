import type { CommandResponse, LifecycleActionResponse, Operation } from '@mcsm/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, api } from './api';

const operation: Operation = {
  id: 'op-1', serverId: 'vanilla-local', kind: 'start', state: 'queued', step: 'queued', progress: null,
  createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z', result: null, error: null,
};
const meta = { requestId: 'req-1', generatedAt: '2026-09-27T00:00:00.000Z', mode: 'local' as const };

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('P2 API 客户端写边界', () => {
  it('导出沿用 intent 和幂等写契约，下载 URL 对标识符编码', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { operation: { ...operation, kind: 'backup-export' } }, meta }, 202));
    vi.stubGlobal('fetch', fetchMock);
    await api.createBackupExport('vanilla-local', 'backup-id', '123e4567-e89b-42d3-a456-426614174000');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST', body: '{}', headers: { 'X-Manager-Intent': 'local-ui', 'Idempotency-Key': '123e4567-e89b-42d3-a456-426614174000' } });
    expect(api.backupDownloadUrl('x/y', 'a?b')).toBe('/api/v1/servers/x%2Fy/backups/a%3Fb/download');
  });
  it('生命周期请求发送 intent、JSON 与指定 UUID 幂等键', async () => {
    const payload: LifecycleActionResponse = { data: { operation }, meta };
    const fetchMock = vi.fn().mockResolvedValue(response(payload, 202));
    vi.stubGlobal('fetch', fetchMock);

    await api.lifecycle('vanilla-local', 'start', '123e4567-e89b-42d3-a456-426614174000');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/servers/vanilla-local/actions/start');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Manager-Intent': 'local-ui',
      'Idempotency-Key': '123e4567-e89b-42d3-a456-426614174000',
    });
    expect(init.body).toBe('{}');
  });

  it('普通命令发送 intent 但不伪造幂等或自动重试标记', async () => {
    const payload: CommandResponse = { data: { status: 'submitted', transport: 'stdin', output: null }, meta };
    const fetchMock = vi.fn().mockResolvedValue(response(payload));
    vi.stubGlobal('fetch', fetchMock);

    await api.command('vanilla-local', 'list');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'X-Manager-Intent': 'local-ui' });
    expect(init.headers).not.toHaveProperty('Idempotency-Key');
    expect(init.body).toBe(JSON.stringify({ command: 'list' }));
  });

  it('拒绝把不一致的命令传输状态显示成真实执行结果', async () => {
    const payload: CommandResponse = {
      data: { status: 'executed', transport: 'stdin', output: 'fake output' },
      meta,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(payload)));

    await expect(api.command('vanilla-local', 'list')).rejects.toMatchObject({
      kind: 'schema',
      code: 'SCHEMA_INVALID',
    } satisfies Partial<ApiClientError>);
  });
});
