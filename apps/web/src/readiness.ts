import { i18n } from './i18n';
const knownReasons = new Set(['mock-mode', 'feature-not-implemented', 'already-running', 'already-stopped', 'operation-active', 'eula-not-accepted', 'external-process', 'recovery-required', 'unknown-status', 'server-state-unknown', 'transport-unavailable', 'capability-unsupported', 'state-stopped', 'state-starting', 'state-running', 'state-stopping', 'state-crashed', 'state-unknown']);
export function readableReadinessReason(reason: string | null) {
  if (!reason) return i18n.t('readiness.noReason');
  return knownReasons.has(reason) ? i18n.t('readiness.' + reason) : i18n.t('readiness.other', { reason });
}
