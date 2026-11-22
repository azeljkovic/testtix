import { CSRF_HEADER } from '@testtix/shared';
import { http, HttpResponse } from 'msw';

import { type Schemas, server } from './msw-server.js';

type AuthUser = Schemas['AuthUser_Output'];
type AuthSession = Schemas['AuthSession_Output'];

export const customer: AuthUser = {
  id: '01970000-0000-7000-8000-000000000001',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  role: 'CUSTOMER',
  emailVerified: true,
  createdAt: '2026-11-01T10:00:00.000Z',
};

export const admin: AuthUser = {
  ...customer,
  id: '01970000-0000-7000-8000-000000000002',
  email: 'grace@example.com',
  name: 'Grace Hopper',
  role: 'ADMIN',
};

export function sessionFor(user: AuthUser): AuthSession {
  return { user, session: { expiresAt: '2026-11-08T10:00:00.000Z' } };
}

/** Makes `GET /api/auth/me` return a session for `user`. Call before rendering. */
export function logInAs(user: AuthUser): void {
  server.use(http.get('/api/auth/me', () => HttpResponse.json(sessionFor(user))));
}

/** The CSRF header of a request, to check that a mutation sent it. */
export function csrfHeaderOf(request: Request): string | null {
  return request.headers.get(CSRF_HEADER);
}
