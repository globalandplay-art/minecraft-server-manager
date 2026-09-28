import type { CommandResponse, HealthResponse, ServersResponse } from '@mcsm/contracts';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, ArrowDown, Radio, Search, Send, TerminalSquare } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../api';
import { EmptyState, PageHeading, StatusBadge } from '../components/Ui';
import { formatLocalTime } from '../format';
import { useConsoleStream } from '../consoleStream';
import { readableReadinessReason } from '../readiness';

type ServerSummary = ServersResponse['data']['items'][number];
type FeatureState = HealthResponse['data']['features']['console'];
type LogLevel = 'all' | 'debug' | 'info' | 'warn' | 'error' | 'unknown';

const connectionLabels = {
  idle: '未连接',
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '正在重连',
  error: '消息异常',
} as const;

export function validateCommand(command: string) {
  if (!command.trim()) return '请输入 Minecraft 命令。';
  if (/[\u0000-\u001f\u007f]/u.test(command)) return '命令不能包含换行、NUL、Tab 或其他控制字符。';
  if (new TextEncoder().encode(command).byteLength > 1_024) return '命令不能超过 1024 UTF-8 字节。';
  return null;
}

function CommandResult({ response }: { response: CommandResponse }) {
  const { status, transport, output } = response.data;
  if (transport === 'stdin' || status === 'submitted') {
    return (
      <div className="command-result command-result--submitted" role="status">
        <strong>命令已发送至 stdin</strong>
        <span>后端仅确认提交，未提供命令执行输出。</span>
      </div>
    );
  }
  return (
    <div className="command-result command-result--executed" role="status">
      <strong>RCON 已执行</strong>
      {output === null ? <span>命令没有返回文本。</span> : <pre>{output}</pre>}
    </div>
  );
}

