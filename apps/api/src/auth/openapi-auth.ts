import type { OpenAPIObject, OperationObject } from '@nestjs/swagger';
import { CSRF_COOKIE, CSRF_HEADER, PROBLEM_CONTENT_TYPE, SESSION_COOKIE } from '@testtix/shared';

import { PUBLIC_EXTENSION, SKIP_CSRF_EXTENSION } from './auth.decorators.js';

export const SESSION_SECURITY_SCHEME = 'session';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;
const UNSAFE_METHODS = new Set(['post', 'put', 'patch', 'delete']);

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: { $ref: '#/components/schemas/ProblemDetails' } } },
});

/**
 * Documents what `AuthGuard` and `CsrfGuard` enforce, from the markers `@Public()` and
 * `@SkipCsrf()` leave on each operation (then removes the markers):
 *
 * - Operations without `@Public()` require the session cookie and can answer 401.
 * - State-changing operations without `@SkipCsrf()` take the `X-CSRF-Token` header and can answer 403.
 */
export function addAuthDocs(document: OpenAPIObject): OpenAPIObject {
  document.components ??= {};
  document.components.securitySchemes ??= {};
  document.components.securitySchemes[SESSION_SECURITY_SCHEME] = {
    type: 'apiKey',
    in: 'cookie',
    name: SESSION_COOKIE,
    description:
      'Session cookie set by `POST /auth/login`, `POST /auth/register` or `POST /__test/sessions`.',
  };

  for (const pathItem of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const marked = pathItem[method] as (OperationObject & Record<string, unknown>) | undefined;
      if (marked === undefined) continue;
      const {
        [PUBLIC_EXTENSION]: publicMarker,
        [SKIP_CSRF_EXTENSION]: skipCsrfMarker,
        ...operation
      } = marked;
      pathItem[method] = operation;
      const isPublic = publicMarker === true;
      const skipsCsrf = skipCsrfMarker === true;

      if (!isPublic) {
        operation.security = [{ [SESSION_SECURITY_SCHEME]: [] }];
        operation.responses['401'] ??= problem(
          'No session cookie, or the session has expired or was ended.',
        );
      }
      if (UNSAFE_METHODS.has(method) && !skipsCsrf) {
        operation.parameters ??= [];
        operation.parameters.push({
          name: CSRF_HEADER,
          in: 'header',
          required: true,
          description: `The CSRF token from \`GET /auth/csrf\`. Must equal the \`${CSRF_COOKIE}\` cookie, which must be sent too.`,
          schema: { type: 'string' },
        });
        operation.responses['403'] ??= problem(
          `The \`${CSRF_HEADER}\` header is missing or doesn't match the \`${CSRF_COOKIE}\` cookie (type \`csrf-token-invalid\`).`,
        );
      }
    }
  }
  return document;
}
