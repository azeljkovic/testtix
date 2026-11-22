import { type DynamicModule, Module } from '@nestjs/common';

import { ClockModule } from './clock/clock.module.js';
import { AppConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/config.schema.js';
import { DatabaseModule } from './infra/database.module.js';
import { RedisModule } from './infra/redis.module.js';
import { WorkerModule } from './jobs/worker.module.js';
import { LoggingModule } from './logging/logging.module.js';

/**
 * Root module of the standalone worker process (`src/worker.ts`): the background jobs and what
 * they need (config, logs, Postgres, the shared clock), without HTTP.
 */
@Module({})
export class WorkerAppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: WorkerAppModule,
      imports: [
        AppConfigModule.forRoot(config),
        LoggingModule.forRoot('worker'),
        DatabaseModule,
        RedisModule,
        ClockModule,
        WorkerModule,
      ],
    };
  }
}
