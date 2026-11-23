import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { OpenAPIObject } from '@nestjs/swagger';

import { AppModule } from '../app.module.js';
import { buildOpenApiDocument, createHttpAdapter } from '../app.setup.js';
import { parseConfig } from '../config/config.schema.js';

/**
 * Builds the OpenAPI document without starting the API. Test mode is on, so the test API
 * (`/__test/*`, tag `test`) is documented too. Nest's preview mode resolves the module
 * graph and routes but creates no providers, so nothing connects to Postgres or Redis and the
 * process environment is ignored. The result is the document `GET /openapi.json` serves in test mode.
 */
export async function createOpenApiDocument(): Promise<OpenAPIObject> {
  const config = parseConfig({ LOG_LEVEL: 'silent', TESTTIX_TEST_MODE: 'true' });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config),
    createHttpAdapter(config),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment -- Nest declares its options type as a class; a literal is the documented usage.
    { preview: true, logger: false },
  );
  // No `app.close()`: with no providers created, there is nothing to shut down, and the shutdown
  // hooks would run against uninitialised instances.
  return buildOpenApiDocument(app);
}

/** The committed `openapi.json` format: two-space indent and a trailing newline. */
export function serializeOpenApiDocument(document: OpenAPIObject): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
