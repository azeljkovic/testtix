import {
  CSRF_HEADER,
  LoginRequestSchema,
  RegisterRequestSchema,
  RoleSchema,
} from '@testtix/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import type { User } from '../generated/prisma/client.js';

export const AuthUserSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    name: z.string(),
    role: RoleSchema,
    emailVerified: z.boolean().describe('Unverified users can log in but not check out'),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'AuthUser' });

export const AuthSessionSchema = z
  .object({
    user: AuthUserSchema,
    session: z.object({
      expiresAt: z.iso
        .datetime()
        .describe(
          'When the session ends if unused (server clock). Each authenticated request moves it forward.',
        ),
    }),
  })
  .meta({ id: 'AuthSession' });

export const CsrfTokenSchema = z.object({
  csrfToken: z
    .string()
    .describe(`Send it in the \`${CSRF_HEADER}\` header of every POST, PUT, PATCH and DELETE`),
});

export type AuthUser = z.infer<typeof AuthUserSchema>;
export type AuthSession = z.infer<typeof AuthSessionSchema>;

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toAuthSession(user: User, expiresAt: Date): AuthSession {
  return { user: toAuthUser(user), session: { expiresAt: expiresAt.toISOString() } };
}

export class RegisterRequestDto extends createZodDto(RegisterRequestSchema) {}
export class LoginRequestDto extends createZodDto(LoginRequestSchema) {}
export class AuthSessionDto extends createZodDto(AuthSessionSchema) {}
export class CsrfTokenDto extends createZodDto(CsrfTokenSchema) {}
