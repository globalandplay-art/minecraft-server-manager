import {
  worldImportUploadResponseSchema,
  type WorldImportUploadResponse,
  worldImportUploadsResponseSchema, worldImportDiscardResponseSchema,
  type WorldImportUploadsResponse, type WorldImportDiscardResponse, type WorldImportDiscardRequest,
  worldImportPlanResponseSchema, worldImportRecoveryPlanResponseSchema,
  type WorldImportPlanResponse, type WorldImportRecoveryPlanResponse, type WorldImportRequest, type WorldImportRecoveryRequest,
  healthResponseSchema,
  overviewResponseSchema,
  lifecycleActionResponseSchema,
  operationResponseSchema,
  logsResponseSchema,
  commandResponseSchema,
  worldsResponseSchema,
  worldCreatePlanResponseSchema,
  type WorldCreatePlanRequest,
  type WorldCreatePlanResponse,
  type WorldCreateRequest,
  backupsResponseSchema,
  backupExportResponseSchema,
  type BackupExportResponse,
  type BackupCreateRequest,
  type WorldsResponse,
  type BackupsResponse,
  serverResponseSchema,
  serversResponseSchema,
  type HealthResponse,
  type OverviewResponse,
  type LifecycleActionResponse,
  type OperationResponse,
  type LogsResponse,
  type CommandResponse,
  type ServerResponse,
  type ServersResponse,
  restorePlanResponseSchema,
  restoreHistoryResponseSchema,
  type RestorePlanResponse,
  type RestoreHistoryResponse,
  type RestoreRequest,
  type RollbackRequest,
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
  return requestJson<T>(path, schema, { signal });
}

interface RequestOptions {
  signal?: AbortSignal | undefined;
  method?: 'GET' | 'POST' | undefined;
  body?: unknown | undefined;
  headers?: Record<string, string> | undefined;
  expectedStatus?: number | undefined;
  timeoutMs?: number | undefined;
}

