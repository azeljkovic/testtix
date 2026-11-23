import { LOCALE, type OrderStatus } from '@testtix/shared';

import type { OrderItem } from '../api/orders.js';
import { seatPlace } from '../seats/selection.js';

/** Short status names, as in the order list. */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  PROCESSING: 'Processing',
  CONFIRMED: 'Confirmed',
  FAILED: 'Payment failed',
  EXPIRED: 'Expired',
};

/** A ticket's place, as printed on it: "Stalls, row B, seat 1" or "General admission – Floor". */
export function ticketPlace({ section, seat }: Pick<OrderItem, 'section' | 'seat'>): string {
  return seat === null
    ? `General admission – ${section.name}`
    : seatPlace(section.name, seat.row, seat.number);
}

/** When an order was placed, in the visitor's own time zone, e.g. "Nov 23, 2026, 6:05 PM". */
export function formatOrderedAt(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}
