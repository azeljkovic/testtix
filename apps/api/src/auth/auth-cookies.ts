import { randomBytes } from 'node:crypto';

import type { CookieSerializeOptions } from '@fastify/cookie';
import { Inject, Injectable } from '@nestjs/common';
import { CSRF_COOKIE, SESSION_COOKIE } from '@testtix/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';

/** How long the browser keeps the CSRF cookie. `GET /auth/csrf` renews it. */
export const CSRF_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60;

const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Sets and clears the session and CSRF cookies. Lifetimes are sent as `Max-Age` (relative), never
 * `Expires`: the server clock can be frozen or moved in test mode, and an absolute date taken from
 * it would make browsers drop the cookie at once or keep it far too long.
 */
@Injectable()
export class AuthCookies {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  sessionToken(request: FastifyRequest): string | undefined {
    return request.cookies[SESSION_COOKIE];
  }

  setSession(reply: FastifyReply, token: string, maxAgeMs: number): void {
    void reply.setCookie(SESSION_COOKIE, token, {
      ...this.base(),
      httpOnly: true,
      maxAge: Math.floor(maxAgeMs / 1000),
    });
  }

  clearSession(reply: FastifyReply): void {
    void reply.clearCookie(SESSION_COOKIE, { ...this.base(), httpOnly: true });
  }

  /** The request's CSRF cookie, if it holds a well-formed token. */
  csrfToken(request: FastifyRequest): string | undefined {
    const token = request.cookies[CSRF_COOKIE];
    return token !== undefined && CSRF_TOKEN_PATTERN.test(token) ? token : undefined;
  }

  /** Keeps the request's CSRF token (or makes a new one), renews the cookie and returns the token. */
  issueCsrf(request: FastifyRequest, reply: FastifyReply): string {
    const token = this.csrfToken(request) ?? newCsrfToken();
    this.setCsrf(reply, token);
    return token;
  }

  setCsrf(reply: FastifyReply, token: string): void {
    // Not HttpOnly: the web app reads it and echoes it in the X-CSRF-Token header.
    void reply.setCookie(CSRF_COOKIE, token, {
      ...this.base(),
      httpOnly: false,
      maxAge: CSRF_COOKIE_MAX_AGE_SEC,
    });
  }

  private base(): CookieSerializeOptions {
    return { path: '/', sameSite: 'lax', secure: this.config.cookieSecure };
  }
}

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}
