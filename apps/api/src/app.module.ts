import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';

import { AppConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/config.schema.js';
import { ProblemDetailsFilter } from './errors/problem-details.filter.js';
import { HealthModule } from './health/health.module.js';
import { DatabaseModule } from './infra/database.module.js';
import { RedisModule } from './infra/redis.module.js';
import { LoggingModule } from './logging/logging.module.js';
import { MetricsModule } from './metrics/metrics.module.js';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        LoggingModule,
        DatabaseModule,
        RedisModule,
        HealthModule,
        MetricsModule,
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
