import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';

import type { AppConfig } from './config/config.schema.js';
import { WorkerAppModule } from './worker-app.module.js';

/**
 * The standalone worker (`src/worker.ts`), shared with the tests: the background jobs plus an HTTP
 * server with only `GET /health` and `GET /health/ready` (container health checks) and
 * `GET /metrics` (Prometheus). Call
 * `listen()` (or `init()` in tests) on the result.
 */
export async function createWorkerApp(
  config: AppConfig,
  options: { logger?: false } = {},
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    WorkerAppModule.forRoot(config),
    new FastifyAdapter(),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment -- Nest declares its options type as a class; a literal is the documented usage.
    options.logger === false ? { logger: false } : { bufferLogs: true },
  );
  if (options.logger !== false) app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  return app;
}
