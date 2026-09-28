import type { HealthResponse, Operation, OverviewResponse } from '@mcsm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, LoaderCircle, Play, RotateCw, Square, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiClientError, api, errorMessage, shouldRetry } from '../api';
import { readableReadinessReason } from '../readiness';

type Summary = OverviewResponse['data']['summary'];
type FeatureState = HealthResponse['data']['features']['lifecycle'];
type LifecycleAction = 'start' | 'stop' | 'restart';

const actionLabels: Record<LifecycleAction, string> = {
  start: '启动',
  stop: '停止',
  restart: '重启',
};

function isActive(operation?: Operation | null) {
  return operation?.state === 'queued' || operation?.state === 'running';
}

function ConfirmActionDialog({
  action,
  close,
  confirm,
  pending,
}: {
  action: 'stop' | 'restart';
  close: () => void;
  confirm: () => void;
  pending: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(close);
  const pendingRef = useRef(pending);

  useEffect(() => { closeRef.current = close; }, [close]);
  useEffect(() => { pendingRef.current = pending; }, [pending]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pendingRef.current) closeRef.current();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
      if (!items.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !pending) close();
    }}>
      <div ref={dialogRef} className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="lifecycle-dialog-title" tabIndex={-1}>
        <span className="confirm-dialog__icon"><AlertTriangle size={22} /></span>
        <h2 id="lifecycle-dialog-title">确认{actionLabels[action]}服务器</h2>
        <p>
          {action === 'restart'
            ? '重启会先保存世界、停止服务器并断开在线玩家，再重新启动。启动完成前服务不可用。'
            : '停止会保存世界并断开在线玩家。请等待 Operation 明确完成后再关闭管理器。'}
        </p>
        <div className="confirm-dialog__actions">
          <button ref={cancelRef} className="button button--secondary" onClick={close} disabled={pending}>取消</button>
          <button className="button button--primary" onClick={confirm} disabled={pending}>
            {pending ? <LoaderCircle className="spin" size={16} /> : null}确认{actionLabels[action]}
          </button>
        </div>
      </div>
    </div>
  );
}

