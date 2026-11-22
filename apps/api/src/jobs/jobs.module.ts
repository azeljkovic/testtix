import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';

/** Prefix of every BullMQ key in Redis, next to the other `testtix:*` keys. */
export const QUEUE_PREFIX = 'testtix:bull';

/**
 * BullMQ's shared connection settings (C3.2). Queues and workers open their own Redis connections
 * (workers need blocking ones), separate from the app's `REDIS` client.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        prefix: QUEUE_PREFIX,
        connection: { url: config.redisUrl, connectionName: 'testtix-jobs' },
      }),
    }),
  ],
})
export class JobsModule {}
