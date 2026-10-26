import { useTranslation } from 'react-i18next';
import { i18n, number } from '../i18n';
import { consoleNotice } from '../i18n/console-notice';
import { renderMessage, type UiMessage } from '../i18n/message';
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

const connectionLabels = { idle: 'console.idle', connecting: 'console.connecting', connected: 'console.connected', reconnecting: 'console.reconnecting', error: 'console.error' } as const;

function commandValidationKey(command: string) {
  if (!command.trim()) return 'console.emptyCommand' as const;
  if (/[\u0000-\u001f\u007f]/u.test(command)) return 'console.controlCharacters' as const;
  if (new TextEncoder().encode(command).byteLength > 1_024) return 'console.commandTooLong' as const;
  return null;
}
export function validateCommand(command: string) {
  const key = commandValidationKey(command);
  return key ? i18n.t(key) : null;
}

function CommandResult({ response }: { response: CommandResponse }) {
  const { status, transport, output } = response.data;
  if (transport === 'stdin' || status === 'submitted') {
    return (
      <div className="command-result command-result--submitted" role="status">
        <strong>{i18n.t('console.stdinSubmitted')}</strong>
        <span>{i18n.t('console.stdinExplanation')}</span>
      </div>
    );
  }
  return (
    <div className="command-result command-result--executed" role="status">
      <strong>{i18n.t('console.rconExecuted')}</strong>
      {output === null ? <span>{i18n.t('console.noOutput')}</span> : <pre>{output}</pre>}
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
  useTranslation();
  const enabled = feature?.implemented === true && server.capabilities.console;
  const { stream, connection, retryInMs, error: streamError, dismissGap } = useConsoleStream(server.server.id, enabled);
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<LogLevel>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [newLogCount, setNewLogCount] = useState(0);
  const [command, setCommand] = useState('');
  const [validationError, setValidationError] = useState<UiMessage | null>(null);
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
    return <EmptyState title={i18n.t('console.notEnabled')} description={i18n.t('console.phase', { phase: feature?.phase ?? 2 })} />;
  }
  if (!server.capabilities.console) {
    return <EmptyState title={i18n.t('console.unsupported')} description={i18n.t('console.unsupportedDescription')} />;
  }

  const sendCommand = () => {
    const issue = commandValidationKey(command);
    setValidationError(issue ? { key: issue } : null);
    if (issue) return;
    commandMutation.reset();
    commandMutation.mutate(command);
  };
  const commandDisabled = stale || !server.readiness.commands.allowed || commandMutation.isPending;

  return (
    <div className="page-stack console-page">
      <PageHeading
        eyebrow={i18n.t('console.live')}
        title={i18n.t('nav.console')}
        description={i18n.t('console.description', { name: server.server.name })}
        aside={<span className={`console-connection console-connection--${connection}`}><Radio size={14} />{i18n.t(connectionLabels[connection])}</span>}
      />
      {streamError ? <div className="connection-banner" role="alert"><AlertTriangle size={18} /><div><strong>{i18n.t('console.connectionError')}</strong><span>{consoleNotice(streamError)}{retryInMs ? i18n.t('console.retryDelay', { seconds: number(retryInMs / 1_000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) : ''}</span></div></div> : null}
      {stream.gap ? <div className="stale-banner" role="status"><AlertTriangle size={17} /><span>{i18n.t('console.gap', { reason: consoleNotice(stream.gap) })}</span><button className="button button--secondary" onClick={dismissGap}>{i18n.t('console.dismiss')}</button></div> : null}
      <section className="console-panel">
        <div className="console-toolbar">
          <label className="console-search"><Search size={16} /><span className="sr-only">{i18n.t('console.search')}</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={i18n.t('console.search')} /></label>
          <label className="console-filter"><span>{i18n.t('console.level')}</span><select value={level} onChange={(event) => setLevel(event.target.value as LogLevel)}><option value="all">{i18n.t('console.all')}</option><option value="debug">Debug</option><option value="info">Info</option><option value="warn">Warn</option><option value="error">Error</option><option value="unknown">Unknown</option></select></label>
          <label className="auto-scroll"><input type="checkbox" checked={autoScroll} onChange={(event) => { setAutoScroll(event.target.checked); if (event.target.checked) setNewLogCount(0); }} />{i18n.t('console.autoScroll')}</label>
          {stream.status ? <StatusBadge status={stream.status.state} /> : null}
        </div>
        <div
          ref={viewportRef}
          className="console-viewport"
          tabIndex={0}
          aria-label={i18n.t('console.logs')}
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
            <div className="console-empty"><TerminalSquare size={23} /><span>{stream.logs.length ? i18n.t('console.noMatches') : connection === 'connected' ? i18n.t('console.emptySnapshot') : i18n.t('console.waiting')}</span></div>
          ) : filteredLogs.map((entry) => (
            <div className={`log-line log-line--${entry.level}`} key={`${entry.id}:${entry.cursor}`}>
              <time dateTime={entry.timestamp ?? undefined}>{entry.timestamp ? formatLocalTime(entry.timestamp) : '--:--:--'}</time>
              <span className="log-level">{entry.level.toUpperCase()}</span>
              <span className="log-text">{entry.text}</span>
            </div>
          ))}
        </div>
        {!autoScroll && newLogCount > 0 ? <button className="new-logs-button" onClick={() => { setAutoScroll(true); setNewLogCount(0); const viewport = viewportRef.current; if (viewport) viewport.scrollTop = viewport.scrollHeight; }}><ArrowDown size={15} />{i18n.t('console.newLogs', { count: newLogCount })}</button> : null}
      </section>
      {stream.operation ? (
        <div className={`console-operation console-operation--${stream.operation.state}`}>
          <strong>{i18n.t('console.operation', { kind: stream.operation.kind })}</strong><span>{stream.operation.step} · {stream.operation.state}</span>
        </div>
      ) : null}
      <section className="command-panel">
        <div className="command-panel__heading"><div><h2>{i18n.t('console.sendHeading')}</h2><p>{i18n.t('console.transport', { transport: server.readiness.commandTransport === 'unavailable' ? i18n.t('console.unavailable') : server.readiness.commandTransport.toUpperCase() })}</p></div></div>
        <form onSubmit={(event) => { event.preventDefault(); sendCommand(); }}>
          <label><span className="sr-only">{i18n.t('console.command')}</span><input value={command} onChange={(event) => { setCommand(event.target.value); setValidationError(null); }} placeholder={i18n.t('console.example')} disabled={commandDisabled} aria-describedby="command-help" /></label>
          <button className="button button--primary" type="submit" disabled={commandDisabled || !command.trim()}><Send size={16} />{commandMutation.isPending ? i18n.t('console.sending') : i18n.t('console.send')}</button>
        </form>
        <p id="command-help" className="command-help">{i18n.t('console.help')}</p>
        {stale ? <p className="command-disabled-reason">{i18n.t('console.stale')}</p> : !server.readiness.commands.allowed ? <p className="command-disabled-reason">{i18n.t('console.disabled', { reason: readableReadinessReason(server.readiness.commands.reason) })}</p> : null}
        {validationError ? <p className="field-error" role="alert">{renderMessage(validationError)}</p> : null}
        {commandMutation.isError ? <p className="field-error" role="alert">{i18n.t('console.failed', { reason: errorMessage(commandMutation.error) })}</p> : null}
        {commandMutation.data ? <CommandResult response={commandMutation.data} /> : null}
      </section>
    </div>
  );
}
