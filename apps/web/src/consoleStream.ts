import { wsMessageSchema, type LogEntry, type Operation, type ServerStatus, type WsMessage } from '@mcsm/contracts';
import { Value } from '@sinclair/typebox/value';
import { useEffect, useReducer, useRef, useState } from 'react';

export type ConsoleConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface ConsoleStreamState {
  streamId: string | null;
  lastSequence: number;
  logs: LogEntry[];
  status: ServerStatus | null;
  operation: Operation | null;
  gap: string | null;
}

export const emptyConsoleStream: ConsoleStreamState = {
  streamId: null,
  lastSequence: 0,
  logs: [],
  status: null,
  operation: null,
  gap: null,
};

function boundedLogs(logs: LogEntry[]) {
  return logs.length > 2_000 ? logs.slice(logs.length - 2_000) : logs;
}

export function applyWsMessage(state: ConsoleStreamState, message: WsMessage): ConsoleStreamState {
  if (message.type === 'hello') {
    if (state.streamId && state.streamId !== message.streamId) {
      return {
        ...emptyConsoleStream,
        streamId: message.streamId,
        gap: '日志流已更换，将以服务端最新快照为准。',
      };
    }
    return { ...state, streamId: message.streamId };
  }

  if (!state.streamId) return state;

  if (message.type === 'snapshot') {
    if (message.sequence < state.lastSequence) return state;
    return {
      ...state,
      lastSequence: message.sequence,
      logs: boundedLogs(message.logs),
      status: message.status,
      gap: state.gap,
    };
  }

  if (message.type === 'gap') {
    return {
      ...state,
      lastSequence: Math.max(state.lastSequence, message.sequence),
      gap: message.reason,
    };
  }

  if (message.sequence <= state.lastSequence) return state;

  if (message.type === 'log') {
    return {
      ...state,
      lastSequence: message.sequence,
      logs: boundedLogs([...state.logs, message.entry]),
    };
  }
  if (message.type === 'status') {
    return { ...state, lastSequence: message.sequence, status: message.status };
  }
  if (message.type === 'operation') {
    return { ...state, lastSequence: message.sequence, operation: message.operation };
  }
  return state;
}

function streamReducer(state: ConsoleStreamState, action: WsMessage | { type: 'reset-client' } | { type: 'dismiss-gap' }) {
  if (action.type === 'reset-client') return emptyConsoleStream;
  if (action.type === 'dismiss-gap') return { ...state, gap: null };
  return applyWsMessage(state, action);
}

export function parseWsMessage(value: unknown): WsMessage | null {
  return Value.Check(wsMessageSchema as unknown as Parameters<typeof Value.Check>[0], value)
    ? value as WsMessage
    : null;
}

export function useConsoleStream(serverId: string | undefined, enabled: boolean) {
  const [stream, dispatch] = useReducer(streamReducer, emptyConsoleStream);
  const [connection, setConnection] = useState<ConsoleConnectionState>('idle');
  const [retryInMs, setRetryInMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef(stream);

  useEffect(() => { streamRef.current = stream; }, [stream]);

  useEffect(() => {
    streamRef.current = emptyConsoleStream;
    dispatch({ type: 'reset-client' });
    setError(null);
    setRetryInMs(null);
    if (!serverId || !enabled) {
      setConnection('idle');
      return;
    }

    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;
    const delays = [1_000, 2_000, 4_000, 8_000, 15_000];

    const connect = () => {
      if (stopped) return;
      setConnection(attempt === 0 ? 'connecting' : 'reconnecting');
      setRetryInMs(null);
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = new URL(`${protocol}//${window.location.host}/ws/v1/servers/${encodeURIComponent(serverId)}/events`);
      const current = streamRef.current;
      if (current.streamId) {
        url.searchParams.set('streamId', current.streamId);
        url.searchParams.set('afterSequence', String(current.lastSequence));
      }
      socket = new WebSocket(url);

      socket.addEventListener('message', (event) => {
        if (stopped) return;
        let raw: unknown;
        try {
          raw = JSON.parse(String(event.data));
        } catch {
          setError('日志连接收到无法解析的消息。');
          setConnection('error');
          socket?.close(1002, 'invalid-json');
          return;
        }
        const message = parseWsMessage(raw);
        if (!message) {
          setError('日志连接收到不符合共享合约的消息。');
          setConnection('error');
          socket?.close(1002, 'invalid-schema');
          return;
        }
        dispatch(message);
        if (message.type === 'hello') {
          attempt = 0;
          setError(null);
          setConnection('connected');
        }
      });

      socket.addEventListener('close', () => {
        if (stopped) return;
        setError((current) => current ?? 'Console WebSocket 已断开。');
        const baseDelay = delays[Math.min(attempt, delays.length - 1)]!;
        attempt += 1;
        const delay = Math.round(baseDelay * (0.85 + Math.random() * 0.3));
        setConnection('reconnecting');
        setRetryInMs(delay);
        reconnectTimer = window.setTimeout(connect, delay);
      });

      socket.addEventListener('error', () => {
        if (!stopped) setError('Console WebSocket 连接中断。');
      });
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close(1000, 'instance-changed');
    };
  }, [enabled, serverId]);

  return { stream, connection, retryInMs, error, dismissGap: () => dispatch({ type: 'dismiss-gap' }) };
}
