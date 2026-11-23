import { Body, Controller, Get, Header, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '@testtix/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodResponse } from 'nestjs-zod';

import type { User } from '../generated/prisma/client.js';
import { RateLimit } from '../rate-limit/rate-limit.decorators.js';
import { AuthCookies } from './auth-cookies.js';
import { CurrentSession, CurrentUser, Public } from './auth.decorators.js';
import {
  AuthSessionDto,
  CsrfTokenDto,
  LoginRequestDto,
  RegisterRequestDto,
  toAuthSession,
  VerifyEmailRequestDto,
} from './auth.schemas.js';
import { AuthService, type LoggedIn } from './auth.service.js';
import { EmailVerificationService, VERIFY_EMAIL_PATH } from './email-verification.service.js';
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
    private readonly verification: EmailVerificationService,
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
  @RateLimit('auth')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Create a customer account and log in',
    description: `The new account has the CUSTOMER role and an unverified email address, and is sent a verification email (if sending fails, the account is still created; ask for a new email with \`POST /auth/verify-email/resend\`). ${SETS_SESSION} 409 \`email-already-registered\` when the email is taken.`,
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
  @RateLimit('auth')
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

  @Post('verify-email')
  @Public()
  @RateLimit('auth')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Verify an email address',
    description: `Takes the token from the link in the verification email (\`${VERIFY_EMAIL_PATH}?token=…\` on the web app) and marks its account verified. Needs no session: the link may be opened in another browser. Using a link again succeeds without changes. 400 \`verification-token-invalid\` for an unknown token or one replaced by a newer email; 400 \`verification-token-expired\` for an unused link past its expiry.`,
  })
  @ApiNoContentResponse({ description: 'The email address is verified.' })
  async verifyEmail(@Body() body: VerifyEmailRequestDto): Promise<void> {
    await this.verification.verify(body.token);
  }

  @Post('verify-email/resend')
  @RateLimit('verificationResend')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Send a new verification email',
    description:
      "Emails the logged-in user a new verification link. Links from earlier emails stop working. 409 `email-already-verified` when the user's address is already verified; 429 `rate-limited` after too many resends for this account (`RATE_LIMIT_VERIFICATION_RESEND`, default 3 per 15 minutes); 503 when the email can't be sent.",
  })
  @ApiNoContentResponse({ description: 'The email has been sent.' })
  async resendVerification(@CurrentUser() user: User): Promise<void> {
    await this.verification.resend(user);
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
