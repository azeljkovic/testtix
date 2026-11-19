import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodSerializationException } from 'nestjs-zod';

import { PROBLEM_CONTENT_TYPE, toProblemDetails } from './problem-details.js';

/** Global filter: every error leaves the API as `application/problem+json`. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const { method, path, id } = request;
    const problem = toProblemDetails(exception, {
      path,
      // Always a string: `requestIdMiddleware` sets it before any other middleware runs.
      requestId: typeof id === 'string' ? id : '',
    });

    if (problem.status >= 500) {
      const cause =
        exception instanceof ZodSerializationException ? exception.getZodError() : exception;
      this.logger.error(cause instanceof Error ? cause : new Error(String(cause)));
    } else if (!('log' in request)) {
      // Rejected by Express middleware (e.g. malformed JSON) before pino-http could log it.
      this.logger.warn(
        `${method} ${path} rejected with ${problem.status} (request ${problem.requestId}): ${problem.detail}`,
      );
    }

    if (response.headersSent) {
      // Too late to send a body; let Express close the connection.
      response.end();
      return;
    }
    response.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(problem);
  }
}
