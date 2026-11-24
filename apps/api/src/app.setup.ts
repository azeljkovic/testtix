import { readFileSync } from 'node:fs';

import fastifyCookie from '@fastify/cookie';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';

import { addAuthDocs } from './auth/openapi-auth.js';
import type { AppConfig } from './config/config.schema.js';
import { addProblemDetailsResponses } from './errors/openapi-problems.js';
import { REQUEST_ID_HEADER, requestIdFor } from './logging/request-id.js';
import { addRateLimitDocs } from './rate-limit/openapi-rate-limit.js';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

/** Application options shared by `main.ts` and the tests. */
export const APP_OPTIONS = {
  // Keeps each JSON body's raw bytes in `request.rawBody`, which webhook signatures are made over.
  rawBody: true,
} as const;

/** The HTTP adapter shared by `main.ts` and the tests. */
export function createHttpAdapter(config: Pick<AppConfig, 'trustProxy'>): FastifyAdapter {
  const adapter = new FastifyAdapter({
    // `request.ip` (rate limits count per client address) from `X-Forwarded-For` behind proxies.
    trustProxy: config.trustProxy,
    genReqId: requestIdFor,
    // Fastify would otherwise copy the header verbatim; `requestIdFor` validates it first.
    requestIdHeader: false,
  });
  // Parses `Cookie` into `request.cookies` and adds `reply.setCookie()` (session and CSRF cookies).
  // Fastify loads plugins when the app starts, so registering here doesn't need an await.
  void adapter.getInstance().register(fastifyCookie);
  return adapter;
}

/** Builds the OpenAPI document. Also used by `pnpm openapi` (`src/openapi/`). */
export function buildOpenApiDocument(app: NestFastifyApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('TestTix API')
    .setDescription(
      'REST API of TestTix, a sample event ticket shop for software testing practice. ' +
        'Errors are `application/problem+json`; every response carries an `X-Request-Id` header. ' +
        'Requests are rate limited per client address (429 `rate-limited` with `Retry-After`); ' +
        "authorised load runs send the server's `X-Load-Test-Key` header to skip the limits.",
    )
    .setVersion(version)
    .build();
  return addRateLimitDocs(
    addAuthDocs(
      addProblemDetailsResponses(cleanupOpenApiDoc(SwaggerModule.createDocument(app, config))),
    ),
  );
}

/** Swagger UI (`/docs`) is the API's only HTML page; it brings its own scripts and styles. */
const DOCS_PATH = /^\/docs(?:[/?#.-]|$)/;

/**
 * Security headers of every API response (C6.5). The API answers JSON, problem+json and PDFs, none
 * of which should be sniffed as something else, framed or allowed to load anything; Swagger UI keeps
 * everything but the policy, which would block it.
 */
export function securityHeadersFor(url: string): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  };
  if (!DOCS_PATH.test(url)) {
    headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'";
  }
  return headers;
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
      void reply.headers(securityHeadersFor(request.url));
      done();
    });
  SwaggerModule.setup('docs', app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: 'openapi.json',
    customSiteTitle: 'TestTix API docs',
  });
}
