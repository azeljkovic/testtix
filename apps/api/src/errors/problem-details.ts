import { STATUS_CODES } from 'node:http';

import { HttpException } from '@nestjs/common';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** `type` for problems that need no more explanation than their HTTP status (RFC 9457 §4.2.1). */
export const PROBLEM_TYPE_BLANK = 'about:blank';
export const PROBLEM_TYPE_VALIDATION = 'urn:testtix:problem:validation-error';

export const ProblemFieldErrorSchema = z.object({
  path: z
    .string()
    .describe(
      'Dot-separated path of the invalid field, e.g. `items.0.quantity`. Empty for the root.',
    ),
  code: z.string().describe('Zod issue code, e.g. `invalid_type` or `too_small`'),
  message: z.string(),
});

/** Every error response body has this shape (RFC 9457 problem details, plus `requestId` and `errors`). */
export const ProblemDetailsSchema = z
  .object({
    type: z.string().describe('URI that identifies the problem type'),
    title: z.string().describe('Short summary of the problem type'),
    status: z.number().int().describe('HTTP status code'),
    detail: z.string().describe('Explanation of this occurrence'),
    instance: z.string().describe('Request path'),
    requestId: z.string().describe('Same value as the `X-Request-Id` response header'),
    errors: z
      .array(ProblemFieldErrorSchema)
      .describe('Field errors. Empty unless the request failed validation.'),
  })
  .meta({ id: 'ProblemDetails' });

export type ProblemFieldError = z.infer<typeof ProblemFieldErrorSchema>;
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

interface RequestInfo {
  path: string;
  requestId: string;
}

const INTERNAL_ERROR_DETAIL = 'An unexpected error occurred.';

/** Maps anything thrown while handling a request to a problem details body. */
export function toProblemDetails(exception: unknown, request: RequestInfo): ProblemDetails {
  const base = { instance: request.path, requestId: request.requestId, errors: [] };

  if (exception instanceof ZodValidationException) {
    return {
      ...base,
      type: PROBLEM_TYPE_VALIDATION,
      title: 'Validation failed',
      status: 400,
      detail: 'The request is invalid. See `errors` for each problem.',
      errors: toFieldErrors(exception.getZodError()),
    };
  }

  if (exception instanceof ZodSerializationException) {
    // A response that doesn't match its own schema is a server bug, not something to show the client.
    return { ...base, ...statusOnly(500), detail: INTERNAL_ERROR_DETAIL };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return { ...base, ...statusOnly(status), detail: httpExceptionDetail(exception) };
  }

  // Errors from Express middleware (e.g. body-parser's malformed JSON) follow the `http-errors` convention.
  if (isExposableHttpError(exception)) {
    return { ...base, ...statusOnly(exception.status), detail: exception.message };
  }

  return { ...base, ...statusOnly(500), detail: INTERNAL_ERROR_DETAIL };
}

function statusOnly(status: number): Pick<ProblemDetails, 'type' | 'title' | 'status'> {
  return { type: PROBLEM_TYPE_BLANK, title: STATUS_CODES[status] ?? 'Error', status };
}

function httpExceptionDetail(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  if (typeof response === 'object' && 'message' in response) {
    const { message } = response;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.map(String).join('; ');
  }
  return exception.message;
}

function toFieldErrors(error: unknown): ProblemFieldError[] {
  if (!(error instanceof z.core.$ZodError)) return [];
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
    message: issue.message,
  }));
}

function isExposableHttpError(value: unknown): value is { status: number; message: string } {
  if (!(value instanceof Error)) return false;
  const { status, expose } = value as Error & { status?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true;
}
