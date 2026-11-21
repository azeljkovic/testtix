import { CURRENCY, LOCALE } from './constants.js';

/** Formats an integer amount of cents as a localized currency string, e.g. 4500 → "$45.00". */
export function formatPrice(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new TypeError(`Price must be an integer number of cents, got ${cents}`);
  }
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY }).format(
    cents / 100,
  );
}
