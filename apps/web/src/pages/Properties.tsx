import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import { formatLocalTime } from '../format';
import { renderMessage, type UiMessage } from '../i18n/message';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Operation, PropertiesResponse, ServersResponse } from '@mcsm/contracts';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, ApiClientError, errorMessage } from '../api';
import { PropertiesFields } from '../components/PropertiesFields';
import { EmptyState, ErrorState, PageHeading } from '../components/Ui';
import { usePropertyReceipt, type PropertyReceipt as Receipt } from '../propertyReceipt';
import { authState } from '../authState';
import { LanguageSettings } from '../components/LanguageSelector';
import { AppearanceSettings } from '../components/Appearance';

type Snapshot = PropertiesResponse['data'];
const valuesOf = (snapshot: Snapshot) => snapshot.discovery ? Object.fromEntries(snapshot.discovery.items.map(item => [item.key, item.rawValue])) : Object.fromEntries(Object.entries(snapshot.fields).map(([key, value]) => [key, value === null ? '' : String(value)]));

export function PropertiesPage({ server }: { server?: ServersResponse['data']['items'][number] | undefined }) {
  const { generation } = useSyncExternalStore(authState.subscribe, authState.snapshot);
  return <><div className="workspace-preferences"><AppearanceSettings /><LanguageSettings /></div><PropertiesEditor key={`${server?.server.id ?? 'none'}:${generation}`} server={server} /></>;
}

