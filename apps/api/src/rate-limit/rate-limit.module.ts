import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { MetricsModule } from '../metrics/metrics.module.js';
import { RATE_LIMIT_GROUP_NAMES } from './rate-limit-groups.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { RateLimitMetrics } from './rate-limit.metrics.js';
import { RateLimitStore } from './rate-limit.store.js';

@Module({ providers: [RateLimitStore], exports: [RateLimitStore] })
export class RateLimitStoreModule {}

/**
 * Rate limits (C5.3): one `@nestjs/throttler` throttler per route group, limits from
 * `RATE_LIMIT_*`, counters in Redis (`RateLimitStore`). `AppModule` imports it before
 * `AuthModule`, so the global `RateLimitGuard` runs before `AuthGuard`. Global, so the per-user
 * route guard (`UserRateLimitGuard`) resolves in any module, and `TestResetService` can clear the
 * counters.
 */
@Global()
@Module({
  imports: [
    MetricsModule,
    RateLimitStoreModule,
    ThrottlerModule.forRootAsync({
      imports: [RateLimitStoreModule],
      inject: [APP_CONFIG, RateLimitStore],
      useFactory: (config: AppConfig, store: RateLimitStore) => ({
        throttlers: RATE_LIMIT_GROUP_NAMES.map((name) => ({
          name,
          limit: config.rateLimit.groups[name].limit,
          ttl: config.rateLimit.groups[name].windowMs,
        })),
        storage: store,
        // `RateLimitGuard` sends `Retry-After` itself (the library would name it per group).
        setHeaders: false,
      }),
    }),
  ],
  providers: [RateLimitMetrics, { provide: APP_GUARD, useClass: RateLimitGuard }],
  exports: [RateLimitMetrics, RateLimitStoreModule],
})
export class RateLimitModule {}
