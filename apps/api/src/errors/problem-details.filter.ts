import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PROBLEM_CONTENT_TYPE } from '@testtix/shared';
import { ZodSerializationException } from 'nestjs-zod';

import { SESSION_CHALLENGE } from '../auth/auth.guard.js';
import { toProblemDetails } from './problem-details.js';

/** Global filter: every error leaves the API as `application/problem+json`. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const problem = toProblemDetails(exception, {
      path: request.url.split('?', 1)[0] ?? request.url,
      requestId: request.id,
    });

    if (problem.status >= 500) {
      const cause =
        exception instanceof ZodSerializationException ? exception.getZodError() : exception;
      this.logger.error(cause instanceof Error ? cause : new Error(String(cause)));
    }

    if (reply.sent) return;
    // RFC 9110 requires a challenge on every 401. Guards with another scheme set their own first.
    if (problem.status === 401 && !reply.hasHeader('WWW-Authenticate')) {
      void reply.header('WWW-Authenticate', SESSION_CHALLENGE);
    }
    void reply
      .status(problem.status)
      .header('Content-Type', `${PROBLEM_CONTENT_TYPE}; charset=utf-8`)
      .send(problem);
  }
}
