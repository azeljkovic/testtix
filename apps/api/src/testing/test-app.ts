import type { Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
import { configureApp, createHttpAdapter } from '../app.setup.js';
import { type AppConfig, parseConfig } from '../config/config.schema.js';
import { PG_POOL } from '../infra/database.module.js';
import { REDIS } from '../infra/redis.module.js';

/** Simulates a dependency: resolve for "up", reject or never settle for "down". */
export type FakeProbe = () => Promise<unknown>;

export const up: FakeProbe = () => Promise.resolve();
export const down: FakeProbe = () => Promise.reject(new Error('connection refused'));
export const hangs: FakeProbe = () => new Promise<never>(() => undefined);

export interface TestAppOptions {
  env?: Record<string, string>;
  database?: FakeProbe;
  redis?: FakeProbe;
  /** Extra controllers, e.g. to exercise the global pipe and filter. */
  controllers?: Type[];
}

/**
 * Boots the real app (same modules and `configureApp` as `main.ts`) with Postgres and Redis
 * replaced by fakes, for tests that don't need real infrastructure. Integration tests against
 * real services arrive with the harness in C0.5.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<NestFastifyApplication> {
  const config: AppConfig = parseConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', ...options.env });
  const database = options.database ?? up;
  const redis = options.redis ?? up;

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(PG_POOL)
    .useValue({ query: database, end: () => Promise.resolve() })
    .overrideProvider(REDIS)
    .useValue({ ping: redis, status: 'end', disconnect: () => undefined })
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(createHttpAdapter());
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
