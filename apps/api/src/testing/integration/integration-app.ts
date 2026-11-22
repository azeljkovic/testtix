import { once } from 'node:events';

import type { Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { inject } from 'vitest';

import { AppModule } from '../../app.module.js';
import { parseConfig } from '../../config/config.schema.js';
import { REDIS } from '../../infra/redis.module.js';
import { startTestingApp } from '../test-app.js';
import './targets-context.js';

export interface IntegrationAppOptions {
  /** Extra or overriding env vars, e.g. `{ DATABASE_URL: ... }` to simulate an outage. */
  env?: Record<string, string>;
  /**
   * Wait until the app's Redis client is connected (default `true`). The client has no offline
   * queue, so until then Redis commands fail and `/health/ready` reports Redis as down.
   * Pass `false` when Redis is meant to be unreachable.
   */
  waitForRedis?: boolean;
  /** Extra controllers, e.g. probe routes that exercise the auth guards. */
  controllers?: Type[];
}

const REDIS_READY_TIMEOUT_MS = 10_000;

/**
 * Boots the real app (same modules and `configureApp` as `main.ts`) against the integration
 * Postgres, Redis and Mailpit. Use with Supertest: `request(app.getHttpServer())`. Close it when the test is done.
 */
export async function createIntegrationApp(
  options: IntegrationAppOptions = {},
): Promise<NestFastifyApplication> {
  const { databaseUrl, redisUrl, smtpUrl } = inject('integration');
  const config = parseConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    SMTP_URL: smtpUrl,
    ...options.env,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
    controllers: options.controllers ?? [],
  }).compile();
  const app = await startTestingApp(moduleRef);
  if (options.waitForRedis ?? true) {
    const redis = app.get<Redis>(REDIS);
    if (redis.status !== 'ready') {
      try {
        await once(redis, 'ready', { signal: AbortSignal.timeout(REDIS_READY_TIMEOUT_MS) });
      } catch (err) {
        await app.close();
        throw new Error(`Redis did not connect within ${REDIS_READY_TIMEOUT_MS} ms`, {
          cause: err,
        });
      }
    }
  }
  return app;
}
