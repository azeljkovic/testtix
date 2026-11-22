import { Injectable } from '@nestjs/common';
import type { LoginRequest, RegisterRequest } from '@testtix/shared';

import { ClockService } from '../clock/clock.service.js';
import { ProblemException } from '../errors/problem.exception.js';
import type { User } from '../generated/prisma/client.js';
import { isUniqueViolation } from '../infra/prisma-errors.js';
import { PrismaService } from '../infra/prisma.service.js';
import { uuidv7 } from '../infra/uuid.js';
import { EmailVerificationService } from './email-verification.service.js';
import { PasswordService } from './password.service.js';
import { type NewSession, SessionService } from './session.service.js';

export interface LoggedIn {
  user: User;
  session: NewSession;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly verification: EmailVerificationService,
  ) {}

  /**
   * Creates a customer account (email not yet verified), emails it a verification link and logs
   * it in. `previousToken` (the caller's current session cookie, if any) is ended, so the browser
   * holds one session only. A failed email doesn't fail the registration (see
   * `EmailVerificationService.sendAfterRegistration`).
   */
  async register(input: RegisterRequest, previousToken?: string): Promise<LoggedIn> {
    const passwordHash = await this.passwords.hash(input.password);
    const now = await this.clock.now();
    let user: User;
    let verificationToken: string;
    try {
      [user, verificationToken] = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            id: uuidv7(now),
            email: input.email,
            name: input.name,
            passwordHash,
            role: 'CUSTOMER',
            createdAt: now,
            updatedAt: now,
          },
        });
        return [created, await this.verification.issue(created.id, tx)] as const;
      });
    } catch (err) {
      // The unique index decides, so two concurrent registrations can't both win.
      if (isUniqueViolation(err)) throw emailAlreadyRegistered();
      throw err;
    }
    await this.verification.sendAfterRegistration(user, verificationToken);
    return this.startSession(user, previousToken);
  }

  /**
   * Checks the credentials and starts a new session. Unknown emails, wrong passwords and accounts
   * without a usable password all get the same 401 after the same amount of work.
   */
  async login(input: LoginRequest, previousToken?: string): Promise<LoggedIn> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const valid = await this.passwords.verify(user?.passwordHash, input.password);
    if (user === null || !valid) {
      throw new ProblemException(
        'INVALID_CREDENTIALS',
        401,
        'Invalid credentials',
        'The email address or password is wrong.',
      );
    }
    return this.startSession(user, previousToken);
  }

  async logout(token: string | undefined): Promise<void> {
    if (token !== undefined) await this.sessions.revoke(token);
  }

  private async startSession(user: User, previousToken: string | undefined): Promise<LoggedIn> {
    if (previousToken !== undefined) await this.sessions.revoke(previousToken);
    return { user, session: await this.sessions.create(user.id) };
  }
}

export function emailAlreadyRegistered(): ProblemException {
  return new ProblemException(
    'EMAIL_ALREADY_REGISTERED',
    409,
    'Email already registered',
    'An account with this email address already exists.',
    [{ path: 'email', code: 'email_taken', message: 'An account with this email already exists' }],
  );
}
