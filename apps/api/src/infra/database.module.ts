import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { describeError } from '../logging/describe-error.js';

/**
 * Postgres connection pool. Only the readiness check uses it until Prisma arrives in C0.5.
 * The pool connects lazily, so the API starts (and `/health` answers) even when Postgres is down.
 */
export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const logger = new Logger('Database');
        const pool = new Pool({
          connectionString: config.databaseUrl,
          max: 2,
          connectionTimeoutMillis: config.healthCheckTimeoutMs,
          idleTimeoutMillis: 10_000,
          application_name: 'testtix-api',
        });
        // Without a listener, an error on an idle client would crash the process.
        pool.on('error', (err) => {
          logger.warn(`Idle Postgres client error: ${describeError(err)}`);
        });
        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
