import { QueueStatusSchema } from '@testtix/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const nullableMs = z.number().int().nullable();

export const QueueEntrySchema = z
  .object({
    token: z
      .string()
      .describe('Your queue token: poll `GET /queue/{token}` with it. Only works for you.'),
    eventId: z.uuid(),
    status: QueueStatusSchema,
    joinedAt: z.iso.datetime().describe('When you joined (server clock)'),
    salesOpenAt: z.iso.datetime().describe('When sales open: nobody is let in before'),
    position: z
      .number()
      .int()
      .min(1)
      .nullable()
      .describe(
        'Your place in the queue (1 = next in) while `WAITING`; null otherwise. Before sales open there is no position yet: everyone who joins before then is let in in a random order.',
      ),
    queueLength: z.number().int().describe('Customers still waiting for this event'),
    estimatedWaitMs: nullableMs.describe(
      'Roughly how long until you are let in, from `position` and the event’s admission rate, while `WAITING`; null otherwise',
    ),
    retryAfterMs: nullableMs.describe(
      'Wait this long before polling again. Null once `ADMITTED` or `EXPIRED`: stop polling.',
    ),
    admission: z
      .object({
        token: z
          .string()
          .describe(
            'Send it in the `X-Admission-Token` header to `GET /events/{eventId}/seats` and `POST /events/{eventId}/holds`',
          ),
        expiresAt: z.iso.datetime().describe('When the admission ends (server clock)'),
      })
      .nullable()
      .describe('Set while `ADMITTED`'),
  })
  .meta({ id: 'QueueEntry' });

export const QueueTokenParamSchema = z.object({ token: z.string().min(1).max(100) });

export type QueueEntry = z.infer<typeof QueueEntrySchema>;

export class QueueEntryDto extends createZodDto(QueueEntrySchema) {}
export class QueueTokenParamDto extends createZodDto(QueueTokenParamSchema) {}
