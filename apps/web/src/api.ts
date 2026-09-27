import {
  healthResponseSchema,
  overviewResponseSchema,
  serverResponseSchema,
  serversResponseSchema,
  type HealthResponse,
  type OverviewResponse,
  type ServerResponse,
  type ServersResponse,
} from '@mcsm/contracts';
import { Value } from '@sinclair/typebox/value';

export type ApiFailureKind = 'network' | 'http' | 'schema';

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly kind: ApiFailureKind,
    readonly status?: number,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

function readError(value: unknown) {
  if (!value || typeof value !== 'object') return {};
  const payload = value as {
    error?: { code?: unknown; message?: unknown };
    meta?: { requestId?: unknown };
  };
  return {
    code: typeof payload.error?.code === 'string' ? payload.error.code : undefined,
    message: typeof payload.error?.message === 'string' ? payload.error.message : undefined,
    requestId:
      typeof payload.meta?.requestId === 'string' ? payload.meta.requestId : undefined,
  };
}

async function getJson<T>(path: string, schema: unknown, signal?: AbortSignal): Promise<T> {
  const timeout = new AbortController();
  const timeoutId = window.setTimeout(() => timeout.abort(), 5_000);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeout.signal])
    : timeout.signal;

  try {
    let response: Response;
    try {
      response = await fetch(`/api/v1${path}`, {
        headers: { Accept: 'application/json' },
        signal: combinedSignal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ApiClientError(
        error instanceof DOMException && error.name === 'AbortError'
          ? '请求超时，管理器 API 暂时没有响应。'
          : '无法连接管理器 API。',
        'network',
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiClientError('后端返回了无法读取的响应。', 'schema', response.status);
    }

    if (!response.ok) {
      const apiError = readError(payload);
      throw new ApiClientError(
        apiError.message ?? `请求失败（HTTP ${response.status}）。`,
        'http',
        response.status,
        apiError.code,
        apiError.requestId,
      );
    }

    if (!Value.Check(schema as Parameters<typeof Value.Check>[0], payload)) {
      const requestId = readError(payload).requestId;
      throw new ApiClientError(
        '后端响应格式异常。',
        'schema',
        response.status,
        'SCHEMA_INVALID',
        requestId,
      );
    }

    return payload as T;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export const api = {
  health: (signal?: AbortSignal) =>
    getJson<HealthResponse>('/health', healthResponseSchema, signal),
  servers: (signal?: AbortSignal) =>
    getJson<ServersResponse>('/servers', serversResponseSchema, signal),
  server: (serverId: string, signal?: AbortSignal) =>
    getJson<ServerResponse>(`/servers/${encodeURIComponent(serverId)}`, serverResponseSchema, signal),
  overview: (serverId: string, signal?: AbortSignal) =>
    getJson<OverviewResponse>(
      `/servers/${encodeURIComponent(serverId)}/overview`,
      overviewResponseSchema,
      signal,
    ),
};

export function shouldRetry(failureCount: number, error: Error) {
  if (failureCount >= 2) return false;
  if (error instanceof ApiClientError && error.kind === 'http' && error.status && error.status < 500) {
    return false;
  }
  return true;
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiClientError) return error.message;
  return '发生未知错误，请稍后重试。';
}
