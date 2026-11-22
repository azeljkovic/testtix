import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '../api/errors.js';

const MAX_RETRIES = 3;

/** The app's TanStack Query client. Tests create their own with retries off. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // A 4xx (not found, invalid query) won't change on a retry; network and 5xx errors might.
        retry: (failures, error) =>
          !(error instanceof ApiError && error.status < 500) && failures < MAX_RETRIES,
      },
    },
  });
}
