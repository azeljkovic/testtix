/** Pages a successful login or registration must not send people back to. */
const AUTH_PAGES = new Set(['/login', '/register']);

interface LocationLike {
  pathname: string;
  search: string;
  hash: string;
}

/**
 * The `redirectTo` query parameter as a same-origin path, or `fallback`. Anything that would leave
 * the site (`https://…`, `//evil.example`, `/\evil.example`) or loop back to a login page is ignored.
 */
export function safeRedirectPath(redirectTo: string | null, fallback: string): string {
  if (redirectTo === null || !redirectTo.startsWith('/')) return fallback;
  let url: URL;
  try {
    url = new URL(redirectTo, window.location.origin);
  } catch {
    return fallback;
  }
  if (url.origin !== window.location.origin || AUTH_PAGES.has(url.pathname)) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Link to an auth page (`/login`, `/register`) that returns to `from` afterwards. */
export function authPagePath(page: '/login' | '/register', from: LocationLike | string): string {
  const target = typeof from === 'string' ? from : `${from.pathname}${from.search}${from.hash}`;
  const redirectTo = safeRedirectPath(target, '/');
  return redirectTo === '/' ? page : `${page}?${new URLSearchParams({ redirectTo }).toString()}`;
}