function PropertiesEditor({ server }: { server?: ServersResponse['data']['items'][number] | undefined }) {
  useTranslation();
  const id = server?.server.id;
  const { receipt, update: setReceipt, current: receiptScopeCurrent } = usePropertyReceipt(id);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [baseline, setBaseline] = useState<Snapshot>();
  const [edits, setEdits] = useState<Record<string, string>>(() => Object.fromEntries(
    Object.entries(receipt?.body.changes ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string')));
  const [confirm, setConfirm] = useState(false);
  const [offline, setOffline] = useState(false);
  const [sending, setSending] = useState(false);
  const dispatching = useRef(false);
  const [unknown, setUnknown] = useState(Boolean(receipt && !receipt.operationId));
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [message, setMessage] = useState<UiMessage>('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const query = useQuery({ queryKey: ['properties', id], queryFn: ({ signal }) => api.properties(id!, signal),
    enabled: Boolean(id && server?.capabilities.properties), retry: false, refetchOnWindowFocus: true, refetchOnMount: 'always', refetchInterval: () => document.hidden ? false : 30_000 });
  useEffect(() => { if (query.data && !baseline) setBaseline(query.data.data); }, [query.data, baseline]);
  const op = useQuery({ queryKey: ['properties-operation', id, receipt?.operationId],
    queryFn: ({ signal }) => api.operation(receipt!.operationId!, signal), enabled: Boolean(receipt?.operationId), retry: false,
    refetchInterval: (q) => document.hidden || ['succeeded', 'failed', 'interrupted'].includes(q.state.data?.data.state ?? '') ? false : 1000 });
  const handled = useRef<string | undefined>(undefined);
  useEffect(() => {
    const result: Operation | undefined = op.data?.data;
    if (!result || !receipt?.operationId || result.id !== receipt.operationId || result.serverId !== id || result.kind !== 'properties-write') return;
    if (handled.current === result.id || !['succeeded', 'failed', 'interrupted'].includes(result.state)) return;
    handled.current = result.id;
    if (result.state === 'succeeded' && !result.error && result.result?.resourceId) {
      setMessage({ key: 'properties.notice.saved' });
      setEdits({}); setConfirm(false); setOffline(false); setReceipt(undefined, receipt);
      void query.refetch().then((fresh) => { if (mounted.current && fresh.data && !fresh.isError) setBaseline(fresh.data.data); });
    } else {
      const blocked = result.state !== 'failed' || result.error?.code === 'RECOVERY_REQUIRED';
      setMessage(blocked ? { key: 'properties.notice.recovery' } : { key: 'properties.notice.failed' });
      setUnknown(blocked);
      if (result.error?.code === 'PROPERTIES_REVISION_CONFLICT') setNeedsRefresh(true);
      if (!blocked) setReceipt(undefined, receipt);
      setConfirm(false);
    }
  }, [op.data, receipt, id, query]);
  const disk = query.data?.data;
  const externalConflict = Boolean(baseline && disk && (disk.revision !== baseline.revision || (baseline.discovery && disk.discovery && baseline.discovery.fileIdentity !== disk.discovery.fileIdentity)));
  const fileReplaced = Boolean(baseline?.discovery && disk?.discovery && baseline.discovery.fileIdentity !== disk.discovery.fileIdentity);
  const changedKeys = baseline && disk ? [...new Set([...Object.keys(valuesOf(baseline)), ...Object.keys(valuesOf(disk))])].filter(key => valuesOf(baseline)[key] !== valuesOf(disk)[key]) : [];
  const blockedDraft = Object.entries(edits).filter(([key]) => baseline?.discovery && !baseline.discovery.items.some(item => item.key === key && item.editable));
  const frozen = sending || Boolean(receipt);
  const observedAge = server ? now - Date.parse(server.status.observedAt) : Infinity;
  const ready = server?.status.state === 'stopped' && server.status.ownership === 'none' &&
    !server.status.recoveryRequired && !server.status.activeOperationId && observedAge >= 0 && observedAge <= 15_000 &&
    !needsRefresh && !externalConflict && blockedDraft.length === 0 && !query.isError && !query.isFetching;
  const baseValues = baseline ? valuesOf(baseline) : {};
  const values = { ...baseValues, ...edits };
  const changes = Object.fromEntries(Object.entries(edits).filter(([key, value]) => baseline?.fieldRules[key]?.editable && (!baseline.discovery || baseline.discovery.items.some(item => item.key === key && item.editable)) && value !== baseValues[key]));
  async function refresh() {
    setConfirm(false); setOffline(false);
    const fresh = await query.refetch();
    if (mounted.current && fresh.data && !fresh.isError) {
      if (baseline && (fresh.data.data.revision !== baseline.revision || (baseline.discovery && fresh.data.data.discovery && baseline.discovery.fileIdentity !== fresh.data.data.discovery.fileIdentity))) { setConfirm(false); return; }
      // A refresh observes disk; only an explicit edit/discard or success removes a draft.
      setBaseline(fresh.data.data); setNeedsRefresh(false); setConfirm(false); setOffline(false);
    }
  }
  async function submit(existing?: Receipt) {
    if (!id || !baseline || dispatching.current || sending || (!existing && (receipt || !ready || !confirm || !Object.keys(changes).length))) return;
    const next = existing ? { ...existing, attempt: (existing.attempt ?? 0) + 1 } : { body: { changes, confirmOfflineIdentity: offline }, revision: baseline.revision, key: crypto.randomUUID() };
    if (!setReceipt(next, existing)) return;
    dispatching.current = true; setSending(true); setMessage({ key: 'properties.notice.sending' }); setUnknown(false);
    try {
      const response = await api.saveProperties(id, next.body, next.revision, next.key);
      if (response.data.operation.serverId !== id || response.data.operation.kind !== 'properties-write') throw new Error('配置操作响应不匹配');
      setReceipt({ ...next, operationId: response.data.operation.id }, next);
      if (!mounted.current || !receiptScopeCurrent()) return;
      setMessage({ key: 'properties.notice.accepted' });
    } catch (error) {
      const definite = error instanceof ApiClientError && error.kind === 'http' && error.status !== undefined && error.status >= 400 && error.status < 500;
      if (!existing && definite && error.code !== 'RECOVERY_REQUIRED') setReceipt(undefined, next);
      if (!mounted.current || !receiptScopeCurrent()) return;
      setUnknown(!definite || Boolean(existing)); setMessage(definite ? { key: 'properties.notice.rejected', values: { error: errorMessage(error) } } : { key: 'properties.notice.unknown' });
      if (existing) {
        setMessage({ key: 'properties.notice.originalUnknown' });
      } else if (definite && error.code === 'RECOVERY_REQUIRED') {
        setMessage({ key: 'properties.notice.manualRecovery' });
      } else if (definite) {
        setConfirm(false);
        if (error.code === 'PROPERTIES_REVISION_CONFLICT') setNeedsRefresh(true);
      }
    } finally { dispatching.current = false; if (mounted.current && receiptScopeCurrent()) setSending(false); }
  }
  return <div className="page-stack properties-page">
    <PageHeading eyebrow="SERVER CONFIGURATION" title={i18n.t('properties.title')} description={i18n.t('properties.description')} />
    <p>{i18n.t('properties.offlineOnly')}</p>
    {id ? <Link className="button button--secondary" to={`/whitelist?server=${encodeURIComponent(id)}`}>{i18n.t('properties.members')}</Link> : null}
    {!server ? <EmptyState title={i18n.t('players.choose')} description={i18n.t('properties.chooseDescription')} /> : !server.capabilities.properties ?
      <EmptyState title={i18n.t('properties.unsupported')} description={i18n.t('properties.capability')} /> : query.isPending && !baseline ? <p role="status">{i18n.t('properties.loading')}</p> :
      !baseline ? <ErrorState description={errorMessage(query.error)} retry={() => void refresh()} /> : <>
        {!ready ? <p role="status">{i18n.t('properties.notReady')}</p> : null}
        {disk && baseline && externalConflict ? <section role="alert"><h2>{i18n.t('properties.diskChanged')}</h2>
          <p>{fileReplaced ? i18n.t('properties.identityChanged') : ''}{i18n.t('properties.compareNotice')}</p>
          <ul>{changedKeys.map(key => <li key={key}>{key}: {valuesOf(baseline)[key] ?? i18n.t('properties.added')} → {valuesOf(disk)[key] ?? i18n.t('properties.removed')}</li>)}</ul>
          <button className="button" disabled={frozen} onClick={() => { setBaseline(disk); setNeedsRefresh(false); setConfirm(false); setOffline(false); }}>{i18n.t('properties.acceptComparison')}</button>
        </section> : null}
        <p>{i18n.t('properties.readSummary', { time: formatLocalTime(query.data?.meta.generatedAt), changed: changedKeys.length, pending: Object.keys(changes).length })}</p>
        {blockedDraft.length ? <section role="alert"><h2>{i18n.t('properties.checkDraft')}</h2><ul>{blockedDraft.map(([key,value]) => <li key={key}>{key}: {value} <button disabled={frozen} onClick={() => setEdits(old => Object.fromEntries(Object.entries(old).filter(([name]) => name !== key)))}>{i18n.t('properties.discardDraft', { key })}</button></li>)}</ul><p>{i18n.t('properties.invalidDraft')}</p></section> : null}
        <PropertiesFields discovery={baseline.discovery} values={values} currentValues={baseValues} rules={baseline.fieldRules} disabled={frozen} onChange={(key, value) => {
          setEdits((old) => {
            const next = { ...old };
            if (value === baseValues[key]) delete next[key]; else next[key] = value;
            return next;
          }); setConfirm(false); setOffline(false); setMessage('');
        }} />
        {Object.keys(changes).length ? <section className="settings-panel" aria-label={i18n.t('properties.confirmLabel')}>
          <h2>{i18n.t('properties.pending')}</h2><ul>{Object.entries(changes).map(([key, value]) => <li key={key}>{key}：{baseValues[key] || i18n.t('property.unprovided')} → {value || i18n.t('property.empty')}（{baseline.fieldRules[key]?.restartRequired ? i18n.t('property.restartRequired') : i18n.t('property.restartNotRequired')}）</li>)}</ul>
          {changes['online-mode'] === 'false' ? <label><input type="checkbox" disabled={frozen} checked={offline} onChange={(e) => setOffline(e.target.checked)} />{i18n.t('properties.offlineIdentityConsent')}</label> : null}
          <label><input type="checkbox" disabled={frozen} checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />{i18n.t('properties.confirmSave')}</label>
        </section> : null}
        <button className="button button--secondary" disabled={frozen || query.isFetching} onClick={() => void refresh()}>{i18n.t('properties.refresh')}</button>
        <button className="button" disabled={!ready || frozen || !confirm || !Object.keys(changes).length || (changes['online-mode'] === 'false' && !offline)} onClick={() => void submit()}>{i18n.t('properties.save')}</button>
        {unknown && receipt && !receipt.operationId ? <button className="button button--secondary" disabled={sending} onClick={() => void submit(receipt)}>{i18n.t('properties.verifyOriginal')}</button> : null}
        {receipt ? <p>{i18n.t('properties.retainedRequest')}</p> : null}
        {receipt?.operationId ? <p>{i18n.t('properties.operation', { id: receipt.operationId })}</p> : null}
        {op.isError ? <ErrorState description={i18n.t('properties.resultUnavailable')} retry={() => void op.refetch()} /> : null}
        {query.isError && baseline ? <p role="alert">{i18n.t('properties.refreshFailed')}</p> : null}
        {message ? <p role="status">{renderMessage(message)}</p> : null}
      </>}
  </div>;
}
