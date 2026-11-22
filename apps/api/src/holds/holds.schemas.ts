import {
  EventAvailabilitySchema,
  HoldRequestSchema,
  SeatStatusSchema,
  SectionTypeSchema,
} from '@testtix/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const id = z.uuid();
const count = z.number().int();

// --- Seat map ------------------------------------------------------------------------------

export const SeatMapSeatSchema = z
  .object({
    id: id.describe('Seat ID, as sent in a hold request'),
    number: count.describe('Seat number in the row, from 1'),
    status: SeatStatusSchema,
    priceCents: count
      .nullable()
      .describe('Price in US cents; null when no batch of the event includes the seat'),
  })
  .meta({ id: 'SeatMapSeat' });

export const SeatMapRowSchema = z
  .object({
    label: z.string().describe('Row label, lettered from the front: A, B, …, Z, AA, …'),
    index: count.describe('0-based position of the row, front first'),
    seats: z.array(SeatMapSeatSchema).describe('Every seat of the row, by number'),
  })
  .meta({ id: 'SeatMapRow' });

export const SeatMapSeatedSectionSchema = z
  .object({
    id,
    name: z.string(),
    type: z.literal(SectionTypeSchema.enum.SEATED),
    available: count.describe('Seats that are `AVAILABLE`'),
    rows: z.array(SeatMapRowSchema).describe('Front row first'),
  })
  .meta({ id: 'SeatMapSeatedSection' });

export const SeatMapGaSectionSchema = z
  .object({
    id,
    name: z.string(),
    type: z.literal(SectionTypeSchema.enum.GA),
    capacity: count.describe('Places the section holds'),
    available: count.describe(
      'Released places that are neither sold nor in an unexpired hold: the most a hold can ask for here',
    ),
    prices: z
      .array(z.object({ priceCents: count, available: count }))
      .describe(
        'Available places by price, cheapest first. A hold takes the cheapest available places.',
      ),
  })
  .meta({ id: 'SeatMapGaSection' });

export const SeatMapSchema = z
  .object({
    eventId: id,
    availability: EventAvailabilitySchema.describe(
      'Holds are possible while the event is `ON_SALE` (seat statuses are shown in every state)',
    ),
    maxTicketsPerOrder: count.describe('Most tickets (seats plus GA places) in one hold'),
    holdDurationSec: count.describe('How long a new hold lasts'),
    sections: z
      .array(z.discriminatedUnion('type', [SeatMapSeatedSectionSchema, SeatMapGaSectionSchema]))
      .describe('Every section of the venue, in the venue’s order'),
  })
  .meta({ id: 'SeatMap' });

export type SeatMap = z.infer<typeof SeatMapSchema>;
export type SeatMapSection = SeatMap['sections'][number];

// --- Holds ---------------------------------------------------------------------------------

export const HoldItemSchema = z
  .object({
    inventoryUnitId: id,
    section: z.object({ id, name: z.string(), type: SectionTypeSchema }),
    seat: z
      .object({ id, row: z.string(), number: count })
      .nullable()
      .describe('The seat; null for a GA place'),
    priceCents: count,
  })
  .meta({ id: 'HoldItem' });

export const HoldSchema = z
  .object({
    id,
    eventId: id,
    expiresAt: z.iso.datetime().describe('After this (server clock) the tickets are released'),
    createdAt: z.iso.datetime(),
    totalCents: count.describe('Sum of the items’ prices, in US cents'),
    items: z
      .array(HoldItemSchema)
      .describe(
        'One per ticket, in the venue’s section order, then by row and seat (GA places by price)',
      ),
  })
  .meta({ id: 'Hold' });

export type Hold = z.infer<typeof HoldSchema>;
export type HoldItem = z.infer<typeof HoldItemSchema>;

export const HoldIdParamSchema = z.object({ holdId: id });
export const CurrentHoldQuerySchema = z.strictObject({
  eventId: id
    .optional()
    .describe(
      'The event whose hold to return. Without it: the most recent active hold of any event.',
    ),
});

export class SeatMapDto extends createZodDto(SeatMapSchema) {}
export class HoldDto extends createZodDto(HoldSchema) {}
export class HoldRequestDto extends createZodDto(HoldRequestSchema) {}
export class HoldIdParamDto extends createZodDto(HoldIdParamSchema) {}
export class CurrentHoldQueryDto extends createZodDto(CurrentHoldQuerySchema) {}
