import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PropertiesFields } from './PropertiesFields';

afterEach(cleanup);

const rules = {
  difficulty: { editable: true, restartRequired: true, reason: null },
  motd: { editable: true, restartRequired: false, reason: null },
};

describe('PropertiesFields', () => {
  it('shows fields read-only when the backend rule is false or missing', () => {
    render(<PropertiesFields values={{ difficulty: 'hard', 'max-players': '12' }} rules={{
      difficulty: { editable: false, restartRequired: false, reason: null },
    }} disabled={false} onChange={vi.fn()} />);

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('困难 · 只读：版本规则未确认')).toBeInTheDocument();
    expect(screen.getByText('12 · 只读：版本规则未确认')).toBeInTheDocument();
  });

  it('reports an edited select value and explains restart requirements', () => {
    const onChange = vi.fn();
    render(<PropertiesFields values={{ difficulty: 'normal' }} rules={rules} disabled={false} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('难度'), { target: { value: 'hard' } });
    expect(onChange).toHaveBeenCalledWith('difficulty', 'hard');
    expect(screen.getByText('修改需要重启后生效')).toBeInTheDocument();
  });

  it('freezes editable fields when disabled', () => {
    render(<PropertiesFields values={{ motd: 'Hello' }} rules={rules} disabled onChange={vi.fn()} />);

    expect(screen.getByLabelText('服务器描述')).toBeDisabled();
  });

  it('keeps unknown empty fields blank without choosing a default', () => {
    render(<PropertiesFields values={{ difficulty: '' }} rules={rules} disabled={false} onChange={vi.fn()} />);

    expect(screen.getByLabelText('难度')).toHaveValue('');
    expect(screen.getByRole('option', { name: '未提供' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('未提供')).toBeInTheDocument();
  });
});
it('groups settings and keeps the baseline distinct from pending numeric values', () => {
  render(<PropertiesFields values={{ 'max-players': '32' }} currentValues={{ 'max-players': '20' }} rules={{
    'max-players': { editable: true, restartRequired: true, reason: null },
  }} disabled={false} onChange={vi.fn()} />);
  for (const name of ['游戏玩法', '玩家管理', '性能', '其他设置']) expect(screen.getByRole('region', { name })).toBeInTheDocument();
  expect(screen.getByRole('spinbutton', { name: '最大玩家数' })).toHaveValue(32);
  expect(screen.getByText('当前值：20 · 待修改值：32')).toBeInTheDocument();
});
it('does not infer whitelist defaults or make unverified switches editable', () => {
  render(<PropertiesFields values={{ 'white-list': 'false', 'enforce-whitelist': '' }} rules={{}} disabled={false} onChange={vi.fn()} />);
  expect(screen.getByText('关闭 · 只读：版本规则未确认')).toBeInTheDocument();
  expect(screen.getByText('启用白名单')).toBeInTheDocument();
  expect(screen.getByText('强制执行白名单')).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});
it('preserves literal MOTD enum-looking words in baseline and draft', () => {
  render(<PropertiesFields values={{ motd: 'hard' }} currentValues={{ motd: 'true' }} rules={{}} disabled={false} onChange={vi.fn()} />);
  expect(screen.getByText('hard · 只读：版本规则未确认')).toBeInTheDocument();
  expect(screen.getByText('当前值：true · 待修改值：hard')).toBeInTheDocument();
});
