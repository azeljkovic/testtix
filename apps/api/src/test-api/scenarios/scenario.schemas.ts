import {
  ADMISSION_RATE_PER_SEC,
  ADMISSION_TOKEN_TTL_SEC,
  EventCategorySchema,
  EventStatusSchema,
  HOLD_DURATION_SEC,
  SectionTypeSchema,
} from '@testtix/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { TestSessionResponseSchema } from '../sessions/test-sessions.schemas.js';

const id = z.uuid();

export const ScenarioVenueSchema = z
  .object({
    id,
    slug: z.string(),
    name: z.string(),
    sections: z.array(
      z.object({
        id,
        name: z.string(),
        type: SectionTypeSchema,
        capacity: z.number().int().nullable().describe('GA sections only: how many places'),
      }),
    ),
  })
  .meta({ id: 'ScenarioVenue' });

export const ScenarioEventSchema = z
  .object({
    id,
    slug: z.string(),
    title: z.string(),
    category: EventCategorySchema,
    status: EventStatusSchema,
    venueId: id,
    startsAt: z.iso.datetime(),
    salesOpenAt: z.iso.datetime(),
    holdDurationSec: z.number().int().describe('How long a hold lasts'),
    maxTicketsPerOrder: z.number().int().describe('Most tickets in one hold or order'),
    waitingRoomEnabled: z
      .boolean()
      .describe('A ticket drop: customers queue first (`POST /events/{eventId}/queue`)'),
    admissionRatePerSec: z
      .number()
      .int()
      .describe('Customers the waiting room lets in per second of server time'),
    admissionTokenTtlSec: z.number().int().describe('How long an admission lasts'),
    tickets: z
      .object({
        total: z.number().int(),
        available: z.number().int(),
        held: z.number().int(),
        sold: z.number().int(),
      })
      .describe('Inventory units (seats and GA places) of the event, by status'),
  })
  .meta({ id: 'ScenarioEvent' });

export const ScenarioBuyerSchema = z
  .object({
    id,
    email: z.email(),
  })
  .describe('The customer who bought the sold tickets. Has no password: you cannot log in as them.')
  .meta({ id: 'ScenarioBuyer' });

export const ScenarioSeatSchema = z
  .object({
    id,
    sectionId: id,
    row: z.string(),
    number: z.number().int(),
    inventoryUnitId: id,
    priceCents: z.number().int(),
  })
  .meta({ id: 'ScenarioSeat' });

export const ScenarioGaSectionSchema = z
  .object({
    id,
    name: z.string(),
    capacity: z.number().int(),
    available: z.number().int().describe('Places that can be held'),
    prices: z
      .array(z.object({ priceCents: z.number().int(), available: z.number().int() }))
      .describe('Available places by price, cheapest first'),
  })
  .meta({ id: 'ScenarioGaSection' });

export const BasicCatalogueResultSchema = z.object({
  venue: ScenarioVenueSchema,
  events: z.object({
    concert: ScenarioEventSchema.describe('Seated section and a GA section'),
    talk: ScenarioEventSchema.describe('Seated only'),
    meetup: ScenarioEventSchema.describe('GA only'),
  }),
});

export const SoldOutEventResultSchema = z.object({
  venue: ScenarioVenueSchema,
  event: ScenarioEventSchema,
  buyer: ScenarioBuyerSchema,
  orderIds: z.array(id).describe('The confirmed orders that bought every ticket'),
});

export const OneSeatLeftResultSchema = z.object({
  venue: ScenarioVenueSchema,
  event: ScenarioEventSchema,
  buyer: ScenarioBuyerSchema,
  orderIds: z.array(id).describe('The confirmed orders that bought the other seats'),
  seat: ScenarioSeatSchema.describe('The one seat that is still available'),
  soldSeats: z.array(ScenarioSeatSchema).describe('The seven sold seats, row by row'),
});

export const HoldAboutToExpireRequestSchema = z
  .strictObject({
    expiresInSec: z
      .number()
      .int()
      .min(1)
      .max(HOLD_DURATION_SEC.default)
      .default(60)
      .describe(
        `Seconds from now (server clock) until the hold expires, 1–${String(HOLD_DURATION_SEC.default)}. Default 60.`,
      ),
  })
  .describe('Optional. Send no body (or `{}`) for a hold that expires in 60 seconds.');

