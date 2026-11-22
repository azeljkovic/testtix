import { BATCH_PRICE_MAX_CENTS, formatPrice } from '@testtix/shared';

const DOLLARS = /^\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

export const PRICE_MESSAGES = {
  required: 'Enter the price',
  format: 'Enter the price in dollars, e.g. 25 or 25.50',
  max: `Price must be at most ${formatPrice(BATCH_PRICE_MAX_CENTS)}`,
} as const;

export type PriceResult = { ok: true; cents: number } | { ok: false; message: string };

/**
 * A ticket price typed in dollars ("25", "25.5", "$1,250.00") as whole cents. Free tickets are
 * "0". At most two decimals: a price is never rounded.
 */
export function parsePrice(text: string): PriceResult {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, message: PRICE_MESSAGES.required };
  const match = DOLLARS.exec(trimmed);
  if (match === null) return { ok: false, message: PRICE_MESSAGES.format };
  const dollars = Number((match[1] ?? '').replaceAll(',', ''));
  const cents = dollars * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (cents > BATCH_PRICE_MAX_CENTS) return { ok: false, message: PRICE_MESSAGES.max };
  return { ok: true, cents };
}
