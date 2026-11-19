import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { ConfigValidationError, parseConfig } from './config/config.schema.js';

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

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot(config),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment -- Nest declares its options type as a class; a literal is the documented usage.
    { bufferLogs: true },
  );
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(config.port, config.host);
  app
    .get(Logger)
    .log(
      `TestTix API listening on http://${config.host}:${config.port} (docs at /docs)`,
      'Bootstrap',
    );
}

await bootstrap();
