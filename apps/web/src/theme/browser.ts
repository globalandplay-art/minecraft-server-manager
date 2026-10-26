import { themePreferenceKey, themeStore } from './store';

export function initializeBrowserTheme(): () => void {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : undefined;
  return themeStore.start({
    read: () => window.localStorage.getItem(themePreferenceKey),
    write: value => window.localStorage.setItem(themePreferenceKey, value),
    systemDark: () => media?.matches ?? false,
    listen: listener => {
      if (!media) return () => {};
      const changed = (event: MediaQueryListEvent) => listener(event.matches);
      media.addEventListener('change', changed);
      return () => media.removeEventListener('change', changed);
    },
    apply: theme => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1B1D1E' : '#F7F7F4');
    },
  });
}
