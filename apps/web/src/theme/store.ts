export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';
export const themePreferenceKey = 'lt.appearance.v1';
export type ThemeSnapshot = Readonly<{ preference: ThemePreference; theme: Theme; storageAvailable: boolean }>;
export interface ThemeEnvironment {
  read(): string | null;
  write(preference: ThemePreference): void;
  systemDark(): boolean;
  listen(listener: (dark: boolean) => void): () => void;
  apply(theme: Theme): void;
}
export function normalizePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}
export const serverSnapshot: ThemeSnapshot = Object.freeze({ preference: 'system', theme: 'light', storageAvailable: true });

// Only appearance state. It has no access to API, authentication or server data.
export class ThemeStore {
  #snapshot = serverSnapshot;
  #listeners = new Set<() => void>();
  #environment: ThemeEnvironment | undefined;
  #unlisten: (() => void) | undefined;
  #dark = false;
  snapshot = (): ThemeSnapshot => this.#snapshot;
  subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };

  start(environment: ThemeEnvironment): () => void {
    this.#unlisten?.();
    this.#environment = environment;
    let preference: ThemePreference = 'system', storageAvailable = true;
    try { preference = normalizePreference(environment.read()); } catch { storageAvailable = false; }
    this.#dark = environment.systemDark();
    this.#publish(preference, storageAvailable);
    const unlisten = environment.listen(dark => {
      this.#dark = dark;
      this.#publish(this.#snapshot.preference, this.#snapshot.storageAvailable);
    });
    this.#unlisten = unlisten;
    return () => {
      unlisten();
      if (this.#environment === environment) { this.#environment = undefined; this.#unlisten = undefined; }
    };
  }
  setPreference = (input: ThemePreference): void => {
    const preference = normalizePreference(input);
    let storageAvailable = true;
    try { this.#environment?.write(preference); } catch { storageAvailable = false; }
    this.#publish(preference, storageAvailable);
  };
  #publish(preference: ThemePreference, storageAvailable: boolean) {
    const theme = preference === 'system' ? this.#dark ? 'dark' : 'light' : preference;
    this.#environment?.apply(theme);
    if (this.#snapshot.preference === preference && this.#snapshot.theme === theme && this.#snapshot.storageAvailable === storageAvailable) return;
    this.#snapshot = Object.freeze({ preference, theme, storageAvailable });
    for (const listener of this.#listeners) listener();
  }
}
export const themeStore = new ThemeStore();
