import { describe, expect, it } from 'vitest';

import { MAX_RETRY_DELAY_MS, retryDelayMs } from './backoff.js';

describe('retryDelayMs', () => {
  it('waits the base delay before the first retry, then doubles', () => {
    expect([2, 3, 4, 5, 6].map((attempt) => retryDelayMs(attempt, 1000))).toEqual([
      1000, 2000, 4000, 8000, 16_000,
    ]);
  });

  it('caps the delay at 5 minutes', () => {
    expect(retryDelayMs(20, 1000)).toBe(MAX_RETRY_DELAY_MS);
  });

  it.each([0, 1, 2.5])('rejects attempt %s, which is not a retry', (attempt) => {
    expect(() => retryDelayMs(attempt, 1000)).toThrow(RangeError);
  });
});
