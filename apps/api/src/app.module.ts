import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';

import { AuthModule } from './auth/auth.module.js';
import { ClockModule } from './clock/clock.module.js';
import { AppConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/config.schema.js';
import { ProblemDetailsFilter } from './errors/problem-details.filter.js';
import { EventsModule } from './events/events.module.js';
import { HealthModule } from './health/health.module.js';
import { HoldsModule } from './holds/holds.module.js';
import { DatabaseModule } from './infra/database.module.js';
import { RedisModule } from './infra/redis.module.js';
import { WorkerModule } from './jobs/worker.module.js';
import { LoggingModule } from './logging/logging.module.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { TestApiModule } from './test-api/test-api.module.js';
import { TicketsModule } from './tickets/tickets.module.js';
import { VenuesModule } from './venues/venues.module.js';
import { WaitingRoomModule } from './waiting-room/waiting-room.module.js';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        LoggingModule.forRoot('api'),
        DatabaseModule,
        RedisModule,
        ClockModule,
        // Registers the global auth and CSRF guards: every route needs a session unless @Public().
        AuthModule,
        HealthModule,
        MetricsModule,
        VenuesModule,
        EventsModule,
        WaitingRoomModule,
        HoldsModule,
        OrdersModule,
        TicketsModule,
        // Background jobs in this process, unless the worker runs on its own (`src/worker.ts`).
        ...(config.workerInProcess ? [WorkerModule] : []),
        // Not even loaded outside test mode, so `/__test/*` is a plain 404 there.
        ...(config.testMode ? [TestApiModule] : []),
      ],
      providers: [
        // Zod schemas validate every request DTO and serialize every @ZodResponse.
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
