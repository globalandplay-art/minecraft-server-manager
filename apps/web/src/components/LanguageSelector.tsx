import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { chooseLanguage, currentLanguage, type Language, type LanguagePreferences } from '../i18n';
import { browserPreferences } from '../i18n/browser';

export function LanguageSelector({ preferences = browserPreferences }: { preferences?: LanguagePreferences }) {
  const { t } = useTranslation();
  const [storageFailed, setStorageFailed] = useState(false);
  return <div className="language-selector">
    <label><span>{t('language.label')}</span>
      <select value={currentLanguage()} onChange={event => {
        void chooseLanguage(event.target.value as Language, preferences).then(saved => setStorageFailed(!saved));
      }}>
        <option value="zh-CN">简体中文</option><option value="en">English</option><option value="ja">日本語</option>
      </select>
    </label>
    {storageFailed ? <small role="status">{t('language.storageUnavailable')}</small> : null}
  </div>;
}

export function LanguageSettings() {
  const { t } = useTranslation();
  return <section className="panel language-settings"><h2>{t('language.heading')}</h2>
    <p>{t('language.description')}</p><LanguageSelector />
  </section>;
}
