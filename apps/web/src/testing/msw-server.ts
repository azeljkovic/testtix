import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import type { components } from '../api/generated/openapi.js';

/** Response bodies from the OpenAPI spec, so a mock that drifts from the API fails the typecheck. */
export type Schemas = components['schemas'];

/** Default API responses for component tests. Override per test with `server.use(...)`. */
export const handlers = [
  http.get('/api/health', () =>
    HttpResponse.json({ status: 'ok' } satisfies Schemas['LivenessDto_Output']),
  ),
];

export const server = setupServer(...handlers);
