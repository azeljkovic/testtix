import { describe, expect, it } from 'vitest';

import { CARD_MESSAGES, readCardForm, validateCardForm } from './card-form.js';
import { findTestCard, formatCardNumber, passesLuhn, TEST_CARDS } from './test-cards.js';

const NOW = new Date('2026-11-22T12:00:00Z');
const VALID = {
  cardNumber: '4242 4242 4242 4242',
  expiry: '11/26',
  cvc: '123',
  name: 'Ada Lovelace',
};

function errorsFor(override: Partial<typeof VALID>) {
  const result = validateCardForm({ ...VALID, ...override }, NOW);
  return result.ok ? {} : result.errors;
}

describe('TEST_CARDS', () => {
  it('are unique, 16 digits and pass the Luhn check', () => {
    const numbers = TEST_CARDS.map((card) => card.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const number of numbers) {
      expect(number).toMatch(/^\d{16}$/);
      expect(passesLuhn(number)).toBe(true);
    }
  });

  it('cover every behaviour in the plan', () => {
    const behaviours = TEST_CARDS.map((card) => `${card.failureCode ?? 'OK'}/${card.webhook}`);
    expect(behaviours).toEqual([
      'OK/NORMAL',
      'CARD_DECLINED/NORMAL',
      'INSUFFICIENT_FUNDS/NORMAL',
      'OK/NONE',
      'OK/DELAYED',
      'OK/DUPLICATE',
    ]);
  });

  it('formats numbers in groups of four', () => {
    expect(formatCardNumber('4000000000000002')).toBe('4000 0000 0000 0002');
  });
});

describe('passesLuhn', () => {
  it.each([
    ['4242424242424242', true],
    ['4242424242424241', false],
    ['79927398713', true],
    ['', false],
    ['4242x', false],
  ])('%s → %s', (digits, expected) => {
    expect(passesLuhn(digits)).toBe(expected);
  });
});

describe('validateCardForm', () => {
  it('accepts a test card with spaces or dashes and returns it', () => {
    expect(validateCardForm(VALID, NOW)).toEqual({
      ok: true,
      card: findTestCard('4242424242424242'),
    });
    expect(validateCardForm({ ...VALID, cardNumber: '4000-0000-0000-0002' }, NOW)).toMatchObject({
      ok: true,
      card: { failureCode: 'CARD_DECLINED' },
    });
  });

  it.each([
    ['', CARD_MESSAGES.cardNumberRequired],
    ['4242 4242', CARD_MESSAGES.cardNumberFormat],
    ['4242 4242 4242 424x', CARD_MESSAGES.cardNumberFormat],
    ['4242 4242 4242 4241', CARD_MESSAGES.cardNumberInvalid],
    ['5555 5555 5555 4444', CARD_MESSAGES.notATestCard],
  ])('card number %j → %s', (cardNumber, message) => {
    expect(errorsFor({ cardNumber })).toEqual({ cardNumber: message });
  });

  it.each([
    ['', CARD_MESSAGES.expiryRequired],
    ['1126', CARD_MESSAGES.expiryFormat],
    ['13/30', CARD_MESSAGES.expiryFormat],
    ['00/30', CARD_MESSAGES.expiryFormat],
    ['10/26', CARD_MESSAGES.expired],
  ])('expiry %j → %s', (expiry, message) => {
    expect(errorsFor({ expiry })).toEqual({ expiry: message });
  });

  it('treats a card as valid through its whole expiry month, with or without spaces', () => {
    expect(errorsFor({ expiry: '11/26' })).toEqual({});
    expect(errorsFor({ expiry: '01 / 27' })).toEqual({});
  });

  it.each([
    ['', CARD_MESSAGES.cvcRequired],
    ['12', CARD_MESSAGES.cvcFormat],
    ['12a', CARD_MESSAGES.cvcFormat],
    ['12345', CARD_MESSAGES.cvcFormat],
  ])('security code %j → %s', (cvc, message) => {
    expect(errorsFor({ cvc })).toEqual({ cvc: message });
  });

  it('accepts a 4-digit security code', () => {
    expect(errorsFor({ cvc: '1234' })).toEqual({});
  });

  it('requires a name of at most 100 characters', () => {
    expect(errorsFor({ name: '' })).toEqual({ name: CARD_MESSAGES.nameRequired });
    expect(errorsFor({ name: 'x'.repeat(101) })).toEqual({ name: CARD_MESSAGES.nameTooLong });
  });

  it('reports every field at once and returns what was typed', () => {
    const values = { cardNumber: '', expiry: 'soon', cvc: '', name: '' };
    expect(validateCardForm(values, NOW)).toEqual({
      ok: false,
      values,
      errors: {
        cardNumber: CARD_MESSAGES.cardNumberRequired,
        expiry: CARD_MESSAGES.expiryFormat,
        cvc: CARD_MESSAGES.cvcRequired,
        name: CARD_MESSAGES.nameRequired,
      },
    });
  });
});

describe('readCardForm', () => {
  it('trims strings and treats missing or non-string fields as empty', () => {
    expect(readCardForm({ cardNumber: ' 4242 ', expiry: ['x'], name: 'Ada' })).toEqual({
      cardNumber: '4242',
      expiry: '',
      cvc: '',
      name: 'Ada',
    });
    expect(readCardForm(undefined)).toEqual({ cardNumber: '', expiry: '', cvc: '', name: '' });
  });
});
