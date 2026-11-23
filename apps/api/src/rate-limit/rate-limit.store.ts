import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { Redis } from 'ioredis';

import { REDIS } from '../infra/redis.module.js';
import { describeError } from '../logging/describe-error.js';
import { RATE_LIMIT_KEY_PREFIX } from './rate-limit-groups.js';

/*
 * Counts one request in a fixed window: the first request creates the counter with the window as
 * its expiry, later ones only increment it. Returns { hits, milliseconds until the window ends }.
 * Windows run on Redis' own (real) time, so moving the test clock doesn't affect them.
 */
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {hits, ttl}
`;

/** The package doesn't export its record type from the entry point. */
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

const NOT_COUNTED: ThrottlerStorageRecord = {
  totalHits: 0,
  timeToExpire: 0,
  isBlocked: false,
  timeToBlockExpire: 0,
};

/**
 * Rate-limit counters in Redis, shared by every API replica (`@nestjs/throttler` storage). A
 * request over the limit is blocked until its window ends. Without Redis, requests are let through
 * (fail open): the limits protect the shared demo, and are not worth an outage of the whole API.
 */
@Injectable()
export class RateLimitStore implements ThrottlerStorage {
  private readonly logger = new Logger(RateLimitStore.name);
  private failing = false;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** `ttl` is the window in milliseconds; the record's times are in whole seconds (at least 1). */
  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    let hits: number;
    let remainingMs: number;
    try {
      [hits, remainingMs] = (await this.redis.eval(INCREMENT_SCRIPT, 1, key, ttl)) as [
        number,
        number,
      ];
    } catch (err) {
      if (!this.failing) {
        this.failing = true;
        this.logger.warn(
          `Rate limits are not enforced, Redis is unavailable: ${describeError(err)}`,
        );
      }
      return NOT_COUNTED;
    }
    if (this.failing) {
      this.failing = false;
      this.logger.log('Rate limits are enforced again');
    }
    const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
    const isBlocked = hits > limit;
    return {
      totalHits: hits,
      timeToExpire: seconds,
      isBlocked,
      timeToBlockExpire: isBlocked ? seconds : 0,
    };
  }

  /** Deletes every counter (`POST /__test/reset`). */
  async clear(): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${RATE_LIMIT_KEY_PREFIX}:*`,
        'COUNT',
        1000,
      );
      if (keys.length > 0) await this.redis.unlink(...keys);
      cursor = next;
    } while (cursor !== '0');
  }
}
