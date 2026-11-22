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
    /**
     * Extra members of this problem type's body (RFC 9457 §3.2), documented by its own schema,
     * e.g. `TicketsUnavailableProblem`. They can't replace the standard members.
     */
    readonly extensions: Readonly<Record<string, unknown>> = {},
  ) {
    super(detail, status);
  }
}

/**
 * A 400 `validation-error` for rules a schema can't check, such as references to other rows or
 * the current time. Same shape as a failed request schema.
 */
export function validationFailed(errors: readonly ProblemFieldError[]): ProblemException {
  return new ProblemException(
    'VALIDATION_ERROR',
    400,
    'Validation failed',
    'The request is invalid. See `errors` for each problem.',
    errors,
  );
}
