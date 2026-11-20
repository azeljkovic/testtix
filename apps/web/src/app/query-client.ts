import { QueryClient } from '@tanstack/react-query';

/** The app's TanStack Query client. Tests create their own with retries off. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
      },
    },
  });
}
