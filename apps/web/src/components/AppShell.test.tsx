import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';

describe('AppShell 导航', () => {
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
