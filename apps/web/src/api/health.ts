/**
 * URL of an API endpoint. The browser calls the API on its own origin under `/api`, which the Vite dev
 * server (and later the production proxy) forwards to the API without the prefix. The absolute URL also
 * works under Node's `fetch` in tests, which rejects relative URLs.
 */
export function apiUrl(path: `/${string}`): URL {
  return new URL(`/api${path}`, window.location.origin);
}

/**
 * `GET /health`: resolves to `true` when the API is up (TanStack Query needs a defined value), rejects
 * otherwise. Replaced by the typed client in C0.7.
 */
export async function fetchApiHealth(signal?: AbortSignal): Promise<true> {
  const response = await fetch(apiUrl('/health'), {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`GET /health returned ${response.status}`);
  }
  return true;
}
