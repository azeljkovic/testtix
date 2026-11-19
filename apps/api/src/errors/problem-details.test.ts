import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  PROBLEM_TYPE_BLANK,
  PROBLEM_TYPE_VALIDATION,
  toProblemDetails,
} from './problem-details.js';

const request = { path: '/events/42', requestId: 'req-1' };

describe('toProblemDetails', () => {
  it('maps an HttpException to a status-only problem', () => {
    expect(toProblemDetails(new NotFoundException('Event not found'), request)).toEqual({
      type: PROBLEM_TYPE_BLANK,
      title: 'Not Found',
      status: 404,
      detail: 'Event not found',
      instance: '/events/42',
      requestId: 'req-1',
      errors: [],
    });
  });

  it('uses a string response body as the detail', () => {
    expect(toProblemDetails(new HttpException('Too late', 410), request)).toMatchObject({
      status: 410,
      title: 'Gone',
      detail: 'Too late',
    });
  });

  it('joins an array of messages', () => {
    const exception = new ConflictException({ message: ['Seat A1 is taken', 'Seat A2 is taken'] });
    expect(toProblemDetails(exception, request).detail).toBe('Seat A1 is taken; Seat A2 is taken');
  });

  it('lists every Zod issue for a validation failure', () => {
    const schema = z.object({
      email: z.email(),
      items: z.array(z.object({ quantity: z.number().min(1) })),
    });
    const result = schema.safeParse({ email: 'nope', items: [{ quantity: 0 }] });
    const problem = toProblemDetails(new ZodValidationException(result.error), request);

    expect(problem).toMatchObject({
      type: PROBLEM_TYPE_VALIDATION,
      status: 400,
      title: 'Validation failed',
    });
    expect(problem.errors).toEqual([
      { path: 'email', code: 'invalid_format', message: expect.any(String) as string },
      { path: 'items.0.quantity', code: 'too_small', message: expect.any(String) as string },
    ]);
  });

  it('hides the details of a response serialization failure', () => {
    const result = z.object({ id: z.string() }).safeParse({ id: 1 });
    const problem = toProblemDetails(new ZodSerializationException(result.error), request);
    expect(problem).toMatchObject({ status: 500, title: 'Internal Server Error', errors: [] });
    expect(problem.detail).toBe('An unexpected error occurred.');
  });

  it('maps an exposable http-errors style error (body-parser)', () => {
    const error = Object.assign(new Error('request entity too large'), {
      status: 413,
      expose: true,
    });
    expect(toProblemDetails(error, request)).toMatchObject({
      status: 413,
      title: 'Payload Too Large',
      detail: 'request entity too large',
    });
  });

  it.each([
    ['a plain Error', new Error('connection string postgres://secret')],
    [
      'a non-exposable status error',
      Object.assign(new Error('internal'), { status: 400, expose: false }),
    ],
    ['a thrown string', 'boom'],
    ['undefined', undefined],
  ])('maps %s to a generic 500 without leaking its message', (_label, exception) => {
    expect(toProblemDetails(exception, request)).toMatchObject({
      type: PROBLEM_TYPE_BLANK,
      status: 500,
      title: 'Internal Server Error',
      detail: 'An unexpected error occurred.',
    });
  });
});