export function ConsolePage({
  server,
  feature,
  stale = false,
}: {
  server: ServerSummary;
  feature?: FeatureState | undefined;
  stale?: boolean | undefined;
}) {
  const enabled = feature?.implemented === true && server.capabilities.console;
  const { stream, connection, retryInMs, error: streamError, dismissGap } = useConsoleStream(server.server.id, enabled);
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<LogLevel>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [newLogCount, setNewLogCount] = useState(0);
  const [command, setCommand] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousLastLogKey = useRef<string | null>(null);

  const commandMutation = useMutation({
    mutationFn: (value: string) => api.command(server.server.id, value),
    retry: false,
    onSuccess: () => {
      setCommand('');
      setValidationError(null);
    },
  });

  useEffect(() => {
    setSearch('');
    setLevel('all');
    setAutoScroll(true);
    setNewLogCount(0);
    setCommand('');
    setValidationError(null);
    previousLastLogKey.current = null;
    commandMutation.reset();
  }, [server.server.id]);

  useEffect(() => {
    const lastEntry = stream.logs.at(-1);
    const nextLastKey = lastEntry ? `${lastEntry.id}:${lastEntry.cursor}` : null;
    const previousLastKey = previousLastLogKey.current;
    let delta = 0;
    if (nextLastKey && nextLastKey !== previousLastKey) {
      const previousIndex = previousLastKey
        ? stream.logs.findIndex((entry) => `${entry.id}:${entry.cursor}` === previousLastKey)
        : -1;
      delta = previousIndex >= 0 ? stream.logs.length - previousIndex - 1 : stream.logs.length;
    }
    previousLastLogKey.current = nextLastKey;
    if (autoScroll) {
      const viewport = viewportRef.current;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
      setNewLogCount(0);
    } else if (delta) {
      setNewLogCount((count) => count + delta);
    }
  }, [autoScroll, stream.logs]);

  const filteredLogs = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return stream.logs.filter((entry) => {
      if (level !== 'all' && entry.level !== level) return false;
      return !term || entry.text.toLocaleLowerCase().includes(term);
    });
  }, [level, search, stream.logs]);

  if (!feature?.implemented) {
    return <EmptyState title="Console 尚未启用" description={`后端声明 Console 将在 Phase ${feature?.phase ?? 2} 启用。当前不会建立日志连接或提供命令输入。`} />;
  }
  if (!server.capabilities.console) {
    return <EmptyState title="此实例不支持 Console" description="后端能力声明无法安全读取该实例日志，因此不会尝试猜测日志路径。" />;
  }

  const sendCommand = () => {
    const issue = validateCommand(command);
    setValidationError(issue);
    if (issue) return;
    commandMutation.reset();
    commandMutation.mutate(command);
  };
  const commandDisabled = stale || !server.readiness.commands.allowed || commandMutation.isPending;

  return (
    <div className="page-stack console-page">
      <PageHeading
        eyebrow="LIVE STREAM"
        title="Console"
        description={`${server.server.name} · 最多保留最近 2,000 行脱敏纯文本日志`}
        aside={<span className={`console-connection console-connection--${connection}`}><Radio size={14} />{connectionLabels[connection]}</span>}
      />
      {streamError ? <div className="connection-banner" role="alert"><AlertTriangle size={18} /><div><strong>Console 连接异常</strong><span>{streamError}{retryInMs ? ` 将在约 ${(retryInMs / 1_000).toFixed(1)} 秒后重连。` : ''}</span></div></div> : null}
      {stream.gap ? <div className="stale-banner" role="status"><AlertTriangle size={17} /><span>部分日志无法补发：{stream.gap} 已加载最新快照。</span><button className="button button--secondary" onClick={dismissGap}>知道了</button></div> : null}
      <section className="console-panel">
        <div className="console-toolbar">
          <label className="console-search"><Search size={16} /><span className="sr-only">搜索日志</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索日志" /></label>
          <label className="console-filter"><span>级别</span><select value={level} onChange={(event) => setLevel(event.target.value as LogLevel)}><option value="all">全部</option><option value="debug">Debug</option><option value="info">Info</option><option value="warn">Warn</option><option value="error">Error</option><option value="unknown">Unknown</option></select></label>
          <label className="auto-scroll"><input type="checkbox" checked={autoScroll} onChange={(event) => { setAutoScroll(event.target.checked); if (event.target.checked) setNewLogCount(0); }} />自动滚动</label>
          {stream.status ? <StatusBadge status={stream.status.state} /> : null}
        </div>
        <div
          ref={viewportRef}
          className="console-viewport"
          tabIndex={0}
          aria-label="Minecraft 日志"
          onScroll={(event) => {
            const target = event.currentTarget;
            const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 24;
            if (atBottom) {
              setAutoScroll(true);
              setNewLogCount(0);
            } else if (autoScroll) setAutoScroll(false);
          }}
        >
          {filteredLogs.length === 0 ? (
            <div className="console-empty"><TerminalSquare size={23} /><span>{stream.logs.length ? '没有符合筛选条件的日志。' : connection === 'connected' ? '当前日志快照为空。' : '正在等待日志快照…'}</span></div>
          ) : filteredLogs.map((entry) => (
            <div className={`log-line log-line--${entry.level}`} key={`${entry.id}:${entry.cursor}`}>
              <time dateTime={entry.timestamp ?? undefined}>{entry.timestamp ? formatLocalTime(entry.timestamp) : '--:--:--'}</time>
              <span className="log-level">{entry.level.toUpperCase()}</span>
              <span className="log-text">{entry.text}</span>
            </div>
          ))}
        </div>
        {!autoScroll && newLogCount > 0 ? <button className="new-logs-button" onClick={() => { setAutoScroll(true); setNewLogCount(0); const viewport = viewportRef.current; if (viewport) viewport.scrollTop = viewport.scrollHeight; }}><ArrowDown size={15} />新日志 {newLogCount} 条 · 返回底部</button> : null}
      </section>
      {stream.operation ? (
        <div className={`console-operation console-operation--${stream.operation.state}`}>
          <strong>Operation：{stream.operation.kind}</strong><span>{stream.operation.step} · {stream.operation.state}</span>
        </div>
      ) : null}
      <section className="command-panel">
        <div className="command-panel__heading"><div><h2>发送 Minecraft 命令</h2><p>通道：{server.readiness.commandTransport === 'unavailable' ? '不可用' : server.readiness.commandTransport.toUpperCase()}。命令通过 REST 发送，不经过 WebSocket。</p></div></div>
        <form onSubmit={(event) => { event.preventDefault(); sendCommand(); }}>
          <label><span className="sr-only">Minecraft 命令</span><input value={command} onChange={(event) => { setCommand(event.target.value); setValidationError(null); }} placeholder="例如：list" disabled={commandDisabled} aria-describedby="command-help" /></label>
          <button className="button button--primary" type="submit" disabled={commandDisabled || !command.trim()}><Send size={16} />{commandMutation.isPending ? '发送中' : '发送'}</button>
        </form>
        <p id="command-help" className="command-help">单行命令，最多 1024 UTF-8 字节；禁止控制字符。不会自动重试。</p>
        {stale ? <p className="command-disabled-reason">命令不可用：实例状态已超过 15 秒未刷新，请先恢复 API 连接并取得最新状态。</p> : !server.readiness.commands.allowed ? <p className="command-disabled-reason">命令不可用：{readableReadinessReason(server.readiness.commands.reason)}</p> : null}
        {validationError ? <p className="field-error" role="alert">{validationError}</p> : null}
        {commandMutation.isError ? <p className="field-error" role="alert">发送失败：{errorMessage(commandMutation.error)} 未自动重试。</p> : null}
        {commandMutation.data ? <CommandResult response={commandMutation.data} /> : null}
      </section>
    </div>
  );
}
