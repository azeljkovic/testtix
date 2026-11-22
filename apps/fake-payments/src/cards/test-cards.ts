import type { PaymentFailureCode } from '@testtix/shared';

/** How the webhook for a payment is delivered. */
export type WebhookBehavior =
  /** Once, right away (retried on failure). */
  | 'NORMAL'
  /** Never: the payment is recorded but the merchant is not told. */
  | 'NONE'
  /** Once, after `DELAYED_WEBHOOK_MS`. */
  | 'DELAYED'
  /** Twice, at the same time, with the same event ID. */
  | 'DUPLICATE';

export interface TestCard {
  /** 16 digits, no spaces. Every number passes the Luhn check. */
  number: string;
  label: string;
  description: string;
  failureCode: PaymentFailureCode | null;
  webhook: WebhookBehavior;
}

/**
 * The cards the payment page accepts; any other number is rejected as "not a test card".
 * Documented in `docs/testing-guide.md` (keep in sync) and listed on the payment page.
 */
export const TEST_CARDS: readonly TestCard[] = [
  {
    number: '4242424242424242',
    label: 'Success',
    description: 'Payment succeeds; the webhook is sent right away.',
    failureCode: null,
    webhook: 'NORMAL',
  },
  {
    number: '4000000000000002',
    label: 'Declined',
    description: 'Payment fails with CARD_DECLINED.',
    failureCode: 'CARD_DECLINED',
    webhook: 'NORMAL',
  },
  {
    number: '4000000000009995',
    label: 'Insufficient funds',
    description: 'Payment fails with INSUFFICIENT_FUNDS.',
    failureCode: 'INSUFFICIENT_FUNDS',
    webhook: 'NORMAL',
  },
  {
    number: '4000000000000077',
    label: 'No webhook',
    description: 'Payment succeeds, but no webhook is ever sent.',
    failureCode: null,
    webhook: 'NONE',
  },
  {
    number: '4000000000000457',
    label: 'Delayed webhook',
    description: 'Payment succeeds; the webhook is sent after a delay (DELAYED_WEBHOOK_MS).',
    failureCode: null,
    webhook: 'DELAYED',
  },
  {
    number: '4000000000000887',
    label: 'Duplicate webhook',
    description: 'Payment succeeds; the same event is delivered twice at the same time.',
    failureCode: null,
    webhook: 'DUPLICATE',
  },
];

export function findTestCard(number: string): TestCard | undefined {
  return TEST_CARDS.find((card) => card.number === number);
}

/** "4242424242424242" → "4242 4242 4242 4242". */
export function formatCardNumber(number: string): string {
  return number.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** The Luhn (mod 10) checksum every real card number passes. */
export function passesLuhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}
