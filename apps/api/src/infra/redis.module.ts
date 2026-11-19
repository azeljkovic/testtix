import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { describeError } from '../logging/describe-error.js';

/**
 * Shared Redis client. It reconnects in the background, and commands fail fast while it is
 * disconnected (no offline queue), so the readiness check reports "down" instead of hanging.
 */
export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const logger = new Logger('Redis');
        const redis = new Redis(config.redisUrl, {
          connectionName: 'testtix-api',
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: config.healthCheckTimeoutMs,
          retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
        });
        // Log an outage once, not on every reconnect attempt.
        let failing = false;
        redis.on('error', (err: Error) => {
          if (failing) return;
          failing = true;
          logger.warn(`Redis connection error: ${describeError(err)}`);
        });
        redis.on('ready', () => {
          if (!failing) return;
          failing = false;
          logger.log('Redis connection restored');
        });
        return redis;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'ready') {
      await this.redis.quit();
    } else {
      this.redis.disconnect();
    }
  }
}
