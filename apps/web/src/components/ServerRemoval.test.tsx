import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ServerRemoval } from './ServerRemoval';
import { api, ApiClientError } from '../api';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('requires named confirmation and sends exactly one removal, never a file deletion', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof api.registrationRemove>>) => void;
  const remove = vi.spyOn(api, 'registrationRemove').mockImplementation(() => new Promise(done => { resolve = done; })), changed = vi.fn();
  render(<ServerRemoval id="second" name="Second" type="vanilla" onRemoved={changed} />);
  fireEvent.click(screen.getByRole('button', { name: '移除服务器' }));
  expect(screen.getByRole('dialog', { name: '移除 Second' })).toHaveTextContent('不删除服务端目录'); expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认移除' })); fireEvent.click(screen.getByRole('button', { name: '正在移除…' }));
  expect(remove).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledWith('second');
  resolve({ data: { id: 'second', removed: true, filesPreserved: true, unloaded: true, restartRequired: false, unloadErrorCode: null }, meta: { requestId: 'test', generatedAt: new Date().toISOString(), mode: 'local' } });
  await waitFor(() => expect(changed).toHaveBeenCalledWith('second', '已移除 Second 的 LT 登记，服务端文件完整保留。'));
});
it('disables running-instance removal and reports a definite server rejection', async () => {
  const remove = vi.spyOn(api, 'registrationRemove').mockRejectedValue(new ApiClientError('先停服', 'http', 409, 'REGISTRATION_INSTANCE_ACTIVE'));
  const { rerender } = render(<ServerRemoval id="first" name="First" type="vanilla" blocked />);
  expect(screen.getByRole('button', { name: '移除服务器' })).toBeDisabled();
  rerender(<ServerRemoval id="first" name="First" type="vanilla" />); fireEvent.click(screen.getByRole('button', { name: '移除服务器' })); fireEvent.click(screen.getByRole('button', { name: '确认移除' }));
  await screen.findByText('先停服'); expect(remove).toHaveBeenCalledOnce();
});
it('retains uncertainty and never automatically repeats a lost response', async () => {
  const remove = vi.spyOn(api, 'registrationRemove').mockRejectedValue(new Error('connection lost'));
  render(<ServerRemoval id="first" name="First" type="vanilla" />);
  fireEvent.click(screen.getByRole('button', { name: '移除服务器' })); fireEvent.click(screen.getByRole('button', { name: '确认移除' }));
  await screen.findByText(/结果未确认/); expect(remove).toHaveBeenCalledOnce(); expect(screen.getByRole('button', { name: '确认移除' })).toBeDisabled();
});
