/**
 * The background worker as its own process: `node dist/worker.js` (`pnpm start:worker`). Run it
 * with `WORKER_IN_PROCESS=false` on the API, so jobs are processed here and the two scale apart.
 * It reads the same environment variables as the API (it ignores `WORKER_IN_PROCESS`).
 */
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { ConfigValidationError, parseConfig } from './config/config.schema.js';
import { WorkerAppModule } from './worker-app.module.js';

async function bootstrap(): Promise<void> {
  let config;
  try {
    config = parseConfig(process.env);
  } catch (err) {
    if (!(err instanceof ConfigValidationError)) throw err;
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(
    WorkerAppModule.forRoot(config),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment -- Nest declares its options type as a class; a literal is the documented usage.
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('TestTix worker started', 'Bootstrap');
}

await bootstrap();
