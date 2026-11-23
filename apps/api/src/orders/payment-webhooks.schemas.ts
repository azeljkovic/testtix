import { PaymentEventOutcomeSchema, PaymentWebhookEventSchema } from '@testtix/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const PaymentWebhookAckSchema = z
  .object({
    eventId: z.string().describe('The provider’s event ID (`id` of the body)'),
    outcome: PaymentEventOutcomeSchema.describe(
      '`APPLIED`: the event moved its unpaid order to `PROCESSING`; a job confirms or fails it. `IGNORED`: nothing changed. `REFUND_DUE`: a payment no order can use (the order had expired or already had a result, or the session or amount is not the order’s): recorded and due a refund, never sold.',
    ),
    duplicate: z
      .boolean()
      .describe('True when this event was received before: nothing changed this time.'),
  })
  .meta({ id: 'PaymentWebhookAck' });

export type PaymentWebhookAck = z.infer<typeof PaymentWebhookAckSchema>;

/** For the OpenAPI document only: the handler verifies the raw body before parsing it. */
export class PaymentWebhookEventDto extends createZodDto(
  PaymentWebhookEventSchema.meta({ id: 'PaymentWebhookEvent' }),
) {}
export class PaymentWebhookAckDto extends createZodDto(PaymentWebhookAckSchema) {}
