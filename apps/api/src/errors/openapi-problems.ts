import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { PROBLEM_CONTENT_TYPE, ProblemDetailsSchema } from '@testtix/shared';
import { z } from 'zod';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

/**
 * Registers the `ProblemDetails` schema and adds it as the `default` (error) response of every
 * operation, with the `application/problem+json` media type the API actually sends.
 */
export function addProblemDetailsResponses(document: OpenAPIObject): OpenAPIObject {
  // Registry mode emits each schema under its own name with `$ref`s that point into
  // `components.schemas`. Converting the schema alone would nest it under `definitions`.
  const registry = z.registry<{ id: string }>();
  registry.add(ProblemDetailsSchema, { id: 'ProblemDetails' });
  const { schemas } = z.toJSONSchema(registry, {
    target: 'openapi-3.0',
    uri: (id) => `#/components/schemas/${id}`,
  });

  document.components ??= {};
  document.components.schemas ??= {};
  for (const [name, { $id: _id, ...schema }] of Object.entries(schemas)) {
    document.components.schemas[name] = schema as SchemaObject;
  }

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
