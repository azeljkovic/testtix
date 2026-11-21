import {
  CSRF_COOKIE,
  CSRF_HEADER,
  EmailSchema,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  RoleSchema,
  SESSION_COOKIE,
} from '@testtix/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { AuthUserSchema } from '../../auth/auth.schemas.js';

export const TestSessionRequestSchema = z.strictObject({
  role: RoleSchema.describe('Role of the new user'),
  email: EmailSchema.optional().describe(
    'Email of the new user. Default: `user-<random>@session.testtix.test`. 409 `email-already-registered` if taken.',
  ),
  name: z
    .string()
    .trim()
    .min(1)
    .max(NAME_MAX_LENGTH)
    .optional()
    .describe('Default: `Test Customer <random>` or `Test Admin <random>`'),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH)
    .max(PASSWORD_MAX_LENGTH)
    .optional()
    .describe(
      'Lets the user also log in through `POST /auth/login` (e.g. a UI test of the login form). Without it the user has no password and only this session.',
    ),
  emailVerified: z
    .boolean()
    .default(true)
    .describe('Default `true`. Unverified users can log in but not check out.'),
});

export const TestSessionResponseSchema = z.object({
  user: AuthUserSchema,
  session: z.object({
    token: z.string().describe(`Value of the \`${SESSION_COOKIE}\` cookie`),
    expiresAt: z.iso.datetime(),
  }),
  csrfToken: z
    .string()
    .describe(`Value of the \`${CSRF_COOKIE}\` cookie; send it in \`${CSRF_HEADER}\` too`),
  cookie: z
    .string()
    .describe(
      'A ready-made `Cookie` request header with both cookies, for clients without a cookie jar',
    ),
});

export type TestSessionRequest = z.infer<typeof TestSessionRequestSchema>;
export type TestSessionResponse = z.infer<typeof TestSessionResponseSchema>;

export class TestSessionRequestDto extends createZodDto(TestSessionRequestSchema) {}
export class TestSessionResponseDto extends createZodDto(TestSessionResponseSchema) {}
