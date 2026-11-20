import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { PrismaService } from '../infra/prisma.service.js';
import { REDIS } from '../infra/redis.module.js';
import { describeError } from '../logging/describe-error.js';
import type { DependencyCheck, Readiness } from './health.schemas.js';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Checks every dependency in parallel. Each check is bounded by `HEALTH_CHECK_TIMEOUT_MS`. */
  async readiness(): Promise<Readiness> {
    const [database, redis] = await Promise.all([
      this.check('database', async () => {
        await this.prisma.$queryRaw`SELECT 1`;
      }),
      this.check('redis', async () => {
        await this.redis.ping();
      }),
    ]);
    const status = database.status === 'up' && redis.status === 'up' ? 'ok' : 'error';
    return { status, checks: { database, redis } };
  }

  private async check(name: string, probe: () => Promise<void>): Promise<DependencyCheck> {
    const timeoutMs = this.config.healthCheckTimeoutMs;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`timed out after ${timeoutMs} ms`));
      }, timeoutMs);
    });
    try {
      await Promise.race([probe(), timeout]);
      return { status: 'up' };
    } catch (err) {
      // Details go to the log only: the response is public and shouldn't leak hostnames.
      this.logger.warn(`Readiness check "${name}" failed: ${describeError(err)}`);
      return { status: 'down' };
    } finally {
      clearTimeout(timer);
    }
  }
}
