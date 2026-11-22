import type { OpenAPIObject, OperationObject, ParameterObject } from '@nestjs/swagger';
import { CSRF_HEADER } from '@testtix/shared';
import { beforeAll, describe, expect, it } from 'vitest';

import { createOpenApiDocument } from '../openapi/openapi-document.js';
import { SESSION_SECURITY_SCHEME } from './openapi-auth.js';

let document: OpenAPIObject;

function operation(path: string, method: 'get' | 'post'): OperationObject {
  const found = document.paths[path]?.[method];
  if (found === undefined) throw new Error(`${method.toUpperCase()} ${path} is not in the spec`);
  return found;
}

function takesCsrfHeader(op: OperationObject): boolean {
  return (op.parameters ?? []).some(
    (parameter) => (parameter as ParameterObject).name === CSRF_HEADER,
  );
}

beforeAll(async () => {
  document = await createOpenApiDocument();
});

describe('auth docs in the OpenAPI spec', () => {
  it('declares the session cookie as a security scheme', () => {
    expect(document.components?.securitySchemes?.[SESSION_SECURITY_SCHEME]).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'testtix_session',
    });
  });

  it('marks routes without @Public() as needing the session, with a 401 response', () => {
    const me = operation('/auth/me', 'get');
    expect(me.security).toEqual([{ [SESSION_SECURITY_SCHEME]: [] }]);
    expect(me.responses).toHaveProperty('401');
  });

  it.each([
    ['/auth/login', 'post'],
    ['/auth/csrf', 'get'],
    ['/health', 'get'],
    ['/__test/sessions', 'post'],
  ] as const)('leaves the public %s open', (path, method) => {
    expect(operation(path, method).security).toBeUndefined();
  });

  it.each(['/auth/register', '/auth/login', '/auth/logout'])(
    'documents the CSRF header and 403 on POST %s',
    (path) => {
      const op = operation(path, 'post');
      expect(takesCsrfHeader(op)).toBe(true);
      expect(op.responses).toHaveProperty('403');
    },
  );

  it.each(['/__test/sessions', '/__test/reset', '/__test/clock'])(
    'documents no CSRF header on the test API (POST %s)',
    (path) => {
      expect(takesCsrfHeader(operation(path, 'post'))).toBe(false);
    },
  );

  it('removes the internal x-testtix-* markers', () => {
    expect(JSON.stringify(document)).not.toContain('x-testtix-');
  });
});
