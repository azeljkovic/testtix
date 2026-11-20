import type { OpenAPIObject } from '@nestjs/swagger';
import { z } from 'zod';

import { PROBLEM_CONTENT_TYPE, ProblemDetailsSchema } from './problem-details.js';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

/**
 * Registers the `ProblemDetails` schema and adds it as the `default` (error) response of every
 * operation, with the `application/problem+json` media type the API actually sends.
 */
export function addProblemDetailsResponses(document: OpenAPIObject): OpenAPIObject {
  const {
    $schema: _ignored,
    id: _id,
    ...schema
  } = z.toJSONSchema(ProblemDetailsSchema, {
    target: 'openapi-3.0',
  }) as Record<string, unknown>;

  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas.ProblemDetails = schema;

  for (const pathItem of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (operation === undefined) continue;
      operation.responses.default ??= {
        description: 'Error. The body is an RFC 9457 problem details object.',
        content: {
          [PROBLEM_CONTENT_TYPE]: { schema: { $ref: '#/components/schemas/ProblemDetails' } },
        },
      };
    }
  }
  return document;
}
