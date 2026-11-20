import { describe, expect, it } from 'vitest';

import {
  ERROR_CODES,
  errorCodeOf,
  PROBLEM_TYPE_BLANK,
  PROBLEM_TYPES,
  ProblemDetailsSchema,
} from './problems.js';

describe('PROBLEM_TYPES', () => {
  it.each(ERROR_CODES)('maps %s to urn:testtix:problem:<kebab-case code>', (code) => {
    expect(PROBLEM_TYPES[code]).toBe(
      `urn:testtix:problem:${code.toLowerCase().replaceAll('_', '-')}`,
    );
  });

  it('has a distinct type for every code', () => {
    expect(new Set(Object.values(PROBLEM_TYPES)).size).toBe(ERROR_CODES.length);
  });
});

describe('errorCodeOf', () => {
  it('returns the code of a known problem type', () => {
    expect(errorCodeOf('urn:testtix:problem:validation-error')).toBe('VALIDATION_ERROR');
  });

  it.each([PROBLEM_TYPE_BLANK, 'urn:testtix:problem:unknown', ''])(
    'returns undefined for %j',
    (type) => {
      expect(errorCodeOf(type)).toBeUndefined();
    },
  );
});

describe('ProblemDetailsSchema', () => {
  const problem = {
    type: PROBLEM_TYPES.VALIDATION_ERROR,
    title: 'Validation failed',
    status: 400,
    detail: 'The request is invalid. See `errors` for each problem.',
    instance: '/orders',
    requestId: 'req-1',
    errors: [{ path: 'items.0.quantity', code: 'too_small', message: 'Too small' }],
  };

  it('accepts a complete problem', () => {
    expect(ProblemDetailsSchema.parse(problem)).toEqual(problem);
  });

  it.each(['type', 'title', 'status', 'detail', 'instance', 'requestId', 'errors'] as const)(
    'rejects a problem without %s',
    (field) => {
      const { [field]: _removed, ...rest } = problem;
      expect(ProblemDetailsSchema.safeParse(rest).success).toBe(false);
    },
  );

  it('rejects a non-integer status', () => {
    expect(ProblemDetailsSchema.safeParse({ ...problem, status: 400.5 }).success).toBe(false);
  });
});
