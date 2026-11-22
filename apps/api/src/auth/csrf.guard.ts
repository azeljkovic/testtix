import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CSRF_COOKIE, CSRF_HEADER } from '@testtix/shared';
import type { FastifyRequest } from 'fastify';

import { ProblemException } from '../errors/problem.exception.js';
import { safeEqual } from '../infra/safe-equal.js';
import { AuthCookies } from './auth-cookies.js';
import { SKIP_CSRF_KEY } from './auth.decorators.js';

/** Methods that must not change state, so they need no CSRF token. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const CSRF_HEADER_NAME = CSRF_HEADER.toLowerCase();

/**
 * Global double-submit CSRF check: every state-changing request (anything but GET, HEAD and
 * OPTIONS) must send an `X-CSRF-Token` header equal to its `testtix_csrf` cookie, or it gets 403
 * `csrf-token-invalid`. Another site can make a browser send the cookie, but it can't read it, so
 * it can't produce the header. Applies to anonymous requests too (login and register), which
 * stops login CSRF. Routes opt out with `@SkipCsrf()`.
 *
 * Runs after `AuthGuard`, so a request without a valid session gets 401 before 403.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cookies: AuthCookies,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(request.method)) return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(SKIP_CSRF_KEY, targets)) return true;

    const cookie = this.cookies.csrfToken(request);
    const header = request.headers[CSRF_HEADER_NAME];
    if (cookie !== undefined && typeof header === 'string' && safeEqual(header, cookie)) {
      return true;
    }
    throw new ProblemException(
      'CSRF_TOKEN_INVALID',
      403,
      'CSRF token missing or invalid',
      `State-changing requests need an ${CSRF_HEADER} header equal to the ${CSRF_COOKIE} cookie. GET /auth/csrf sets the cookie and returns the token.`,
    );
  }
}