function OperationPanel({ operation, queryError, retry }: { operation: Operation; queryError: Error | null; retry: () => void }) {
  const active = isActive(operation);
  const succeeded = operation.state === 'succeeded';
  const failed = operation.state === 'failed' || operation.state === 'interrupted';
  return (
    <div className={`operation-panel operation-panel--${operation.state}`} aria-live="polite">
      <div className="operation-panel__status">
        {active ? <LoaderCircle className="spin" size={18} /> : succeeded ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
        <div>
          <strong>{succeeded ? '操作已完成' : failed ? '操作未完成' : queryError ? '操作进度未知' : '操作进行中'}</strong>
          <span>{actionLabels[operation.kind as LifecycleAction] ?? operation.kind} · {operation.step}</span>
        </div>
      </div>
      {operation.progress !== null ? (
        <div className="operation-progress" aria-label={`实际进度 ${operation.progress}%`}>
          <span style={{ width: `${operation.progress}%` }} />
        </div>
      ) : null}
      {operation.error ? <p className="operation-error">{operation.error.message}（{operation.error.code}）</p> : null}
      {queryError ? (
        <div className="operation-query-error">
          <span>{errorMessage(queryError)} 当前结果未知，重试只会查询进度，不会再次执行操作。</span>
          <button className="button button--secondary" onClick={retry}>重查进度</button>
        </div>
      ) : null}
    </div>
  );
}

export function LifecycleControls({
  summary,
  mode,
  feature,
  stale = false,
}: {
  summary: Summary;
  mode: 'mock' | 'local';
  feature?: FeatureState | undefined;
  stale?: boolean | undefined;
}) {
  const queryClient = useQueryClient();
  const [operation, setOperation] = useState<Operation | null>(null);
  const [confirmAction, setConfirmAction] = useState<'stop' | 'restart' | null>(null);
  const trackedId = operation?.id ?? summary.status.activeOperationId;
  const operationQuery = useQuery({
    queryKey: ['operation', trackedId],
    queryFn: ({ signal }) => api.operation(trackedId!, signal),
    enabled: Boolean(trackedId),
    retry: shouldRetry,
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 2_000),
    refetchInterval: (query) => isActive(query.state.data?.data) ? 1_000 : false,
  });
  const currentOperation = operationQuery.data?.data ?? operation;

  const mutation = useMutation({
    mutationFn: ({ action, idempotencyKey }: { action: LifecycleAction; idempotencyKey: string }) =>
      api.lifecycle(summary.server.id, action, idempotencyKey),
    retry: false,
    onSuccess: (response) => {
      setOperation(response.data.operation);
      setConfirmAction(null);
    },
  });

  useEffect(() => {
    setOperation(null);
    setConfirmAction(null);
    mutation.reset();
  }, [summary.server.id]);

  useEffect(() => {
    if (stale) setConfirmAction(null);
  }, [stale]);

  useEffect(() => {
    const latest = operationQuery.data?.data;
    if (!latest) return;
    setOperation(latest);
    if (!isActive(latest)) {
      void queryClient.invalidateQueries({ queryKey: ['overview', summary.server.id] });
      void queryClient.invalidateQueries({ queryKey: ['servers'] });
    }
  }, [operationQuery.data, queryClient, summary.server.id]);

  const submit = (action: LifecycleAction) => {
    if (stale) return;
    mutation.reset();
    mutation.mutate({ action, idempotencyKey: crypto.randomUUID() });
  };
  const uncertainSubmission = mutation.error instanceof ApiClientError
    && (
      mutation.error.kind === 'network'
      || (mutation.error.status ?? 0) >= 500
      || (mutation.error.kind === 'schema' && (mutation.error.status ?? 0) >= 200 && (mutation.error.status ?? 0) < 300)
    );
  const busy = isActive(currentOperation)
    || Boolean(summary.status.activeOperationId && !currentOperation)
    || mutation.isPending
    || uncertainSubmission;

  const available = mode === 'local' && feature?.implemented === true;
  const readiness = summary.readiness;
  const actions = [
    { id: 'start' as const, icon: Play, ready: readiness.start },
    { id: 'stop' as const, icon: Square, ready: readiness.stop },
    { id: 'restart' as const, icon: RotateCw, ready: readiness.restart },
  ];

  return (
    <div className="server-actions" aria-label="服务器生命周期操作">
      <div>
        {actions.map(({ id, icon: Icon, ready }) => (
          <button
            key={id}
            className={`button ${id === 'start' ? 'button--primary' : 'button--secondary'}`}
            disabled={!available || stale || !ready.allowed || busy || mutation.isPending}
            onClick={() => id === 'start' ? submit(id) : setConfirmAction(id)}
            aria-describedby={stale ? 'lifecycle-stale-reason' : available && !ready.allowed ? `lifecycle-${id}-reason` : undefined}
          >
            <Icon size={15} />{actionLabels[id]}
          </button>
        ))}
      </div>
      <div className="lifecycle-reasons">
        {stale ? (
          <p id="lifecycle-stale-reason">当前 Dashboard 快照已过期。请先刷新并取得最新状态，再执行生命周期操作。</p>
        ) : !available ? (
          <p>{mode === 'mock' ? 'Phase 2 接入本地服务器后启用' : `Lifecycle 将在 Phase ${feature?.phase ?? 2} 启用。`}</p>
        ) : actions.map(({ id, ready }) => (
          !ready.allowed ? <p id={`lifecycle-${id}-reason`} key={id}><strong>{actionLabels[id]}：</strong>{readableReadinessReason(ready.reason)}</p> : null
        ))}
        {available && actions.every(({ ready }) => ready.allowed) && !busy ? <p>停止或重启会保存世界并断开在线玩家；Operation 完成前不会宣告成功。</p> : null}
      </div>
      {mutation.isError ? (
        <div className="lifecycle-error" role="alert">
          <strong>{uncertainSubmission ? '操作提交结果未知' : '操作被后端拒绝'}</strong>
          <span>{errorMessage(mutation.error)} {uncertainSubmission ? '请求可能已被接受；不会自动重试。可使用相同幂等键安全确认。' : '请按后端原因修正当前状态。'}</span>
          {uncertainSubmission && mutation.variables ? (
            <button className="button button--secondary" disabled={stale} onClick={() => mutation.mutate(mutation.variables!)}>使用相同幂等键确认</button>
          ) : null}
        </div>
      ) : null}
      {currentOperation ? (
        <OperationPanel
          operation={currentOperation}
          queryError={operationQuery.error}
          retry={() => void operationQuery.refetch()}
        />
      ) : null}
      {trackedId && !currentOperation ? (
        <div className="operation-panel" aria-live="polite">
          <div className="operation-panel__status"><LoaderCircle className={operationQuery.isFetching ? 'spin' : ''} size={18} /><div><strong>{operationQuery.isError ? '活动操作进度未知' : '正在读取活动操作'}</strong><span>{trackedId}</span></div></div>
          {operationQuery.isError ? <div className="operation-query-error"><span>{errorMessage(operationQuery.error)} 只会重查进度，不会重复操作。</span><button className="button button--secondary" onClick={() => void operationQuery.refetch()}>重查进度</button></div> : null}
        </div>
      ) : null}
      {confirmAction ? (
        <ConfirmActionDialog
          action={confirmAction}
          close={() => setConfirmAction(null)}
          confirm={() => submit(confirmAction)}
          pending={mutation.isPending}
        />
      ) : null}
    </div>
  );
}
