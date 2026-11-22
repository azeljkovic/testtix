import { findTestCard, passesLuhn, type TestCard } from './test-cards.js';

export const CARD_FIELDS = ['cardNumber', 'expiry', 'cvc', 'name'] as const;
export type CardField = (typeof CARD_FIELDS)[number];

/** What the customer typed, as strings (missing fields are empty). */
export type CardFormValues = Record<CardField, string>;

export type CardFormErrors = Partial<Record<CardField, string>>;

export type CardFormResult =
  { ok: true; card: TestCard } | { ok: false; values: CardFormValues; errors: CardFormErrors };

export const CARD_MESSAGES = {
  cardNumberRequired: 'Enter the card number',
  cardNumberFormat: 'Enter a card number of 12 to 19 digits',
  cardNumberInvalid: 'Enter a valid card number',
  notATestCard: 'This is not a test card. Use one of the test cards listed on this page',
  expiryRequired: 'Enter the expiry date',
  expiryFormat: 'Enter the expiry date as MM/YY, for example 08/29',
  expired: 'The card has expired',
  cvcRequired: 'Enter the security code',
  cvcFormat: 'Enter the 3 or 4 digit security code',
  nameRequired: 'Enter the name on the card',
  nameTooLong: 'The name on the card must be 100 characters or fewer',
} as const;

/** Reads the posted form body. Anything that isn't a string counts as empty. */
export function readCardForm(body: unknown): CardFormValues {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const read = (field: CardField) => {
    const value = record[field];
    return typeof value === 'string' ? value.trim() : '';
  };
  return {
    cardNumber: read('cardNumber'),
    expiry: read('expiry'),
    cvc: read('cvc'),
    name: read('name'),
  };
}

/** Validates the card form. `now` decides whether the expiry date has passed (UTC month). */
export function validateCardForm(values: CardFormValues, now: Date): CardFormResult {
  const errors: CardFormErrors = {};

  // Spaces and dashes are how people group the digits; anything else is a typo.
  const digits = values.cardNumber.replace(/[\s-]/g, '');
  let card: TestCard | undefined;
  if (digits === '') errors.cardNumber = CARD_MESSAGES.cardNumberRequired;
  else if (!/^\d{12,19}$/.test(digits)) errors.cardNumber = CARD_MESSAGES.cardNumberFormat;
  else if (!passesLuhn(digits)) errors.cardNumber = CARD_MESSAGES.cardNumberInvalid;
  else {
    card = findTestCard(digits);
    if (card === undefined) errors.cardNumber = CARD_MESSAGES.notATestCard;
  }

  const expiry = /^(\d{2})\s*\/\s*(\d{2})$/.exec(values.expiry);
  const month = Number(expiry?.[1]);
  if (values.expiry === '') errors.expiry = CARD_MESSAGES.expiryRequired;
  else if (expiry === null || month < 1 || month > 12) errors.expiry = CARD_MESSAGES.expiryFormat;
  else {
    // A card is valid through the last day of its expiry month.
    const year = 2000 + Number(expiry[2]);
    const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
    if (year * 12 + (month - 1) < current) errors.expiry = CARD_MESSAGES.expired;
  }

  if (values.cvc === '') errors.cvc = CARD_MESSAGES.cvcRequired;
  else if (!/^\d{3,4}$/.test(values.cvc)) errors.cvc = CARD_MESSAGES.cvcFormat;

  if (values.name === '') errors.name = CARD_MESSAGES.nameRequired;
  else if (values.name.length > 100) errors.name = CARD_MESSAGES.nameTooLong;

  if (card !== undefined && Object.keys(errors).length === 0) return { ok: true, card };
  return { ok: false, values, errors };
}
