import { describe, expect, it } from 'vitest';

import { formatCountdown, formatDuration, secondsLeft } from './countdown.js';

describe('secondsLeft', () => {
  it('rounds up, so it reaches 0 only at the deadline', () => {
    expect(secondsLeft(10_000, 0)).toBe(10);
    expect(secondsLeft(10_000, 1)).toBe(10);
    expect(secondsLeft(10_000, 9_001)).toBe(1);
    expect(secondsLeft(10_000, 9_999)).toBe(1);
    expect(secondsLeft(10_000, 10_000)).toBe(0);
  });

  it('is never negative', () => {
    expect(secondsLeft(10_000, 20_000)).toBe(0);
  });
});

describe('formatCountdown', () => {
  it('shows minutes and two-digit seconds', () => {
    expect(formatCountdown(600)).toBe('10:00');
    expect(formatCountdown(545)).toBe('9:05');
    expect(formatCountdown(59)).toBe('0:59');
    expect(formatCountdown(0)).toBe('0:00');
  });

  it('adds hours from an hour up', () => {
    expect(formatCountdown(3600)).toBe('1:00:00');
    expect(formatCountdown(3723)).toBe('1:02:03');
  });
});

describe('formatDuration', () => {
  it('says minutes and seconds in words', () => {
    expect(formatDuration(600)).toBe('10 minutes');
    expect(formatDuration(60)).toBe('1 minute');
    expect(formatDuration(90)).toBe('1 minute 30 seconds');
    expect(formatDuration(1)).toBe('1 second');
    expect(formatDuration(0)).toBe('0 seconds');
  });
});
