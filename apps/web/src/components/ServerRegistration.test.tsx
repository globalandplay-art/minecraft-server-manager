import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ServerRegistration } from './ServerRegistration';
const meta = { requestId: 'test', generatedAt: '2026-10-21T00:00:00Z', mode: 'local' as const };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function setup() {
  vi.spyOn(api, 'registrationCatalog').mockResolvedValue({ data: { profiles: [{ id: 'first', name: 'First Java' }], pending: [] }, meta });
  const preview = vi.spyOn(api, 'registrationPreview').mockResolvedValue({ data: { token: '123e4567-e89b-42d3-a456-426614174000',
    server: { id: 'second', name: 'Second', type: 'vanilla', minecraftVersion: '26.3', java: { runtimeVersion: '25', requiredMajor: 25 },
      detection: { confidence: 'high', evidence: [], warnings: [] } }, eulaAccepted: false, lifecycleSupported: true, restartRequired: true }, meta });
  const save = vi.spyOn(api, 'registrationSave').mockResolvedValue({ data: { id: 'second', name: 'Second', restartRequired: true }, meta });
  render(<ServerRegistration />);
  return { preview, save };
}
async function fill() {
  await waitFor(() => expect(screen.getByRole('button', { name: '检查实例' })).toBeEnabled());
  for (const [label, value] of [['实例标识', 'second'], ['显示名称', 'Second'], ['服务端目录', 'C:\\MC\\second']])
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: '检查实例' }));
  await screen.findByText('确认登记：Second');
}
it('previews the exact selected directory, requires confirmation, and shows pending loading without starting Java', async () => {
  const f = setup(); await fill();
  expect(f.preview).toHaveBeenCalledWith({ id: 'second', name: 'Second', root: 'C:\\MC\\second', jarFile: 'server.jar', javaProfileId: 'first' });
  expect(screen.getByRole('button', { name: '保存实例' })).toBeDisabled();
  expect(screen.getByText(/EULA 尚未接受/)).toBeVisible();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '保存实例' }));
  fireEvent.click(screen.getByRole('button', { name: '保存实例' }));
  await screen.findByText(/已登记 Second/); expect(f.save).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Second（second）')).toBeVisible();
});
it('invalidates preview after a field edit', async () => {
  setup(); await fill(); fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: 'Other' } });
  expect(screen.queryByRole('button', { name: '保存实例' })).not.toBeInTheDocument();
});
it('does not automatically resubmit an uncertain save', async () => {
  const f = setup(); f.save.mockRejectedValue(new Error('lost response')); await fill();
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: '保存实例' }));
  await screen.findByText(/不会自动重试/); expect(f.save).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '检查实例' })).toBeDisabled();
});
