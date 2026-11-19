import { describe, expect, it } from 'vitest';

import { formatPrice } from './index.js';

describe('formatPrice', () => {
  it.each([
    [0, '$0.00'],
    [5, '$0.05'],
    [4500, '$45.00'],
    [123456, '$1,234.56'],
  ])('formats %i cents as %s', (cents, expected) => {
    expect(formatPrice(cents)).toBe(expected);
  });

  it('rejects amounts that are not whole cents', () => {
    expect(() => formatPrice(10.5)).toThrow(TypeError);
  });
});
