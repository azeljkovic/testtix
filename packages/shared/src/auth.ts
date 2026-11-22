import { z } from 'zod';

export const EMAIL_MAX_LENGTH = 254;
export const NAME_MAX_LENGTH = 100;
export const PASSWORD_MIN_LENGTH = 8;
/** argon2 accepts any length; the cap keeps a single request from hashing megabytes. */
export const PASSWORD_MAX_LENGTH = 128;

/** Header that carries the CSRF token on state-changing requests (double-submit with the cookie). */
export const CSRF_HEADER = 'X-CSRF-Token';
/** Cookie holding the session token. HttpOnly, so scripts can't read it. */
export const SESSION_COOKIE = 'testtix_session';
/** Cookie holding the CSRF token. Readable by scripts, which copy it into `X-CSRF-Token`. */
export const CSRF_COOKIE = 'testtix_csrf';

/** An email address, trimmed and lower-cased (accounts are matched case-insensitively). */
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX_LENGTH)
  .check(z.email())
  .describe('Email address. Surrounding spaces are removed and it is matched case-insensitively.');

export const RegisterRequestSchema = z.strictObject({
  email: EmailSchema,
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH)
    .max(PASSWORD_MAX_LENGTH)
    .describe(`${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters, used exactly as typed`),
  name: z
    .string()
    .trim()
    .min(1)
    .max(NAME_MAX_LENGTH)
    .describe('Display name. Surrounding spaces are removed.'),
});

export const LoginRequestSchema = z.strictObject({
  email: EmailSchema,
  // No minimum length beyond 1: login only checks the password, it never enforces the rules.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

/** Longest token `POST /auth/verify-email` accepts. Real tokens are 43 characters. */
export const VERIFICATION_TOKEN_MAX_LENGTH = 256;

export const VerifyEmailRequestSchema = z.strictObject({
  token: z
    .string()
    .min(1)
    .max(VERIFICATION_TOKEN_MAX_LENGTH)
    .describe('The `token` query parameter of the link in the verification email'),
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;
