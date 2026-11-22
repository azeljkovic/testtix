import { describe, expect, it } from 'vitest';

import { formatHours } from './email-verification.service.js';

describe('formatHours', () => {
  it.each([
    [1, '1 hour'],
    [24, '24 hours'],
  ])('formats %d as %s', (hours, text) => {
    expect(formatHours(hours)).toBe(text);
  });
});
