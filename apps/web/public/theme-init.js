// Runs synchronously in <head>, before the React/CSS module loads. Values are
// allowlisted; no raw storage value is injected into markup or style.
(() => {
  let preference = 'system';
  try {
    const saved = localStorage.getItem('lt.appearance.v1');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch { /* Restricted storage falls back to system. */ }
  const dark = preference === 'dark' || (preference === 'system' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
  const theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1B1D1E' : '#F7F7F4');
})();
