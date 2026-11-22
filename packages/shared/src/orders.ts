import { z } from 'zod';

/**
 * Order lifecycle (C4.2, C4.3):
 *
 * - `PENDING_PAYMENT`: created from a hold; the customer is on the payment page.
 * - `PROCESSING`: the payment provider reported a result; a background job is finishing the order.
 * - `CONFIRMED`: paid; the seats are sold and the tickets are issued.
 * - `FAILED`: the payment was declined; the seats are released.
 * - `EXPIRED`: the order wasn't paid while its hold lasted: the hold ran out, or the customer
 *   released or replaced it.
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

/** Statuses an order never leaves. Clients stop polling an order once it reaches one. */
export const FINAL_ORDER_STATUSES = [
  'CONFIRMED',
  'FAILED',
  'EXPIRED',
] as const satisfies readonly OrderStatus[];

export function isFinalOrderStatus(status: OrderStatus): boolean {
  return (FINAL_ORDER_STATUSES as readonly OrderStatus[]).includes(status);
}

/** Body of `POST /orders`: check out one of your holds. */
export const CreateOrderRequestSchema = z.strictObject({
  holdId: z.uuid().describe('Your active hold (`POST /events/{eventId}/holds`)'),
});

export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;
