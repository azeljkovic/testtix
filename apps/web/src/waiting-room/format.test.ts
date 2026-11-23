import { describe, expect, it } from 'vitest';

import { formatLongCountdown, formatWait, positionSentence } from './format.js';

describe('formatWait', () => {
  it.each([
    [0, 'Any moment now'],
    [-500, 'Any moment now'],
    [1, 'About 1 second'],
    [1000, 'About 1 second'],
    [1001, 'About 2 seconds'],
    [45_000, 'About 45 seconds'],
    [59_400, 'About 1 minute'],
    [60_000, 'About 1 minute'],
    [89_000, 'About 1 minute'],
    [90_000, 'About 2 minutes'],
    [5_400_000, 'About 90 minutes'],
  ])('%i ms → %s', (ms, text) => {
    expect(formatWait(ms)).toBe(text);
  });
});

describe('positionSentence', () => {
  it('says who is next, and everyone else’s number', () => {
    expect(positionSentence(1)).toBe('You’re next in the queue.');
    expect(positionSentence(2)).toBe('You’re number 2 in the queue.');
    expect(positionSentence(1234)).toBe('You’re number 1,234 in the queue.');
  });
});

describe('formatLongCountdown', () => {
  it.each([
    [65, '1:05'],
    [3723, '1:02:03'],
    [86_400, '1 day, 0:00'],
    [2 * 86_400 + 3 * 3600 + 4 * 60 + 5, '2 days, 3:04:05'],
  ])('%i s → %s', (seconds, text) => {
    expect(formatLongCountdown(seconds)).toBe(text);
  });
});
