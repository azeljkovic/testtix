import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

interface AppProvidersProps {
  queryClient: QueryClient;
  children: ReactNode;
}

/** Providers that sit above the router. Router-dependent providers live in `RootLayout`. */
export function AppProviders({ queryClient, children }: AppProvidersProps) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
