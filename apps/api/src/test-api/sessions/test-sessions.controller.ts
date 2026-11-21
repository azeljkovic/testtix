import { Body, HttpCode, Post, Res } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { ZodResponse } from 'nestjs-zod';

import { AuthCookies } from '../../auth/auth-cookies.js';
import { SessionService } from '../../auth/session.service.js';
import { TestApiController } from '../test-api.decorator.js';
import { TestSessionRequestDto, TestSessionResponseDto } from './test-sessions.schemas.js';
import { TestSessionsService } from './test-sessions.service.js';

@TestApiController('sessions')
export class TestSessionsController {
  constructor(
    private readonly testSessions: TestSessionsService,
    private readonly cookies: AuthCookies,
    private readonly sessions: SessionService,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create a user with a role and log it in',
    description:
      'Test mode only. Skips registration and login for API-based test setup: creates a new user (ADMIN or CUSTOMER, email verified unless `emailVerified` is false) and a session, sets the session and CSRF cookies, and returns the same tokens in the body. Send both cookies plus the `X-CSRF-Token` header on state-changing requests. Open even when the server has a test API key, since it only adds data.',
  })
  @ZodResponse({ status: 201, type: TestSessionResponseDto, description: 'The user and session.' })
  async create(
    @Body() body: TestSessionRequestDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.testSessions.create(body);
    this.cookies.setSession(reply, result.session.token, this.sessions.ttlMs);
    this.cookies.setCsrf(reply, result.csrfToken);
    return result;
  }
}
