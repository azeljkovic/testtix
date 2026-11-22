import { z } from 'zod';

import { MAX_TICKETS_PER_ORDER } from './events.js';
import { ProblemDetailsSchema } from './problems.js';

/**
 * State of a seat on an event's seat map (C3.1), at the server clock:
 *
 * - `AVAILABLE`: on sale and free; can be held. A seat whose hold expired is available again.
 * - `HELD`: in a customer's unexpired hold.
 * - `SOLD`: bought.
 * - `NOT_ON_SALE`: no released batch includes it (yet): not part of the event, or in a batch
 *   scheduled for later.
 */
export const SEAT_STATUSES = ['AVAILABLE', 'HELD', 'SOLD', 'NOT_ON_SALE'] as const;

export const SeatStatusSchema = z.enum(SEAT_STATUSES).meta({ id: 'SeatStatus' });

export type SeatStatus = z.infer<typeof SeatStatusSchema>;

export const HOLD_MESSAGES = {
  empty: 'Choose at least one ticket',
  listedTwice: 'Listed twice',
  tooMany: (max: number) => `You can hold at most ${max} tickets at a time`,
} as const;

const quantity = z
  .number({ error: 'Quantity must be a whole number' })
  .int({ error: 'Quantity must be a whole number' })
  .min(1, { error: 'Quantity must be at least 1' })
  .max(MAX_TICKETS_PER_ORDER.max, {
    error: HOLD_MESSAGES.tooMany(MAX_TICKETS_PER_ORDER.max),
  });

/** Body of `POST /events/{eventId}/holds`. */
export const HoldRequestSchema = z
  .strictObject({
    seats: z
      .array(z.uuid())
      .max(MAX_TICKETS_PER_ORDER.max)
      .default([])
      .superRefine((ids, ctx) => {
        const seen = new Set<string>();
        ids.forEach((id, index) => {
          if (seen.has(id)) {
            ctx.addIssue({ code: 'custom', path: [index], message: HOLD_MESSAGES.listedTwice });
          }
          seen.add(id);
        });
      })
      .describe('Seat IDs (from the seat map) to hold'),
    ga: z
      .array(
        z.strictObject({
          sectionId: z.uuid(),
          quantity: quantity.describe('How many places in this GA section'),
        }),
      )
      .max(MAX_TICKETS_PER_ORDER.max)
      .default([])
      .superRefine((items, ctx) => {
        const seen = new Set<string>();
        items.forEach((item, index) => {
          if (seen.has(item.sectionId)) {
            ctx.addIssue({
              code: 'custom',
              path: [index, 'sectionId'],
              message: HOLD_MESSAGES.listedTwice,
            });
          }
          seen.add(item.sectionId);
        });
      })
      .describe('General-admission places to hold, per GA section'),
  })
  .superRefine((hold, ctx) => {
    const total = holdTicketCount(hold);
    if (total === 0) ctx.addIssue({ code: 'custom', message: HOLD_MESSAGES.empty });
    if (total > MAX_TICKETS_PER_ORDER.max) {
      ctx.addIssue({ code: 'custom', message: HOLD_MESSAGES.tooMany(MAX_TICKETS_PER_ORDER.max) });
    }
  });

export type HoldRequest = z.infer<typeof HoldRequestSchema>;

/** How many tickets a hold request asks for: its seats plus its GA quantities. */
export function holdTicketCount(hold: {
  seats: readonly string[];
  ga: readonly { quantity: number }[];
}): number {
  return hold.seats.length + hold.ga.reduce((sum, item) => sum + item.quantity, 0);
}

/**
 * The 409 `tickets-unavailable` body of `POST /events/{eventId}/holds`: problem details plus what
 * could not be held. Nothing of the request was held.
 */
export const TicketsUnavailableProblemSchema = ProblemDetailsSchema.extend({
  unavailableSeatIds: z
    .array(z.uuid())
    .describe(
      'Requested seats that are sold, in another unexpired hold, or not on sale, in request order',
    ),
  gaShortfalls: z
    .array(
      z.object({
        sectionId: z.uuid(),
        requested: z.number().int(),
        available: z
          .number()
          .int()
          .describe('Places that could be held right now (fewer than requested)'),
      }),
    )
    .describe('Requested GA sections without enough places, in request order'),
}).meta({ id: 'TicketsUnavailableProblem' });

export type TicketsUnavailableProblem = z.infer<typeof TicketsUnavailableProblemSchema>;
