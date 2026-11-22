import { HttpException } from '@nestjs/common';
import type { ErrorCode, ProblemFieldError } from '@testtix/shared';

/**
 * An HTTP error with an app-specific problem type (`urn:testtix:problem:<code>`). Throw it when
 * clients need to tell this error apart from others with the same status; for errors the status
 * explains on its own, throw a plain Nest `HttpException` (type `about:blank`).
 */
export class ProblemException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    status: number,
    readonly title: string,
    detail: string,
    readonly fieldErrors: readonly ProblemFieldError[] = [],
  ) {
    super(detail, status);
  }
}
