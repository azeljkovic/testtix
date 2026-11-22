import {
  type ErrorCode,
  PROBLEM_CONTENT_TYPE,
  PROBLEM_TYPES,
  type ProblemDetails,
  type ProblemFieldError,
} from '@testtix/shared';
import { HttpResponse } from 'msw';

interface ProblemOptions {
  status: number;
  code?: ErrorCode;
  detail?: string;
  errors?: ProblemFieldError[];
}

/** A `problem+json` response like the API's `ProblemDetailsFilter` sends. */
export function problemResponse({ status, code, detail, errors = [] }: ProblemOptions) {
  const body: ProblemDetails = {
    type: code === undefined ? 'about:blank' : PROBLEM_TYPES[code],
    title: code ?? `HTTP ${String(status)}`,
    status,
    detail: detail ?? `Mock problem (${String(status)})`,
    instance: '/mock',
    requestId: 'req-mock',
    errors,
  };
  return HttpResponse.json(body, { status, headers: { 'Content-Type': PROBLEM_CONTENT_TYPE } });
}
