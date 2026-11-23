import type { Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { createTransport } from 'nodemailer';

import { AppModule } from '../app.module.js';
import { APP_OPTIONS, configureApp, createHttpAdapter } from '../app.setup.js';
import { type AppConfig, parseConfig } from '../config/config.schema.js';
import { PrismaService } from '../infra/prisma.service.js';
import { REDIS } from '../infra/redis.module.js';
import { MAIL_TRANSPORT } from '../mail/mail.service.js';

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
 * Boots the real app (same modules and `configureApp` as `main.ts`) with Postgres, Redis and SMTP
 * replaced by fakes, for tests that don't need real infrastructure. Tests against real services
 * use `createIntegrationApp()` (`src/testing/integration/`).
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<NestFastifyApplication> {
  const config: AppConfig = parseConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    // BullMQ needs a real Redis.
    WORKER_IN_PROCESS: 'false',
    ...options.env,
  });
  const database = options.database ?? up;
  const redis = options.redis ?? up;

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(PrismaService)
    .useValue({ $queryRaw: database })
    .overrideProvider(REDIS)
    .useValue({ ping: redis, status: 'end', disconnect: () => undefined })
    // Renders messages to JSON instead of connecting to an SMTP server.
    .overrideProvider(MAIL_TRANSPORT)
    .useValue(createTransport({ jsonTransport: true }))
    .compile();
  return startTestingApp(moduleRef);
}

/** Creates and initialises the HTTP app the way `main.ts` does, without listening on a port. */
export async function startTestingApp(moduleRef: TestingModule): Promise<NestFastifyApplication> {
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createHttpAdapter(),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment -- Nest declares its options type as a class; a literal is the documented usage.
    { ...APP_OPTIONS },
  );
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
