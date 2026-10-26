import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';
import type { ServersResponse } from '@mcsm/contracts';
import { i18n } from '../i18n';
afterEach(cleanup);

describe('AppShell 导航', () => {
  it('translates every navigation label and keeps instance/active route while adapting Mods and Plugins', async () => {
    const paper = { server: { id: 'instance-a', name: '原始实例 / Raw', type: 'paper' }, capabilities: { plugins: true, mods: false } } as ServersResponse['data']['items'][number];
    function shell(row = paper) { return <MemoryRouter initialEntries={['/addons?server=instance-a']}><AppShell servers={[row]} selectedId="instance-a" mode="mock" connectionState="connected"><p>content</p></AppShell></MemoryRouter>; }
    const view = render(shell());
    for (const [language, labels] of [
      ['zh-CN', ['仪表盘', '服务器', '玩家', '世界管理', '插件', '控制台', '性能监控', '备份', '崩溃分析', '设置']],
      ['en', ['Dashboard', 'Servers', 'Players', 'Worlds', 'Plugins', 'Console', 'Performance', 'Backups', 'Crash Analysis', 'Settings']],
      ['ja', ['ダッシュボード', 'サーバー', 'プレイヤー', 'ワールド管理', 'プラグイン', 'コンソール', 'パフォーマンス', 'バックアップ', 'クラッシュ解析', '設定']],
    ] as const) {
      await act(async () => { await i18n.changeLanguage(language); });
      for (const label of labels) expect(screen.getByRole('link', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
      const active = document.querySelector('.nav-item--active'); expect(active).toHaveAttribute('href', '/addons?server=instance-a');
      expect(screen.getByLabelText(i18n.t('shell.selectInstance'))).toHaveValue('instance-a');
      expect(screen.getByLabelText(i18n.t('workspace.location'))).toHaveTextContent(i18n.t('nav.plugins'));
    }
    const fabric = { ...paper, server: { ...paper.server, type: 'fabric' as const }, capabilities: { ...paper.capabilities, mods: true, plugins: false } };
    view.rerender(shell(fabric));
    expect(screen.getByRole('link', { name: /^MOD/ })).toHaveAttribute('href', '/addons?server=instance-a');
    expect(screen.getByLabelText(i18n.t('workspace.location'))).toHaveTextContent('MOD');
  });
  it('提供有名称的主导航，并让抽屉支持焦点、Escape 与滚动锁', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppShell servers={[]} connectionState="connecting">
          <p>页面内容</p>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: '打开主导航' });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: '主导航抽屉' })).toHaveAttribute('aria-modal', 'true');
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByRole('button', { name: '关闭导航' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '主导航抽屉' })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    expect(trigger).toHaveFocus();
  });
});
