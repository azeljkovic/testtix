import createClient from 'openapi-fetch';

import type { paths } from './generated/openapi.js';

/**
 * The browser calls the API on its own origin under `/api`, which the Vite dev server (and later the
 * production proxy) forwards to the API without the prefix. The URL is absolute because Node's
 * `fetch`, used in tests, rejects relative URLs.
 */
export const API_BASE_URL = new URL('/api', window.location.origin).href;

/**
 * Typed API client. Paths, parameters, bodies and responses come from the API's OpenAPI spec
 * (`src/api/generated/openapi.ts`, regenerated with `pnpm openapi` from the repo root). Wrap calls in
 * `unwrap()` to get the data or an `ApiError`.
 */
export const api = createClient<paths>({
  baseUrl: API_BASE_URL,
  headers: { Accept: 'application/json' },
  // Looked up on every call, so a `fetch` patched after import (MSW in tests) still applies.
  fetch: (request) => globalThis.fetch(request),
});
