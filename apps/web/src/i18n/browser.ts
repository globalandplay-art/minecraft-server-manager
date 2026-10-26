import { i18n, initialLanguage, preferenceKey, type LanguagePreferences } from './index';

// Browser capabilities stay in this adapter; Electron can inject its own store.
export const browserPreferences: LanguagePreferences = {
  read: () => window.localStorage.getItem(preferenceKey),
  write: language => window.localStorage.setItem(preferenceKey, language),
};
export function initializeBrowserLanguage(): void {
  void i18n.changeLanguage(initialLanguage(browserPreferences, navigator.languages));
  const updateDocument = () => { document.documentElement.lang = i18n.resolvedLanguage ?? 'en'; };
  updateDocument();
  i18n.on('languageChanged', updateDocument);
}
