import { describe, expect, it } from 'vitest';

import { parsePrice, PRICE_MESSAGES } from './money-input.js';

describe('parsePrice', () => {
  it.each([
    ['0', 0],
    ['25', 2500],
    ['25.5', 2550],
    ['25.05', 2505],
    [' $1,250.00 ', 125_000],
    ['10000', 1_000_000],
  ])('reads %j as %i cents', (text, cents) => {
    expect(parsePrice(text)).toEqual({ ok: true, cents });
  });

  it('asks for a price', () => {
    expect(parsePrice('  ')).toEqual({ ok: false, message: PRICE_MESSAGES.required });
  });

  it.each(['-5', '25.505', '25,5', '1,25', 'abc', '1e3', '.5', '25.'])('refuses %j', (text) => {
    expect(parsePrice(text)).toEqual({ ok: false, message: PRICE_MESSAGES.format });
  });

  it('refuses more than the maximum', () => {
    expect(PRICE_MESSAGES.max).toBe('Price must be at most $10,000.00');
    expect(parsePrice('10000.01')).toEqual({ ok: false, message: PRICE_MESSAGES.max });
  });
});
