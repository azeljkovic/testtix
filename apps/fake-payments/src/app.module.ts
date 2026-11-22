import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';

import { AppConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/config.schema.js';
import { HealthController } from './health.controller.js';
import { CLOCK, systemClock } from './infra/clock.js';
import { LoggingModule } from './infra/logging.module.js';
import { ProblemDetailsFilter } from './infra/problem-details.filter.js';
import { SessionsModule } from './sessions/sessions.module.js';

/** Provides the `Clock`; tests override `CLOCK` to move time. */
@Global()
@Module({ providers: [{ provide: CLOCK, useValue: systemClock }], exports: [CLOCK] })
class ClockModule {}

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        LoggingModule.forRoot(),
        ClockModule,
        SessionsModule,
      ],
      controllers: [HealthController],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
