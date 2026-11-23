import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { REDIS } from '../infra/redis.module.js';
import { type ClockReading, parseStoredClock, readClock } from './clock-state.js';

/** Redis hash holding the clock overrides. Shared by every API replica and worker. */
export const CLOCK_REDIS_KEY = 'testtix:clock';

// Atomic, so concurrent advances from several replicas all count.
const ADVANCE_SCRIPT = `
if redis.call('HEXISTS', KEYS[1], 'frozenAt') == 1 then
  return redis.call('HINCRBY', KEYS[1], 'frozenAt', ARGV[1])
end
return redis.call('HINCRBY', KEYS[1], 'offsetMs', ARGV[1])
`;

/**
 * The only source of server "now". Never call `Date.now()` or `new Date()` elsewhere in server
 * code (ESLint enforces it).
 *
 * With test mode off it returns the real time and never touches Redis. With test mode on, the
 * test API can freeze it, advance it or reset it, and the state lives in Redis so every replica
 * and worker sees the same time. Each call then costs one Redis round trip, and fails if Redis is
 * unreachable rather than silently falling back to the real time.
 */
@Injectable()
export class ClockService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** The current server time. */
  async now(): Promise<Date> {
    return new Date((await this.read()).nowMs);
  }

  /**
   * The real time, ignoring the test clock. Only for checks against timestamps that other systems
   * stamp with their own real clocks, such as a webhook's signed timestamp (replay window): moving
   * the test clock must not make every such message look stale. Business rules use `now()`.
   */
  realNow(): Date {
    return new Date();
  }

  /** The current server time together with how it was derived. */
  async read(): Promise<ClockReading> {
    const realNowMs = Date.now();
    if (!this.config.testMode) return { mode: 'real', nowMs: realNowMs, offsetMs: 0 };
    const [frozenAt = null, offsetMs = null] = await this.redis.hmget(
      CLOCK_REDIS_KEY,
      'frozenAt',
      'offsetMs',
    );
    return readClock(parseStoredClock(frozenAt, offsetMs), realNowMs);
  }

  /** Stops the clock at `at`. It stays there until advanced or reset. */
  async freezeAt(at: Date): Promise<void> {
    this.assertTestMode();
    const results = await this.redis
      .multi()
      .del(CLOCK_REDIS_KEY)
      .hset(CLOCK_REDIS_KEY, 'frozenAt', at.getTime())
      .exec();
    const failure = results?.find(([err]) => err !== null)?.[0];
    if (results === null || failure) {
      throw new Error('Failed to freeze the clock', { cause: failure });
    }
  }

  /** Moves the clock forward. A frozen clock stays frozen at the later time; a running one keeps running. */
  async advanceBy(ms: number): Promise<void> {
    this.assertTestMode();
    await this.redis.eval(ADVANCE_SCRIPT, 1, CLOCK_REDIS_KEY, ms);
  }

  /** Back to the real time. */
  async reset(): Promise<void> {
    this.assertTestMode();
    await this.redis.del(CLOCK_REDIS_KEY);
  }

  private assertTestMode(): void {
    if (!this.config.testMode) {
      throw new Error('The clock can only be changed in test mode (TESTTIX_TEST_MODE=true)');
    }
  }
}
