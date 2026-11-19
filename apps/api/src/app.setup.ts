import { readFileSync } from 'node:fs';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';

import { addProblemDetailsResponses } from './errors/openapi-problems.js';
import { requestIdMiddleware } from './logging/request-id.js';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

/** Builds the OpenAPI document. Also used by the spec export script (C0.7). */
export function buildOpenApiDocument(app: NestExpressApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('TestTix API')
    .setDescription(
      'REST API of TestTix, a sample event ticket shop for software testing practice. ' +
        'Errors are `application/problem+json`; every response carries an `X-Request-Id` header.',
    )
    .setVersion(version)
    .build();
  return addProblemDetailsResponses(cleanupOpenApiDoc(SwaggerModule.createDocument(app, config)));
}

/** App-level setup shared by `main.ts` and the tests, so tests exercise the real configuration. */
export function configureApp(app: NestExpressApplication): void {
  // Registered now, so it runs before the body parser and module middleware added by `init()`.
  app.use(requestIdMiddleware);
  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  SwaggerModule.setup('docs', app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: 'openapi.json',
    customSiteTitle: 'TestTix API docs',
  });
}
