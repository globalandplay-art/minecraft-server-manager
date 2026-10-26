import { useSyncExternalStore } from 'react';
import { Monitor } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { serverSnapshot, themeStore, type ThemePreference } from '../theme/store';

export function ThemeSelector({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(themeStore.subscribe, themeStore.snapshot, () => serverSnapshot);
  return <div className="theme-selector">
    <label><span className={compact ? 'sr-only' : undefined}>{t('appearance.theme')}</span>
      {compact ? <Monitor size={15} aria-hidden="true" /> : null}
      <select value={state.preference} onChange={event => themeStore.setPreference(event.target.value as ThemePreference)}>
        <option value="system">{t('appearance.system')}</option>
        <option value="light">{t('appearance.light')}</option>
        <option value="dark">{t('appearance.dark')}</option>
      </select>
    </label>
    {!state.storageAvailable ? <small role="status">{t('appearance.storageUnavailable')}</small> : null}
  </div>;
}
export function AppearanceSettings() {
  const { t } = useTranslation();
  return <section className="panel appearance-settings" aria-labelledby="appearance-heading">
    <h2 id="appearance-heading">{t('appearance.heading')}</h2>
    <p>{t('appearance.description')}</p><ThemeSelector />
  </section>;
}
