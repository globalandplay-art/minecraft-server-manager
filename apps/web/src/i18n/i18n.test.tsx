import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { chooseLanguage, currentLanguage, i18n, initialLanguage, number, resolveLanguage, type LanguagePreferences } from './index';
import { resources } from './resources';
import { LanguageSelector } from '../components/LanguageSelector';
import { formatLocalTime, formatUptime, statusLabels } from '../format';

afterEach(cleanup);

describe('L1 language core', () => {
  it('detects supported system variants conservatively and respects preference', () => {
    expect(resolveLanguage(['fr-FR', 'ja-JP'])).toBe('ja');
    expect(resolveLanguage(['zh-Hans-CN'])).toBe('zh-CN');
    expect(resolveLanguage(['en-GB'])).toBe('en');
    expect(resolveLanguage(['zh-Hant-TW'])).toBe('en');
    expect(initialLanguage({ read: () => 'ja', write: () => {} }, ['en'])).toBe('ja');
    expect(initialLanguage({ read: () => 'invalid', write: () => {} }, ['zh-CN'])).toBe('zh-CN');
    expect(initialLanguage({ read: () => { throw Error('unavailable'); }, write: () => {} }, ['ja'])).toBe('ja');
    expect(initialLanguage({ read: () => 'ja-JP', write: () => {} }, ['en'])).toBe('ja');
    expect(initialLanguage({ read: () => 'en-US', write: () => {} }, ['zh-CN'])).toBe('en');
  });
  it('accepts formal en-US and ja-JP locales through the existing preference core', async () => {
    await chooseLanguage('en-US'); expect(currentLanguage()).toBe('en');
    await chooseLanguage('ja-JP'); expect(currentLanguage()).toBe('ja');
  });

  it('ships matching nonempty keys and interpolation variables for all three locales', () => {
    const baseline = resources.en.translation;
    for (const resource of Object.values(resources)) {
      expect(Object.keys(resource.translation).sort()).toEqual(Object.keys(baseline).sort());
      for (const key of Object.keys(baseline) as Array<keyof typeof baseline>) {
        expect(resource.translation[key].trim()).not.toBe('');
        expect(resource.translation[key].match(/\{\{[^}]+\}\}/g)?.sort() ?? []).toEqual(baseline[key].match(/\{\{[^}]+\}\}/g)?.sort() ?? []);
      }
    }
  });

  it('formats plural messages, numbers and dates using the selected locale', async () => {
    await chooseLanguage('en');
    expect(i18n.t('common.records', { count: 1 })).toBe('1 record');
    expect(i18n.t('common.records', { count: 2 })).toBe('2 records');
    expect(number(1234.5)).toBe(new Intl.NumberFormat('en').format(1234.5));
    expect(formatUptime(3660)).toBe('1h 1m');
    expect(statusLabels.running).toBe('Running');
    await chooseLanguage('ja');
    expect(i18n.t('common.records', { count: 2 })).toBe('2 件');
    expect(formatUptime(3660)).toBe('1時間 1分');
    expect(statusLabels.running).toBe('稼働中');
    expect(formatLocalTime('2026-10-25T12:34:56Z')).toBe(new Intl.DateTimeFormat('ja', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date('2026-10-25T12:34:56Z')));
    expect(formatLocalTime('invalid')).toBe('不明');
  });

  it('changes language without remounting drafts and persists only explicit selections', async () => {
    let saved: string | null = null;
    const preferences: LanguagePreferences = { read: () => saved, write: value => { saved = value; } };
    function Form() {
      const { t } = useTranslation();
      const [draft, setDraft] = useState('');
      return <><LanguageSelector preferences={preferences} /><input aria-label="draft" value={draft} onChange={event => setDraft(event.target.value)} /><p>{t('shell.local')}</p></>;
    }
    render(<Form />);
    fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'whitelist add Player_123 日本語' } });
    expect(saved).toBeNull();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ja' } });
    await waitFor(() => expect(screen.getByText('ローカルモード')).toBeVisible());
    expect(screen.getByLabelText('draft')).toHaveValue('whitelist add Player_123 日本語');
    expect(saved).toBe('ja');
    expect(initialLanguage(preferences, ['en'])).toBe('ja');
    expect(currentLanguage()).toBe('ja');
  });

  it('keeps language usable while reporting unavailable persistence', async () => {
    render(<LanguageSelector preferences={{ read: () => null, write: () => { throw Error('storage disabled'); } }} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('could not be saved'));
    expect(currentLanguage()).toBe('en');
  });
});
