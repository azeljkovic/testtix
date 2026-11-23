import {
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerRequest,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { LOAD_TEST_KEY_HEADER } from '@testtix/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { ProblemException } from '../errors/problem.exception.js';
import { safeEqual } from '../infra/safe-equal.js';
import {
  describeWindow,
  effectiveGroups,
  isRateLimitGroup,
  RATE_LIMIT_GROUPS,
  RATE_LIMIT_GROUPS_KEY,
  RATE_LIMIT_KEY_PREFIX,
  type RateLimitGroup,
  type RateLimitScope,
} from './rate-limit-groups.js';
import { RateLimitMetrics } from './rate-limit.metrics.js';

const LOAD_TEST_HEADER = LOAD_TEST_KEY_HEADER.toLowerCase();

/**
 * Global guard: counts each request towards its rate-limit groups (one `@nestjs/throttler`
 * throttler per group, counters in Redis) and answers 429 `rate-limited` with `Retry-After` when
 * one is exhausted. It runs before `AuthGuard`, so it counts per client address and also limits
 * requests that fail authentication. Requests with the server's `X-Load-Test-Key` skip it.
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard implements CanActivate {
  /** The groups this guard counts. */
  protected readonly scope: RateLimitScope = 'client';

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly metrics: RateLimitMetrics,
  ) {
    super(options, storage, reflector);
  }

  protected override shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http' || !this.config.rateLimit.enabled) {
      return Promise.resolve(true);
    }
    const expected = this.config.rateLimit.loadTestKey;
    if (expected === undefined) return Promise.resolve(false);
    const provided = context.switchToHttp().getRequest<FastifyRequest>().headers[LOAD_TEST_HEADER];
    return Promise.resolve(typeof provided === 'string' && safeEqual(provided, expected));
  }

  protected override async handleRequest({
    context,
    limit,
    ttl,
    throttler,
    getTracker,
    generateKey,
  }: ThrottlerRequest): Promise<boolean> {
    const group = throttler.name ?? 'default';
    if (!isRateLimitGroup(group) || !this.counts(context, group)) return true;

    const { req, res } = this.getRequestResponse(context);
    const tracker = await getTracker(req, context);
    const key = generateKey(context, tracker, group);
    const { isBlocked, timeToBlockExpire } = await this.storageService.increment(
      key,
      ttl,
      limit,
      ttl,
      group,
    );
    if (!isBlocked) return true;

    this.metrics.rejected(group);
    void (res as FastifyReply).header('Retry-After', String(timeToBlockExpire));
    throw new ProblemException(
      'RATE_LIMITED',
      HttpStatus.TOO_MANY_REQUESTS,
      'Too many requests',
      `Too many requests for ${RATE_LIMIT_GROUPS[group].covers}: the limit is ${String(limit)} per ${describeWindow(ttl)}. Try again in ${String(timeToBlockExpire)} s.`,
    );
  }

  /** One counter per group and client, shared by every route in the group. */
  protected override generateKey(
    _context: ExecutionContext,
    tracker: string,
    name: string,
  ): string {
    return `${RATE_LIMIT_KEY_PREFIX}:${name}:${tracker}`;
  }

  /**
   * Whether this request counts towards `group`. (`ThrottlerGuard` has already skipped `default`
   * on `@NoRateLimit()` routes.) The client tracker is the base class's: the client address, IPv6
   * by its /64 subnet, as Fastify reports it behind `TRUST_PROXY` proxies.
   */
  private counts(context: ExecutionContext, group: RateLimitGroup): boolean {
    if (RATE_LIMIT_GROUPS[group].scope !== this.scope) return false;
    const routeGroups = this.reflector.getAllAndMerge<RateLimitGroup[]>(RATE_LIMIT_GROUPS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return effectiveGroups(routeGroups, false).includes(group);
  }
}

/**
 * Route guard of per-user groups (`@RateLimit('verificationResend')` applies it). Route guards run
 * after the global ones, so `AuthGuard` has loaded the user.
 */
@Injectable()
export class UserRateLimitGuard extends RateLimitGuard {
  protected override readonly scope: RateLimitScope = 'user';

  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const { auth } = req as unknown as FastifyRequest;
    if (auth === undefined) {
      throw new Error('A per-user rate limit needs a session: the route must not be @Public()');
    }
    return Promise.resolve(`user:${auth.user.id}`);
  }
}
