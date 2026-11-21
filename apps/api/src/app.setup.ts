import { readFileSync } from 'node:fs';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';

import { addProblemDetailsResponses } from './errors/openapi-problems.js';
import { REQUEST_ID_HEADER, requestIdFor } from './logging/request-id.js';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

/** The HTTP adapter shared by `main.ts` and the tests. */
export function createHttpAdapter(): FastifyAdapter {
  return new FastifyAdapter({
    genReqId: requestIdFor,
    // Fastify would otherwise copy the header verbatim; `requestIdFor` validates it first.
    requestIdHeader: false,
  });
}

/** Builds the OpenAPI document. Also used by `pnpm openapi` (`src/openapi/`). */
export function buildOpenApiDocument(app: NestFastifyApplication): OpenAPIObject {
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

/**
 * App-level setup shared by `main.ts` and the tests, so tests exercise the real configuration.
 * Call before `init()` / `listen()`.
 */
export function configureApp(app: NestFastifyApplication): void {
  app.useLogger(app.get(Logger));
  // `onRequest` runs first for every request, including 404s and bodies that fail to parse.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, reply, done) => {
      void reply.header(REQUEST_ID_HEADER, request.id);
      done();
    });
  SwaggerModule.setup('docs', app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: 'openapi.json',
    customSiteTitle: 'TestTix API docs',
  });
}
