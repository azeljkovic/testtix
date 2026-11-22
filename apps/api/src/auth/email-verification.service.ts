import { createHash, randomBytes } from 'node:crypto';

import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { ClockService } from '../clock/clock.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { ProblemException } from '../errors/problem.exception.js';
import type { Prisma, User } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';
import { uuidv7 } from '../infra/uuid.js';
import { describeError } from '../logging/describe-error.js';
import { MailService } from '../mail/mail.service.js';

/** 32 random bytes, base64url-encoded without padding: the format of every issued token. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Path of the web app's verification landing page; the link adds `?token=…`. */
export const VERIFY_EMAIL_PATH = '/verify-email';

const HOUR_MS = 60 * 60 * 1000;

type Db = Pick<Prisma.TransactionClient, 'emailVerificationToken'>;

/**
 * Email verification links. A user has at most one link at a time (`email_verification_tokens`):
 * issuing a new one replaces it, so only the latest email works. The link carries a random token;
 * the database stores only its SHA-256 hash. Expiry (`EMAIL_VERIFICATION_TTL_HOURS`) is measured
 * with `ClockService`, so advancing the test clock expires links.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Creates (or replaces) the user's verification token and returns it. Pass a transaction client
   * to issue it together with other writes.
   */
  async issue(userId: string, db: Db = this.prisma): Promise<string> {
    const now = await this.clock.now();
    const token = randomBytes(32).toString('base64url');
    const fields = {
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + this.config.emailVerificationTtlMs),
      usedAt: null,
      updatedAt: now,
    };
    // One statement (INSERT … ON CONFLICT), so concurrent resends can't collide on `user_id`.
    await db.emailVerificationToken.upsert({
      where: { userId },
      create: { id: uuidv7(now), userId, createdAt: now, ...fields },
      update: fields,
    });
    return token;
  }

  /** Sends the verification email with `token`. Rejects when the SMTP server doesn't accept it. */
  async sendEmail(user: Pick<User, 'name' | 'email'>, token: string): Promise<void> {
    const url = new URL(`${this.config.webBaseUrl}${VERIFY_EMAIL_PATH}`);
    url.searchParams.set('token', token);
    await this.mail.send({
      to: { name: user.name, address: user.email },
      template: 'verify-email',
      data: {
        name: user.name,
        verifyUrl: url.toString(),
        expiresIn: formatHours(this.config.emailVerificationTtlMs / HOUR_MS),
      },
    });
  }

  /**
   * Sends the verification email after registration. A delivery failure is logged, not thrown:
   * the account exists either way, and the user can ask for a new email.
   */
  async sendAfterRegistration(user: User, token: string): Promise<void> {
    try {
      await this.sendEmail(user, token);
    } catch (err) {
      this.logger.error(`Verification email to user ${user.id} not sent: ${describeError(err)}`);
    }
  }

  /** Issues a new link for a logged-in, unverified user and emails it. */
  async resend(user: User): Promise<void> {
    if (user.emailVerifiedAt !== null) {
      throw new ProblemException(
        'EMAIL_ALREADY_VERIFIED',
        HttpStatus.CONFLICT,
        'Email already verified',
        'This account has already verified its email address.',
      );
    }
    // TODO(C5.3): rate-limit resends per user.
    const token = await this.issue(user.id);
    try {
      await this.sendEmail(user, token);
    } catch (err) {
      this.logger.error(`Verification email to user ${user.id} not sent: ${describeError(err)}`);
      throw new ServiceUnavailableException(
        'The verification email could not be sent. Try again later.',
      );
    }
  }

  /**
   * Marks the token's user verified. Using a link again succeeds without changes (people click
   * twice), until a newer link replaces it. Unknown, malformed and replaced tokens are a 400
   * `verification-token-invalid`; an unused link past its expiry is a 400
   * `verification-token-expired`.
   */
  async verify(token: string): Promise<void> {
    if (!TOKEN_PATTERN.test(token)) throw invalidToken();
    const tokenHash = hashToken(token);
    const row = await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
    if (row === null) throw invalidToken();
    if (row.usedAt !== null) return;

    const now = await this.clock.now();
    if (row.expiresAt.getTime() <= now.getTime()) {
      throw new ProblemException(
        'VERIFICATION_TOKEN_EXPIRED',
        HttpStatus.BAD_REQUEST,
        'Verification link expired',
        'This verification link has expired. Log in and ask for a new one.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Matching on the hash too: a resend that replaced the token in the meantime wins.
      const { count } = await tx.emailVerificationToken.updateMany({
        where: { id: row.id, tokenHash },
        data: { usedAt: now },
      });
      if (count === 0) throw invalidToken();
      // Keeps the first verification time if the user is somehow verified already.
      await tx.user.updateMany({
        where: { id: row.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: now, updatedAt: now },
      });
    });
  }
}

function invalidToken(): ProblemException {
  return new ProblemException(
    'VERIFICATION_TOKEN_INVALID',
    HttpStatus.BAD_REQUEST,
    'Invalid verification link',
    'This verification link is not valid. It may have been replaced by a newer one.',
  );
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** `1 hour`, `24 hours`. */
export function formatHours(hours: number): string {
  return hours === 1 ? '1 hour' : `${String(hours)} hours`;
}
