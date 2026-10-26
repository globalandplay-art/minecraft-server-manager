import { useTranslation } from 'react-i18next';
import type { HealthResponse, ServersResponse } from '@mcsm/contracts';
import { Info, LockKeyhole, ShieldCheck } from 'lucide-react';
import { PageHeading, PhaseNotice } from '../components/Ui';
import { LanguageSettings } from '../components/LanguageSelector';
import { AppearanceSettings } from '../components/Appearance';

type Features = HealthResponse['data']['features'];
type ServerSummary = ServersResponse['data']['items'][number];

const content = {
  players: { feature: 'players', phase: 4 }, worlds: { feature: 'worlds', phase: 3 },
  addons: { feature: 'addons', phase: 5 }, console: { feature: 'console', phase: 2 },
  performance: { feature: 'performance', phase: 6 }, backups: { feature: 'backups', phase: 3 },
  crashes: { feature: 'crashAnalysis', phase: 6 },
} as const;

export type PhasePageKind = keyof typeof content;

export function PhasePage({ kind, features, server }: { kind: PhasePageKind; features?: Features | undefined; server?: ServerSummary | undefined }) {
  const { t } = useTranslation();
  const page = content[kind];
  const state = features?.[page.feature];
  const phase = state?.phase ?? page.phase;
  const noAddons = kind === 'addons' && server && !server.capabilities.mods && !server.capabilities.plugins;
  return (
    <div className="page-stack">
      <PageHeading eyebrow={t('monitor.roadmap')} title={t(`nav.${kind}`)} description={t(`phase.${kind}.description`)} />
      {noAddons ? (
        <section className="state-card state-card--empty">
          <span className="state-card__icon"><Info size={24} /></span>
          <h2>{t('phase.noAddons')}</h2>
          <p>{t('phase.noAddonsDescription', { type: server.server.type.toUpperCase() })}</p>
        </section>
      ) : (
        <PhaseNotice phase={phase} title={t('phase.notEnabled', { page: t(`nav.${kind}`) })}>{t(`phase.${kind}.detail`)}</PhaseNotice>
      )}
      <div className="explanation-grid">
        <article className="explanation-card"><LockKeyhole size={20} /><div><h3>{t('phase.readOnly')}</h3><p>{t('phase.noPlaceholderWrites')}</p></div></article>
        <article className="explanation-card"><ShieldCheck size={20} /><div><h3>{t('phase.backendCapabilities')}</h3><p>{t('phase.independentChecks')}</p></div></article>
      </div>
    </div>
  );
}

export function SettingsPage({ features }: { features?: Features | undefined }) {
  const { t } = useTranslation();
  const propertiesPhase = features?.properties.phase;
  const remotePhase = features?.remoteAccess.phase;
  return (
    <div className="page-stack">
      <LanguageSettings />
      <AppearanceSettings />
      <PageHeading eyebrow={t('monitor.localManager')} title={t('nav.settings')} description={t('settings.description')} />
      <section className="settings-panel">
        <div><span className="settings-icon"><ShieldCheck size={21} /></span><div><h2>{t('settings.local')}</h2><p>{t('settings.localDescription')}</p></div><span className="phase-badge">{t('common.readOnly')}</span></div>
        <div><span className="settings-icon"><Info size={21} /></span><div><h2>{t('properties.title')}</h2><p>{t('settings.propertiesDescription', { phase: propertiesPhase ?? t('common.unknown') })}</p></div><span className="phase-badge">P{propertiesPhase ?? '—'}</span></div>
        <div><span className="settings-icon"><LockKeyhole size={21} /></span><div><h2>{t('settings.remote')}</h2><p>{t('monitor.remotePaused')}</p></div><span className="phase-badge">P{remotePhase ?? '—'}</span></div>
      </section>
    </div>
  );
}
