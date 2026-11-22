import { STATUS_CODES } from 'node:http';

import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import {
  PROBLEM_CONTENT_TYPE,
  PROBLEM_TYPE_BLANK,
  PROBLEM_TYPES,
  type ProblemDetails,
} from '@testtix/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Global filter: JSON errors use the same `application/problem+json` shape as the API.
 * Payment page routes render their own HTML and don't throw for expected outcomes.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const problem = toProblemDetails(exception, {
      instance: request.url.split('?', 1)[0] ?? request.url,
      requestId: request.id,
    });
    if (problem.status >= 500) {
      this.logger.error(exception instanceof Error ? exception : new Error(String(exception)));
    }
    if (reply.sent) return;
    void reply
      .status(problem.status)
      .header('Content-Type', `${PROBLEM_CONTENT_TYPE}; charset=utf-8`)
      .send(problem);
  }
}

export function toProblemDetails(
  exception: unknown,
  base: Pick<ProblemDetails, 'instance' | 'requestId'>,
): ProblemDetails {
  if (exception instanceof ZodValidationException) {
    const error = exception.getZodError();
    return {
      ...base,
      type: PROBLEM_TYPES.VALIDATION_ERROR,
      title: 'Validation failed',
      status: 400,
      detail: 'The request is invalid. See `errors` for each problem.',
      errors:
        error instanceof z.core.$ZodError
          ? error.issues.map((issue) => ({
              path: issue.path.map(String).join('.'),
              code: issue.code,
              message: issue.message,
            }))
          : [],
    };
  }
  const status = statusOf(exception);
  const detail =
    status < 500 && exception instanceof Error
      ? exception.message
      : 'An unexpected error occurred.';
  return {
    ...base,
    type: PROBLEM_TYPE_BLANK,
    title: STATUS_CODES[status] ?? 'Error',
    status,
    detail,
    errors: [],
  };
}

function statusOf(exception: unknown): number {
  if (exception instanceof HttpException) return exception.getStatus();
  // Fastify errors raised before a handler runs, e.g. malformed JSON or an unsupported media type.
  if (exception instanceof Error && 'statusCode' in exception) {
    const { statusCode } = exception;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) return statusCode;
  }
  return 500;
}
