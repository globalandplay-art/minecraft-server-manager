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
    expect(screen.getByText('hard · 只读：版本规则未确认')).toBeInTheDocument();
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