/** The body may be left out entirely. */
export const OptionalHoldAboutToExpireRequestSchema = HoldAboutToExpireRequestSchema.optional();

export const HoldAboutToExpireResultSchema = z.object({
  venue: ScenarioVenueSchema,
  event: ScenarioEventSchema,
  holder: TestSessionResponseSchema.describe(
    'The customer who holds the seats, logged in: send `cookie` (and `csrfToken` on writes) to act as them',
  ),
  hold: z.object({
    id,
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    totalCents: z.number().int(),
    seats: z.array(ScenarioSeatSchema).describe('Row A seats 1 and 2'),
  }),
});

export const GaMeetupResultSchema = z.object({
  venue: ScenarioVenueSchema,
  event: ScenarioEventSchema,
  sections: z.object({
    floor: ScenarioGaSectionSchema.describe('40 places: 20 at $10.00, then 20 at $15.00'),
    balcony: ScenarioGaSectionSchema.describe('10 places at $20.00'),
  }),
});

export const GaLastTicketResultSchema = z.object({
  venue: ScenarioVenueSchema,
  event: ScenarioEventSchema,
  buyer: ScenarioBuyerSchema,
  orderIds: z.array(id).describe('The confirmed orders that bought the other places'),
  section: ScenarioGaSectionSchema.describe('The GA section with one place left'),
});

export const ConfirmedOrderResultSchema = z.object({
  venue: ScenarioVenueSchema,
  event: ScenarioEventSchema,
  customer: TestSessionResponseSchema.describe(
    'The customer who bought the tickets, logged in: send `cookie` (and `csrfToken` on writes) to act as them',
  ),
  order: z.object({
    id,
    status: z.literal('CONFIRMED'),
    totalCents: z.number().int().describe('$115.00: two seats at $45.00 and a place at $25.00'),
    tickets: z
      .array(
        z.object({
          id: id.describe('Download it with `GET /tickets/{ticketId}/pdf`'),
          code: z.string().describe('What the ticket’s QR encodes'),
          inventoryUnitId: id,
          section: z.object({ id, name: z.string(), type: SectionTypeSchema }),
          seat: z
            .object({ row: z.string(), number: z.number().int() })
            .nullable()
            .describe('Null for the GA place'),
          priceCents: z.number().int(),
        }),
      )
      .describe('Row A seats 1 and 2, then one Standing place'),
  }),
});

const admissionRate = (fallback: number) =>
  z
    .number()
    .int()
    .min(ADMISSION_RATE_PER_SEC.min)
    .max(ADMISSION_RATE_PER_SEC.max)
    .optional()
    .describe(
      `Customers let in per second of server time, ${String(ADMISSION_RATE_PER_SEC.min)}–${String(ADMISSION_RATE_PER_SEC.max)}. Default ${String(fallback)}.`,
    );

const admissionTokenTtl = z
  .number()
  .int()
  .min(ADMISSION_TOKEN_TTL_SEC.min)
  .max(ADMISSION_TOKEN_TTL_SEC.max)
  .optional()
  .describe(
    `How long an admission lasts, in seconds, ${String(ADMISSION_TOKEN_TTL_SEC.min)}–${String(ADMISSION_TOKEN_TTL_SEC.max)}. Default ${String(ADMISSION_TOKEN_TTL_SEC.default)}.`,
  );

/** Admission rate of `drop-in-5-min` and `drop-open-now` unless the body sets one. */
export const SMALL_DROP_ADMISSION_RATE = 5;
/** Admission rate of `large-venue-drop` unless the body sets one. */
export const LARGE_DROP_ADMISSION_RATE = 100;
/** Seconds until `large-venue-drop` opens unless the body sets it. */
export const LARGE_DROP_SALES_OPEN_IN_SEC = 300;
/** Latest opening of `large-venue-drop`: a day ahead (its event starts days later). */
const MAX_SALES_OPEN_IN_SEC = 86_400;

