import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@testtix/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AuthCookies } from './auth-cookies.js';
import { IS_PUBLIC_KEY, ROLES_KEY } from './auth.decorators.js';
import { SessionService } from './session.service.js';

/** `WWW-Authenticate` challenge of session-protected routes (`ProblemDetailsFilter` adds it to 401s). */
export const SESSION_CHALLENGE = 'Session realm="testtix"';

/**
 * Global guard: every route requires a valid session cookie unless it is `@Public()`, and
 * `@Roles()` routes also require one of the listed roles. The user is loaded from the database on
 * every request, so a role change or a deleted user takes effect at once.
 *
 * - No, unknown or expired session → 401 (and an invalid cookie is cleared).
 * - Valid session, wrong role → 403.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly cookies: AuthCookies,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets)) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const token = this.cookies.sessionToken(request);
    const auth = token === undefined ? undefined : await this.sessions.authenticate(token);
    if (token === undefined || auth === undefined) {
      // The 401 gets `WWW-Authenticate: Session …` from ProblemDetailsFilter.
      if (token !== undefined) this.cookies.clearSession(reply);
      throw new UnauthorizedException(
        token === undefined
          ? 'Log in first: this endpoint needs a session cookie.'
          : 'Your session has expired or was ended. Log in again.',
      );
    }
    if (auth.extended) this.cookies.setSession(reply, token, this.sessions.ttlMs);
    request.auth = auth;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles !== undefined && !roles.includes(auth.user.role)) {
      throw new ForbiddenException(`This endpoint requires the ${roles.join(' or ')} role.`);
    }
    return true;
  }
}
