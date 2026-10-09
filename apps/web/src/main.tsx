import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { Authentication } from './components/Authentication';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Authentication><App /></Authentication>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
