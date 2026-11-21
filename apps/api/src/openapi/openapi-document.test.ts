import { readFile } from 'node:fs/promises';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../testing/test-app.js';
import { createOpenApiDocument, serializeOpenApiDocument } from './openapi-document.js';

let app: NestFastifyApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Every `$ref` value in a JSON document, e.g. `#/components/schemas/ProblemDetails`. */
function collectRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectRefs);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === '$ref' && typeof child === 'string' ? [child] : collectRefs(child),
  );
}

/** Resolves a local JSON pointer (`#/a/b`), or returns `undefined` if it points nowhere. */
function resolvePointer(document: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  return ref
    .slice(2)
    .split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce<unknown>(
      (node, token) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[token]
          : undefined,
      document,
    );
}

describe('createOpenApiDocument', () => {
  it('builds the document that GET /openapi.json serves, without any infrastructure', async () => {
    app = await createTestApp({ env: { TESTTIX_TEST_MODE: 'true' } });
    const served: unknown = (await request(app.getHttpServer()).get('/openapi.json')).body;

    expect(await createOpenApiDocument()).toEqual(served);
  });

  it('only contains $refs that resolve within the document', async () => {
    const document = await createOpenApiDocument();
    const refs = collectRefs(document);

    expect(refs).toContain('#/components/schemas/ProblemDetails');
    for (const ref of refs) {
      expect(resolvePointer(document, ref), ref).toBeTypeOf('object');
    }
  });

  it('produces the same output on every run', async () => {
    const [first, second] = await Promise.all([createOpenApiDocument(), createOpenApiDocument()]);
    expect(serializeOpenApiDocument(second)).toBe(serializeOpenApiDocument(first));
  });
});

describe('the committed openapi.json', () => {
  it('ends with a newline and uses two-space indentation', async () => {
    const committed = await readFile(new URL('../../openapi.json', import.meta.url), 'utf8');
    expect(committed).toBe(serializeOpenApiDocument(JSON.parse(committed) as never));
  });
});
