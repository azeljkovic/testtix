import { z } from 'zod';

/** Media type of every API error response. */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** `type` of problems that need no more explanation than their HTTP status (RFC 9457 §4.2.1). */
export const PROBLEM_TYPE_BLANK = 'about:blank';

/**
 * Machine-readable error codes and their problem `type` URIs. The URI is always
 * `urn:testtix:problem:` plus the code in kebab case. Clients branch on these, not on `title` or
 * `detail`, which are for humans. Chunks add a code when they add an error that needs one.
 */
export const PROBLEM_TYPES = {
  VALIDATION_ERROR: 'urn:testtix:problem:validation-error',
  INVALID_CREDENTIALS: 'urn:testtix:problem:invalid-credentials',
  EMAIL_ALREADY_REGISTERED: 'urn:testtix:problem:email-already-registered',
  CSRF_TOKEN_INVALID: 'urn:testtix:problem:csrf-token-invalid',
  VERIFICATION_TOKEN_INVALID: 'urn:testtix:problem:verification-token-invalid',
  VERIFICATION_TOKEN_EXPIRED: 'urn:testtix:problem:verification-token-expired',
  EMAIL_ALREADY_VERIFIED: 'urn:testtix:problem:email-already-verified',
  SLUG_TAKEN: 'urn:testtix:problem:slug-taken',
  VENUE_IN_USE: 'urn:testtix:problem:venue-in-use',
  LAYOUT_LOCKED: 'urn:testtix:problem:layout-locked',
  EVENT_STATUS_CONFLICT: 'urn:testtix:problem:event-status-conflict',
  EVENT_HAS_NO_BATCHES: 'urn:testtix:problem:event-has-no-batches',
  EVENT_ALREADY_STARTED: 'urn:testtix:problem:event-already-started',
  EVENT_HAS_SALES: 'urn:testtix:problem:event-has-sales',
  INVENTORY_ALREADY_RELEASED: 'urn:testtix:problem:inventory-already-released',
  GA_CAPACITY_EXCEEDED: 'urn:testtix:problem:ga-capacity-exceeded',
  EVENT_NOT_ON_SALE: 'urn:testtix:problem:event-not-on-sale',
  TICKETS_UNAVAILABLE: 'urn:testtix:problem:tickets-unavailable',
} as const satisfies Record<string, `urn:testtix:problem:${string}`>;

export type ErrorCode = keyof typeof PROBLEM_TYPES;

export const ERROR_CODES = Object.keys(PROBLEM_TYPES) as readonly ErrorCode[];

export const ProblemFieldErrorSchema = z.object({
  path: z
    .string()
    .describe(
      'Dot-separated path of the invalid field, e.g. `items.0.quantity`. Empty for the root.',
    ),
  code: z.string().describe('Zod issue code, e.g. `invalid_type` or `too_small`'),
  message: z.string(),
});

/** Every API error body has this shape (RFC 9457 problem details, plus `requestId` and `errors`). */
export const ProblemDetailsSchema = z
  .object({
    type: z
      .string()
      .describe(
        'URI that identifies the problem type: `about:blank` or `urn:testtix:problem:<error-code>`',
      ),
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

/** The error code of a problem `type`, or `undefined` for `about:blank` and unknown types. */
export function errorCodeOf(type: string): ErrorCode | undefined {
  return ERROR_CODES.find((code) => PROBLEM_TYPES[code] === type);
}
