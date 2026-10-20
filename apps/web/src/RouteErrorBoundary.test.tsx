import { lazy, Suspense } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RouteErrorBoundary } from './App';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('contains a rejected route chunk while preserving the surrounding interface and hiding raw failures', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const Rejected = lazy(async () => { throw new Error('PRIVATE_CHUNK_SENTINEL'); });
  render(<><nav>Existing navigation</nav><div>Existing authentication</div><RouteErrorBoundary>
    <Suspense fallback={<p>Loading synthetic route</p>}><Rejected /></Suspense>
  </RouteErrorBoundary></>);
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByText('Existing navigation')).toBeInTheDocument();
  expect(screen.getByText('Existing authentication')).toBeInTheDocument();
  expect(screen.queryByText(/PRIVATE_CHUNK_SENTINEL/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /刷新/ })).toBeEnabled();
});
it('renders healthy route content normally without a recovery action', () => {
  render(<RouteErrorBoundary><p>Healthy route</p></RouteErrorBoundary>);
  expect(screen.getByText('Healthy route')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
