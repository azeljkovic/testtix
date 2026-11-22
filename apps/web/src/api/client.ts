import { CSRF_COOKIE, CSRF_HEADER } from '@testtix/shared';
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

/**
 * The CSRF header for a state-changing request (the spec marks it required on every POST, PUT, PATCH
 * and DELETE, so the typed client asks for it): `api.POST(path, { params: { header: await
 * csrfHeader() } })`. The API checks it against the `testtix_csrf` cookie (double submit).
 */
export async function csrfHeader(): Promise<{ [CSRF_HEADER]: string }> {
  return { [CSRF_HEADER]: await csrfToken() };
}

/** The token in the CSRF cookie, or a new one from `GET /auth/csrf` (which also sets the cookie). */
async function csrfToken(): Promise<string> {
  const fromCookie = readCookie(CSRF_COOKIE);
  if (fromCookie !== undefined) return fromCookie;
  const { data, response } = await api.GET('/auth/csrf');
  if (data === undefined) {
    throw new Error(`Could not get a CSRF token: ${response.status} ${response.statusText}`.trim());
  }
  return data.csrfToken;
}

export function readCookie(name: string): string | undefined {
  for (const pair of document.cookie.split(';')) {
    const [key, ...value] = pair.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}
