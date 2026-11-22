import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { ApiExtension, ApiResponse } from '@nestjs/swagger';
import { PROBLEM_CONTENT_TYPE, type Role } from '@testtix/shared';
import type { FastifyRequest } from 'fastify';

import type { User } from '../generated/prisma/client.js';
import type { AuthenticatedSession } from './session.service.js';

export const IS_PUBLIC_KEY = 'testtix:auth:public';
export const ROLES_KEY = 'testtix:auth:roles';
export const SKIP_CSRF_KEY = 'testtix:auth:skip-csrf';

/**
 * OpenAPI extensions the decorators leave on operations, so `addAuthDocs` documents exactly what
 * the guards enforce. `addAuthDocs` removes them from the published spec.
 */
export const PUBLIC_EXTENSION = 'x-testtix-public';
export const SKIP_CSRF_EXTENSION = 'x-testtix-skip-csrf';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `AuthGuard` on routes that require a session. */
    auth?: AuthenticatedSession;
  }
}

/**
 * Opens a route (or every route of a controller) to anonymous callers. Without it, `AuthGuard`
 * answers 401 unless the request has a valid session cookie.
 */
export function Public(): MethodDecorator & ClassDecorator {
  return applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), ApiExtension(PUBLIC_EXTENSION, true));
}

/** Requires a session whose user has one of these roles; others get 403. */
export function Roles(...roles: [Role, ...Role[]]): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(ROLES_KEY, roles),
    ApiResponse({
      status: 403,
      description: `Logged in, but without the ${roles.join(' or ')} role (or the CSRF token is missing or wrong).`,
      content: {
        [PROBLEM_CONTENT_TYPE]: { schema: { $ref: '#/components/schemas/ProblemDetails' } },
      },
    }),
  );
}

/**
 * Exempts state-changing routes from the CSRF check. Only for routes no browser session can
 * reach with ambient credentials, such as the test API (it never reads the session cookie).
 */
export function SkipCsrf(): MethodDecorator & ClassDecorator {
  return applyDecorators(SetMetadata(SKIP_CSRF_KEY, true), ApiExtension(SKIP_CSRF_EXTENSION, true));
}

function authOf(context: ExecutionContext): AuthenticatedSession {
  const { auth } = context.switchToHttp().getRequest<FastifyRequest>();
  if (auth === undefined) {
    throw new Error('No session on this request: the route is @Public() or AuthGuard did not run');
  }
  return auth;
}

/** The logged-in user. Only on routes that require a session (not `@Public()`). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User => authOf(context).user,
);

/** The request's session and user. Only on routes that require a session (not `@Public()`). */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedSession => authOf(context),
);