async function requestJson<T>(path: string, schema: unknown, options: RequestOptions = {}): Promise<T> {
  const timeout = new AbortController();
  const timeoutId = window.setTimeout(() => timeout.abort(), options.timeoutMs ?? 5_000);
  const combinedSignal = options.signal
    ? AbortSignal.any([options.signal, timeout.signal])
    : timeout.signal;

  try {
    let response: Response;
    try {
      const requestInit: RequestInit = {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...options.headers,
        },
        signal: combinedSignal,
      };
      if (options.body !== undefined) requestInit.body = JSON.stringify(options.body);
      response = await fetch(`/api/v1${path}`, requestInit);
    } catch (error) {
      if (options.signal?.aborted) throw error;
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

    if (options.expectedStatus !== undefined && response.status !== options.expectedStatus) {
      throw new ApiClientError(
        `后端返回了意外的状态码（HTTP ${response.status}）。`,
        'schema',
        response.status,
        'UNEXPECTED_STATUS',
        readError(payload).requestId,
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
  worldImportPlan: (serverId: string, body: { uploadId: string; name: string }) =>
    requestJson<WorldImportPlanResponse>(`/servers/${encodeURIComponent(serverId)}/worlds/import-plan`, worldImportPlanResponseSchema,
      { method: 'POST', body, headers: { 'X-Manager-Intent': 'local-ui' }, expectedStatus: 200, timeoutMs: 120_000 }),
  importWorld: (serverId: string, body: WorldImportRequest, key: string) =>
    requestJson<LifecycleActionResponse>(`/servers/${encodeURIComponent(serverId)}/worlds/import`, lifecycleActionResponseSchema,
      { method: 'POST', body, headers: { 'X-Manager-Intent': 'local-ui', 'Idempotency-Key': key }, expectedStatus: 202, timeoutMs: 120_000 }),
  worldImportRecoveryPlan: (serverId: string, body: { operationId: string }) =>
    requestJson<WorldImportRecoveryPlanResponse>(`/servers/${encodeURIComponent(serverId)}/worlds/import-recovery-plan`, worldImportRecoveryPlanResponseSchema,
      { method: 'POST', body, headers: { 'X-Manager-Intent': 'local-ui' }, expectedStatus: 200, timeoutMs: 120_000 }),
  recoverWorldImport: (serverId: string, body: WorldImportRecoveryRequest, key: string) =>
    requestJson<LifecycleActionResponse>(`/servers/${encodeURIComponent(serverId)}/worlds/import-recovery`, lifecycleActionResponseSchema,
      { method: 'POST', body, headers: { 'X-Manager-Intent': 'local-ui', 'Idempotency-Key': key }, expectedStatus: 202, timeoutMs: 120_000 }),
  worldImportUploads: (serverId: string, signal?: AbortSignal) =>
    getJson<WorldImportUploadsResponse>(`/servers/${encodeURIComponent(serverId)}/worlds/import-uploads`, worldImportUploadsResponseSchema, signal),
  discardWorldImportUpload: (serverId: string, uploadId: string, body: WorldImportDiscardRequest) =>
    requestJson<WorldImportDiscardResponse>(`/servers/${encodeURIComponent(serverId)}/worlds/import-uploads/${encodeURIComponent(uploadId)}/discard`, worldImportDiscardResponseSchema,
      { method: 'POST', body, headers: { 'X-Manager-Intent': 'local-ui' }, expectedStatus: 200, timeoutMs: 120_000 }),
  uploadWorldZip: async (serverId: string, file: File, signal?: AbortSignal): Promise<WorldImportUploadResponse> => {
    const timeout = new AbortController();
    const timer = window.setTimeout(() => timeout.abort(), 120_000);
    try {
      let response: Response;
      try {
        response = await fetch(`/api/v1/servers/${encodeURIComponent(serverId)}/worlds/import-uploads`, {
          method: 'POST', body: file, signal: signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal,
          headers: { Accept: 'application/json', 'Content-Type': 'application/zip',
            'X-Manager-Intent': 'local-ui', 'X-Upload-Filename': encodeURIComponent(file.name) },
        });
      } catch { throw new ApiClientError('上传未确认完成，请勿自动重复上传；已接收的文件可能保留在暂存区。', 'network'); }
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new ApiClientError('上传响应格式异常。', 'schema', response.status); }
      if (!response.ok) {
        const error = readError(payload);
        throw new ApiClientError(error.message ?? '世界上传被拒绝。', 'http', response.status, error.code, error.requestId);
      }
      if (response.status !== 201 || !Value.Check(worldImportUploadResponseSchema, payload)) {
        throw new ApiClientError('上传校验结果格式异常。', 'schema', response.status);
      }
      return payload;
    } finally { window.clearTimeout(timer); }
  },
  restorePlan: (serverId: string, backupId: string, signal?: AbortSignal) =>
    getJson<RestorePlanResponse>(`/servers/${encodeURIComponent(serverId)}/backups/${encodeURIComponent(backupId)}/restore`, restorePlanResponseSchema, signal),
  rollbackPlan: (serverId: string, operationId: string, signal?: AbortSignal) =>
    getJson<RestorePlanResponse>(`/servers/${encodeURIComponent(serverId)}/operations/${encodeURIComponent(operationId)}/rollback`, restorePlanResponseSchema, signal),
  restoreHistory: (serverId: string, signal?: AbortSignal) =>
    getJson<RestoreHistoryResponse>(`/servers/${encodeURIComponent(serverId)}/restores`, restoreHistoryResponseSchema, signal),
  restore: (serverId: string, backupId: string, body: RestoreRequest, key: string) =>
    requestJson<LifecycleActionResponse>(`/servers/${encodeURIComponent(serverId)}/backups/${encodeURIComponent(backupId)}/restore`, lifecycleActionResponseSchema,
      { method: 'POST', body, headers: { 'X-Manager-Intent': 'local-ui', 'Idempotency-Key': key }, expectedStatus: 202 }),
  rollback: (serverId: string, operationId: string, body: RollbackRequest, key: string) =>
    requestJson<LifecycleActionResponse>(`/servers/${encodeURIComponent(serverId)}/operations/${encodeURIComponent(operationId)}/rollback`, lifecycleActionResponseSchema,
      { method: 'POST', body, headers: { 'X-Manager-Intent': 'local-ui', 'Idempotency-Key': key }, expectedStatus: 202 }),
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
  lifecycle: (
    serverId: string,
    action: 'start' | 'stop' | 'restart',
    idempotencyKey: string,
    signal?: AbortSignal,
  ) => requestJson<LifecycleActionResponse>(
    `/servers/${encodeURIComponent(serverId)}/actions/${action}`,
    lifecycleActionResponseSchema,
    {
      method: 'POST',
      body: {},
      headers: {
        'X-Manager-Intent': 'local-ui',
        'Idempotency-Key': idempotencyKey,
      },
      expectedStatus: 202,
      signal,
    },
  ),
  operation: (operationId: string, signal?: AbortSignal) =>
    getJson<OperationResponse>(`/operations/${encodeURIComponent(operationId)}`, operationResponseSchema, signal),
  logs: (serverId: string, after?: string, signal?: AbortSignal) => {
    const query = new URLSearchParams({ limit: '200' });
    if (after) query.set('after', after);
    return getJson<LogsResponse>(`/servers/${encodeURIComponent(serverId)}/logs?${query}`, logsResponseSchema, signal);
  },
  command: (serverId: string, command: string, signal?: AbortSignal) =>
    requestJson<CommandResponse>(
      `/servers/${encodeURIComponent(serverId)}/commands`,
      commandResponseSchema,
      {
        method: 'POST',
        body: { command },
        headers: { 'X-Manager-Intent': 'local-ui' },
        expectedStatus: 200,
        signal,
      },
    ).then((response) => {
      const { status, transport, output } = response.data;
      const isRconResult = status === 'executed' && transport === 'rcon';
      const isStdinSubmission = status === 'submitted' && transport === 'stdin' && output === null;
      if (!isRconResult && !isStdinSubmission) {
        throw new ApiClientError(
          '后端返回了不一致的命令执行状态。',
          'schema',
          200,
          'SCHEMA_INVALID',
          response.meta.requestId,
        );
      }
      return response;
    }),
  worlds: (serverId: string, signal?: AbortSignal) =>
    getJson<WorldsResponse>(`/servers/${encodeURIComponent(serverId)}/worlds`, worldsResponseSchema, signal),
  worldCreatePlan: (serverId: string, body: WorldCreatePlanRequest) =>
    requestJson<WorldCreatePlanResponse>(`/servers/${encodeURIComponent(serverId)}/worlds/create-plan`, worldCreatePlanResponseSchema, {
      method: 'POST', body, headers: { 'X-Manager-Intent': 'local-ui' }, expectedStatus: 200,
    }),
  createWorld: (serverId: string, body: WorldCreateRequest, key: string) =>
    requestJson<LifecycleActionResponse>(`/servers/${encodeURIComponent(serverId)}/worlds`, lifecycleActionResponseSchema, {
      method: 'POST', body, headers: { 'X-Manager-Intent': 'local-ui', 'Idempotency-Key': key }, expectedStatus: 202,
    }),
  backups: (serverId: string, signal?: AbortSignal) =>
    getJson<BackupsResponse>(`/servers/${encodeURIComponent(serverId)}/backups`, backupsResponseSchema, signal),
  createBackup: (serverId: string, body: BackupCreateRequest, idempotencyKey: string, signal?: AbortSignal) =>
    requestJson<LifecycleActionResponse>(`/servers/${encodeURIComponent(serverId)}/backups`, lifecycleActionResponseSchema, {
      method: 'POST', body,
      headers: { 'X-Manager-Intent': 'local-ui', 'Idempotency-Key': idempotencyKey },
      expectedStatus: 202, signal,
    }),
  createBackupExport: (serverId: string, backupId: string, idempotencyKey: string) =>
    requestJson<LifecycleActionResponse>(`/servers/${encodeURIComponent(serverId)}/backups/${encodeURIComponent(backupId)}/exports`, lifecycleActionResponseSchema, {
      method: 'POST', body: {}, headers: { 'X-Manager-Intent': 'local-ui', 'Idempotency-Key': idempotencyKey }, expectedStatus: 202,
    }),
  backupExport: (serverId: string, backupId: string, signal?: AbortSignal) =>
    getJson<BackupExportResponse>(`/servers/${encodeURIComponent(serverId)}/backups/${encodeURIComponent(backupId)}/exports`, backupExportResponseSchema, signal),
  backupDownloadUrl: (serverId: string, backupId: string) =>
    `/api/v1/servers/${encodeURIComponent(serverId)}/backups/${encodeURIComponent(backupId)}/download`,
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
