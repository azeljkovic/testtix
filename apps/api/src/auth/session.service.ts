import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { ClockService } from '../clock/clock.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';
import { uuidv7 } from '../infra/uuid.js';

/** 32 random bytes, base64url-encoded without padding. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * A session's expiry moves forward at most this often. Saves a database write on every request,
 * and means a frozen test clock never moves it.
 */
export const SESSION_SLIDE_INTERVAL_MS = 60_000;

export interface NewSession {
  /** The secret that goes into the session cookie. Only its SHA-256 hash is stored. */
  token: string;
  expiresAt: Date;
}

export interface AuthenticatedSession {
  sessionId: string;
  expiresAt: Date;
  user: User;
  /** Whether this request moved the expiry forward (the cookie should be re-sent). */
  extended: boolean;
}

/**
 * Login sessions, stored in Postgres. The cookie holds a random token; the database holds only
 * its hash, so a leaked database dump can't be replayed as cookies. Expiry is an idle timeout
 * (`SESSION_TTL_HOURS`) that slides forward on use, measured with `ClockService`, so advancing
 * the test clock expires sessions.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get ttlMs(): number {
    return this.config.sessionTtlMs;
  }

  async create(userId: string): Promise<NewSession> {
    const now = await this.clock.now();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    await this.prisma.session.create({
      data: { id: uuidv7(now), userId, tokenHash: hashToken(token), expiresAt, createdAt: now },
    });
    return { token, expiresAt };
  }

  /**
   * The session and user for a cookie token, or `undefined` when the token is malformed,
   * unknown, revoked or expired. Deletes an expired session, and moves a live one's expiry to
   * now + TTL (at most once per `SESSION_SLIDE_INTERVAL_MS`).
   */
  async authenticate(token: string): Promise<AuthenticatedSession | undefined> {
    if (!TOKEN_PATTERN.test(token)) return undefined;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (session === null) return undefined;

    const now = await this.clock.now();
    if (session.expiresAt.getTime() <= now.getTime()) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      return undefined;
    }

    const slidTo = new Date(now.getTime() + this.ttlMs);
    if (slidTo.getTime() - session.expiresAt.getTime() < SESSION_SLIDE_INTERVAL_MS) {
      return {
        sessionId: session.id,
        expiresAt: session.expiresAt,
        user: session.user,
        extended: false,
      };
    }
    // `updateMany` so a session logged out in the meantime counts as gone instead of throwing.
    const { count } = await this.prisma.session.updateMany({
      where: { id: session.id },
      data: { expiresAt: slidTo },
    });
    if (count === 0) return undefined;
    return { sessionId: session.id, expiresAt: slidTo, user: session.user, extended: true };
  }

  /** Ends the session with this token, if there is one. */
  async revoke(token: string): Promise<void> {
    if (!TOKEN_PATTERN.test(token)) return;
    await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
