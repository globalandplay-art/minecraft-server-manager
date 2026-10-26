import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resources } from './resources';

export const languages = ['zh-CN', 'en', 'ja'] as const;
export type Language = typeof languages[number];
export const interfaceLocales = ['zh-CN', 'en-US', 'ja-JP'] as const;
export type InterfaceLocale = typeof interfaceLocales[number];
export const preferenceKey = 'lt.interface-language.v1';
export interface LanguagePreferences {
  read(): string | null;
  write(language: Language): void;
}
export function resolveLanguage(candidates: readonly string[]): Language {
  for (const candidate of candidates) {
    const normalized = candidate.trim().replaceAll('_', '-').toLowerCase();
    // Traditional Chinese is not represented by a Simplified Chinese locale.
    if (normalized === 'zh' || normalized === 'zh-cn' || normalized === 'zh-sg' || normalized.startsWith('zh-hans')) return 'zh-CN';
    if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja';
    if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  }
  return 'en';
}
export function initialLanguage(preferences?: LanguagePreferences, systemLanguages: readonly string[] = []): Language {
  try {
    const saved = preferences?.read();
    if (languages.includes(saved as Language) || interfaceLocales.includes(saved as InterfaceLocale)) return resolveLanguage([saved!]);
  } catch { /* Storage is optional; system detection still works. */ }
  return resolveLanguage(systemLanguages);
}
export const i18n = createInstance();
void i18n.use(initReactI18next).init({
  resources, lng: 'en', fallbackLng: 'en', supportedLngs: [...languages],
  keySeparator: false, returnNull: false, returnEmptyString: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
  initAsync: false,
});
export function currentLanguage(): Language {
  return resolveLanguage([i18n.resolvedLanguage ?? i18n.language]);
}
export async function chooseLanguage(language: Language | InterfaceLocale, preferences?: LanguagePreferences): Promise<boolean> {
  if (!languages.includes(language as Language) && !interfaceLocales.includes(language as InterfaceLocale)) return false;
  const normalized = resolveLanguage([language]);
  await i18n.changeLanguage(normalized);
  try { preferences?.write(normalized); return true; } catch { return false; }
}
export function number(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(currentLanguage(), options).format(value);
}