export const DropRequestSchema = z
  .strictObject({
    admissionRatePerSec: admissionRate(SMALL_DROP_ADMISSION_RATE),
    admissionTokenTtlSec: admissionTokenTtl,
  })
  .describe('Optional. Send no body (or `{}`) for the defaults.');

export const OptionalDropRequestSchema = DropRequestSchema.optional();

export const LargeVenueDropRequestSchema = z
  .strictObject({
    salesOpenInSec: z
      .number()
      .int()
      .min(0)
      .max(MAX_SALES_OPEN_IN_SEC)
      .optional()
      .describe(
        `Seconds from now (server clock) until sales open, 0–${String(MAX_SALES_OPEN_IN_SEC)}. 0 opens them at once. Default ${String(LARGE_DROP_SALES_OPEN_IN_SEC)}.`,
      ),
    admissionRatePerSec: admissionRate(LARGE_DROP_ADMISSION_RATE),
    admissionTokenTtlSec: admissionTokenTtl,
  })
  .describe('Optional. Send no body (or `{}`) for the defaults.');

export const OptionalLargeVenueDropRequestSchema = LargeVenueDropRequestSchema.optional();

export const DropResultSchema = z.object({
  venue: ScenarioVenueSchema,
  event: ScenarioEventSchema.describe(
    'The drop: `waitingRoomEnabled`, with every ticket released when sales open',
  ),
});

export type ScenarioVenue = z.infer<typeof ScenarioVenueSchema>;
export type ScenarioEvent = z.infer<typeof ScenarioEventSchema>;
export type BasicCatalogueResult = z.infer<typeof BasicCatalogueResultSchema>;
export type SoldOutEventResult = z.infer<typeof SoldOutEventResultSchema>;
export type OneSeatLeftResult = z.infer<typeof OneSeatLeftResultSchema>;
export type ScenarioSeat = z.infer<typeof ScenarioSeatSchema>;
export type ScenarioGaSection = z.infer<typeof ScenarioGaSectionSchema>;
export type HoldAboutToExpireRequest = z.infer<typeof HoldAboutToExpireRequestSchema>;
/** The result before the service adds the holder's session. */
export type HoldAboutToExpireScenario = Omit<
  z.infer<typeof HoldAboutToExpireResultSchema>,
  'holder'
> & {
  holderId: string;
};
export type HoldAboutToExpireResult = z.infer<typeof HoldAboutToExpireResultSchema>;
export type GaMeetupResult = z.infer<typeof GaMeetupResultSchema>;
export type GaLastTicketResult = z.infer<typeof GaLastTicketResultSchema>;
/** The result before the service adds the customer's session. */
export type ConfirmedOrderScenario = Omit<
  z.infer<typeof ConfirmedOrderResultSchema>,
  'customer'
> & {
  customerId: string;
};
export type ConfirmedOrderResult = z.infer<typeof ConfirmedOrderResultSchema>;
export type DropRequest = z.infer<typeof DropRequestSchema>;
export type LargeVenueDropRequest = z.infer<typeof LargeVenueDropRequestSchema>;
export type DropResult = z.infer<typeof DropResultSchema>;

export class BasicCatalogueResultDto extends createZodDto(BasicCatalogueResultSchema) {}
export class SoldOutEventResultDto extends createZodDto(SoldOutEventResultSchema) {}
export class OneSeatLeftResultDto extends createZodDto(OneSeatLeftResultSchema) {}
export class HoldAboutToExpireRequestDto extends createZodDto(HoldAboutToExpireRequestSchema) {}
export class HoldAboutToExpireResultDto extends createZodDto(HoldAboutToExpireResultSchema) {}
export class GaMeetupResultDto extends createZodDto(GaMeetupResultSchema) {}
export class GaLastTicketResultDto extends createZodDto(GaLastTicketResultSchema) {}
export class ConfirmedOrderResultDto extends createZodDto(ConfirmedOrderResultSchema) {}
export class DropRequestDto extends createZodDto(DropRequestSchema) {}
export class LargeVenueDropRequestDto extends createZodDto(LargeVenueDropRequestSchema) {}
export class DropResultDto extends createZodDto(DropResultSchema) {}
