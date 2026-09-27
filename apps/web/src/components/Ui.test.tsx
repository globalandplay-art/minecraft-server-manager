import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErrorState, MetricCard, MockBanner } from './Ui';

describe('状态语义组件', () => {
  it('将不可用指标呈现为 N/A 并保留人类可读原因', () => {
    render(<MetricCard label="TPS" value="N/A" unavailableReason="当前服务端未提供" />);

    expect(screen.getByText('N/A')).toBeInTheDocument();
    expect(screen.getByText('当前服务端未提供')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('持续明确标识 Mock 数据而不冒充真实服务器', () => {
    render(<MockBanner />);

    expect(screen.getByText('MOCK DATA')).toBeInTheDocument();
    expect(screen.getByText(/未连接真实 Minecraft/)).toBeInTheDocument();
  });

  it('错误状态提供真实可操作的重试入口', async () => {
    const retry = vi.fn();
    render(<ErrorState description="管理器暂时不可达" retry={retry} />);

    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toHaveTextContent('管理器暂时不可达');
  });
});
