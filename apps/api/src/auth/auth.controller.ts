import { Body, Controller, Get, Header, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '@testtix/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodResponse } from 'nestjs-zod';

import { AuthCookies } from './auth-cookies.js';
import { CurrentSession, Public } from './auth.decorators.js';
import {
  AuthSessionDto,
  CsrfTokenDto,
  LoginRequestDto,
  RegisterRequestDto,
  toAuthSession,
} from './auth.schemas.js';
import { AuthService, type LoggedIn } from './auth.service.js';
import { type AuthenticatedSession, SessionService } from './session.service.js';

// Every response carries per-user data or fresh tokens, so each one is `Cache-Control: no-store`.
const SETS_SESSION = `Sets the \`${SESSION_COOKIE}\` cookie (HttpOnly, SameSite=Lax) and ends the session the request came with, if any.`;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookies,
    private readonly sessions: SessionService,
  ) {}

  @Get('csrf')
  @Public()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Get a CSRF token',
    description: `Sets the \`${CSRF_COOKIE}\` cookie (readable by scripts, 30 days) and returns the same token. Send it back in the \`${CSRF_HEADER}\` header of every POST, PUT, PATCH and DELETE request, together with the cookie. Returns the existing token when the request already has one, and renews the cookie.`,
  })
  @ZodResponse({ status: 200, type: CsrfTokenDto, description: 'The CSRF token.' })
  csrf(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return { csrfToken: this.cookies.issueCsrf(request, reply) };
  }

  @Post('register')
  @Public()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Create a customer account and log in',
    description: `The new account has the CUSTOMER role and an unverified email address. ${SETS_SESSION} 409 \`email-already-registered\` when the email is taken.`,
  })
  @ZodResponse({ status: 201, type: AuthSessionDto, description: 'Registered and logged in.' })
  async register(
    @Body() body: RegisterRequestDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.respond(reply, await this.auth.register(body, this.cookies.sessionToken(request)));
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Log in with email and password',
    description: `${SETS_SESSION} A wrong password, an unknown email and an account without a password all give the same 401 \`invalid-credentials\`.`,
  })
  @ZodResponse({ status: 200, type: AuthSessionDto, description: 'Logged in.' })
  async login(
    @Body() body: LoginRequestDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.respond(reply, await this.auth.login(body, this.cookies.sessionToken(request)));
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Log out',
    description: `Ends the request's session and clears the \`${SESSION_COOKIE}\` cookie. Succeeds without a session too, so it is safe to repeat.`,
  })
  @ApiNoContentResponse({ description: 'Logged out.' })
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.logout(this.cookies.sessionToken(request));
    this.cookies.clearSession(reply);
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'The logged-in user',
    description: 'Also moves the session expiry forward, like every authenticated request.',
  })
  @ZodResponse({ status: 200, type: AuthSessionDto, description: 'The user and session.' })
  me(@CurrentSession() session: AuthenticatedSession) {
    return toAuthSession(session.user, session.expiresAt);
  }

  private respond(reply: FastifyReply, { user, session }: LoggedIn) {
    this.cookies.setSession(reply, session.token, this.sessions.ttlMs);
    return toAuthSession(user, session.expiresAt);
  }
}
