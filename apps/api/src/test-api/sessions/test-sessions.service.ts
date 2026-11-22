import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { CSRF_COOKIE, SESSION_COOKIE } from '@testtix/shared';

import { newCsrfToken } from '../../auth/auth-cookies.js';
import { toAuthUser } from '../../auth/auth.schemas.js';
import { emailAlreadyRegistered, isUniqueViolation } from '../../auth/auth.service.js';
import { PasswordService } from '../../auth/password.service.js';
import { SessionService } from '../../auth/session.service.js';
import { ClockService } from '../../clock/clock.service.js';
import type { User } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { uuidv7 } from '../../infra/uuid.js';
import { LOCKED_PASSWORD_HASH } from '../scenarios/scenario-data.js';
import type { TestSessionRequest, TestSessionResponse } from './test-sessions.schemas.js';

/** Creates a user and a logged-in session in one call (`POST /__test/sessions`). */
@Injectable()
export class TestSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  async create(input: TestSessionRequest): Promise<TestSessionResponse> {
    const suffix = randomBytes(4).toString('hex');
    const passwordHash =
      input.password === undefined
        ? LOCKED_PASSWORD_HASH
        : await this.passwords.hash(input.password);
    const now = await this.clock.now();
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          id: uuidv7(now),
          email: input.email ?? `user-${suffix}@session.testtix.test`,
          name: input.name ?? `Test ${input.role === 'ADMIN' ? 'Admin' : 'Customer'} ${suffix}`,
          passwordHash,
          role: input.role,
          emailVerifiedAt: input.emailVerified ? now : null,
          createdAt: now,
          updatedAt: now,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw emailAlreadyRegistered();
      throw err;
    }
    const session = await this.sessions.create(user.id);
    const csrfToken = newCsrfToken();
    return {
      user: toAuthUser(user),
      session: { token: session.token, expiresAt: session.expiresAt.toISOString() },
      csrfToken,
      cookie: `${SESSION_COOKIE}=${session.token}; ${CSRF_COOKIE}=${csrfToken}`,
    };
  }
}
