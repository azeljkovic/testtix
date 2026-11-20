import { z } from 'zod';

/**
 * Order lifecycle (C4.2, C4.3):
 *
 * - `PENDING_PAYMENT`: created from a hold; the customer is on the payment page.
 * - `PROCESSING`: the payment provider reported a result; a background job is finishing the order.
 * - `CONFIRMED`: paid; the seats are sold and the tickets are issued.
 * - `FAILED`: the payment was declined; the seats are released.
 * - `EXPIRED`: the hold ran out before the order was paid.
 */
export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PROCESSING',
  'CONFIRMED',
  'FAILED',
  'EXPIRED',
] as const;

export const OrderStatusSchema = z.enum(ORDER_STATUSES).meta({ id: 'OrderStatus' });

export type OrderStatus = z.infer<typeof OrderStatusSchema>;
