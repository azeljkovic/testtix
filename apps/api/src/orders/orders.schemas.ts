import {
  CreateOrderRequestSchema,
  OrderStatusSchema,
  PageQuerySchema,
  pageSchema,
} from '@testtix/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { HoldItemSchema } from '../holds/holds.schemas.js';

const id = z.uuid();
const count = z.number().int();

const OrderEventSchema = z
  .object({
    id,
    slug: z.string(),
    title: z.string(),
    startsAt: z.iso.datetime(),
    venue: z.object({
      name: z.string(),
      timezone: z.string().describe('IANA time zone; show event times in it'),
    }),
  })
  .meta({ id: 'OrderEvent' });

const status = OrderStatusSchema.describe(
  'At the server clock: an unpaid order whose `expiresAt` has passed is `EXPIRED`, even before a sweep stores that.',
);

export const OrderSummarySchema = z
  .object({
    id,
    status,
    event: OrderEventSchema,
    totalCents: count.describe('Sum of the items’ prices, in US cents'),
    ticketCount: count,
    expiresAt: z.iso.datetime().describe('An order not paid by then (server clock) expires'),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'OrderSummary' });

export const OrderItemSchema = HoldItemSchema.meta({ id: 'OrderItem' });

export const OrderSchema = OrderSummarySchema.extend({
  items: z
    .array(OrderItemSchema)
    .describe(
      'One per ticket, in the venue’s section order, then by row and seat (GA places by price)',
    ),
  paymentUrl: z
    .url()
    .nullable()
    .describe(
      'The payment page: send the customer here. Null unless the order is `PENDING_PAYMENT`, and until the payment provider has answered.',
    ),
  updatedAt: z.iso.datetime(),
  retryAfterMs: count
    .nullable()
    .describe(
      'While the order can still change: wait this long before polling it again (never past `expiresAt` while it is unpaid). Null once the status is final (`CONFIRMED`, `FAILED`, `EXPIRED`).',
    ),
  refundDue: z
    .boolean()
    .describe(
      'True when a payment for this order arrived that it could not use (e.g. after the order expired, or after its payment had failed): the payment is recorded and due a refund, and sold no tickets.',
    ),
}).meta({ id: 'Order' });

export type OrderSummary = z.infer<typeof OrderSummarySchema>;
export type Order = z.infer<typeof OrderSchema>;

export const OrderPageSchema = pageSchema(OrderSummarySchema).meta({ id: 'OrderPage' });
export type OrderPage = z.infer<typeof OrderPageSchema>;

export const OrderIdParamSchema = z.object({ orderId: id });
export const OrderListQuerySchema = PageQuerySchema;

export class CreateOrderRequestDto extends createZodDto(CreateOrderRequestSchema) {}
export class OrderDto extends createZodDto(OrderSchema) {}
export class OrderPageDto extends createZodDto(OrderPageSchema) {}
export class OrderIdParamDto extends createZodDto(OrderIdParamSchema) {}
export class OrderListQueryDto extends createZodDto(OrderListQuerySchema) {}
