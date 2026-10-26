import { describe, expect, it, vi } from 'vitest';
import { normalizePreference, ThemeStore, type ThemeEnvironment } from './store';

function fixture(value: string | null = null, dark = false) {
  let changed: (dark: boolean) => void = () => {};
  const removed = vi.fn();
  const environment: ThemeEnvironment = {
    read: () => value, write: vi.fn(), systemDark: () => dark,
    listen: fn => { changed = fn; return removed; }, apply: vi.fn(),
  };
  const store = new ThemeStore();
  const stop = store.start(environment);
  return { store, environment, stop, removed, change: (value: boolean) => changed(value) };
}
describe('appearance preference isolation', () => {
  it('defaults invalid preferences to system and follows changes without writing storage', () => {
    const f = fixture('unexpected', true);
    expect(f.store.snapshot()).toMatchObject({ preference: 'system', theme: 'dark' });
    f.change(false);
    expect(f.store.snapshot().theme).toBe('light');
    expect(f.environment.write).not.toHaveBeenCalled();
    f.stop(); expect(f.removed).toHaveBeenCalledOnce();
  });
  it('persists explicit choices and keeps manual overrides across OS changes', () => {
    const f = fixture();
    f.store.setPreference('dark'); f.change(false);
    expect(f.store.snapshot().theme).toBe('dark');
    expect(f.environment.write).toHaveBeenCalledExactlyOnceWith('dark');
    f.store.setPreference('system');
    expect(f.store.snapshot().theme).toBe('light'); f.stop();
  });
  it('keeps a functional preference when storage is unavailable', () => {
    const f = fixture();
    f.environment.write = () => { throw new Error('storage unavailable'); };
    f.store.setPreference('dark');
    expect(f.store.snapshot()).toEqual({ preference: 'dark', theme: 'dark', storageAvailable: false });
    f.stop();
  });
  it('does not retain detached listeners and has no browser dependency', () => {
    const f = fixture(); const listener = vi.fn(); const unsubscribe = f.store.subscribe(listener);
    unsubscribe(); f.store.setPreference('dark'); expect(listener).not.toHaveBeenCalled();
    expect(normalizePreference(null)).toBe('system'); f.stop();
  });
});
