import { describe, expect, it } from 'vitest';

import { authPagePath, safeRedirectPath } from './redirect.js';

describe('safeRedirectPath', () => {
  it.each([
    ['/events', '/events'],
    ['/events?category=talk#top', '/events?category=talk#top'],
    ['/account', '/account'],
  ])('keeps the same-origin path %j', (redirectTo, expected) => {
    expect(safeRedirectPath(redirectTo, '/')).toBe(expected);
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['an absolute URL', 'https://evil.example/phish'],
    ['a protocol-relative URL', '//evil.example/phish'],
    ['a backslash trick', '/\\evil.example'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a relative path', 'events'],
    ['the login page', '/login?redirectTo=/account'],
    ['the register page', '/register'],
  ])('falls back for %s', (_case, redirectTo) => {
    expect(safeRedirectPath(redirectTo, '/fallback')).toBe('/fallback');
  });
});

describe('authPagePath', () => {
  it('returns to the given location afterwards', () => {
    expect(authPagePath('/login', { pathname: '/admin', search: '?tab=1', hash: '' })).toBe(
      '/login?redirectTo=%2Fadmin%3Ftab%3D1',
    );
  });

  it('leaves out redirectTo for the home page and for auth pages', () => {
    expect(authPagePath('/register', '/')).toBe('/register');
    expect(authPagePath('/login', '/register?redirectTo=%2Fx')).toBe('/login');
  });
});
