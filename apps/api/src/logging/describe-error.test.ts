import { describe, expect, it } from 'vitest';

import { describeError } from './describe-error.js';

describe('describeError', () => {
  it('uses the message when there is one', () => {
    expect(describeError(new Error('timed out'))).toBe('timed out');
  });

  it('falls back to the code for an AggregateError with an empty message', () => {
    const error = Object.assign(new AggregateError([new Error('a'), new Error('b')]), {
      code: 'ECONNREFUSED',
    });
    expect(describeError(error)).toBe('ECONNREFUSED');
  });

  it('falls back to the name when there is no code', () => {
    expect(describeError(new TypeError(''))).toBe('TypeError');
  });

  it('stringifies non-errors', () => {
    expect(describeError('nope')).toBe('nope');
  });
});
