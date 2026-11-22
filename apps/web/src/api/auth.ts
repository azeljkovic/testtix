import type { LoginRequest, RegisterRequest } from '@testtix/shared';

import { api, csrfHeader } from './client.js';
import { unwrap } from './errors.js';
import type { components } from './generated/openapi.js';

export type AuthSession = components['schemas']['AuthSession_Output'];
export type AuthUser = components['schemas']['AuthUser_Output'];

/** `GET /auth/me`: the current session, or `null` when nobody is logged in (401). */
export async function fetchSession(signal?: AbortSignal): Promise<AuthSession | null> {
  const result = await api.GET('/auth/me', { signal });
  if (result.response.status === 401) return null;
  return unwrap(result);
}

export async function login(body: LoginRequest): Promise<AuthSession> {
  return unwrap(await api.POST('/auth/login', { params: { header: await csrfHeader() }, body }));
}

export async function register(body: RegisterRequest): Promise<AuthSession> {
  return unwrap(await api.POST('/auth/register', { params: { header: await csrfHeader() }, body }));
}

export async function logout(): Promise<void> {
  unwrap(await api.POST('/auth/logout', { params: { header: await csrfHeader() } }));
}

export async function verifyEmail(token: string): Promise<void> {
  unwrap(
    await api.POST('/auth/verify-email', {
      params: { header: await csrfHeader() },
      body: { token },
    }),
  );
}

export async function resendVerificationEmail(): Promise<void> {
  unwrap(await api.POST('/auth/verify-email/resend', { params: { header: await csrfHeader() } }));
}
