import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { describeError } from '../logging/describe-error.js';

/**
 * The Prisma client, injectable by type. It talks to Postgres through `@prisma/adapter-pg`
 * (Prisma 7 has no built-in driver). The pool connects lazily, so the API starts (and `/health`
 * answers) even when Postgres is down.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const logger = new Logger('Database');
    const adapter = new PrismaPg(
      {
        connectionString: config.databaseUrl,
        // pg waits forever for a connection by default; fail the query instead.
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 10_000,
        application_name: 'testtix-api',
      },
      {
        // Without a listener, an error on an idle client would crash the process.
        onPoolError: (err) => {
          logger.warn(`Idle Postgres client error: ${describeError(err)}`);
        },
      },
    );
    super({ adapter });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
