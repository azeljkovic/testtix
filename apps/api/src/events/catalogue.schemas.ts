import {
  EventAvailabilitySchema,
  EventCatalogueQuerySchema,
  EventCategorySchema,
  EventSeatingSchema,
  pageSchema,
  SectionTypeSchema,
} from '@testtix/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { CatalogueVenueSchema } from '../venues/venue.schemas.js';
import { TicketCountsSchema } from './event.schemas.js';

const id = z.uuid();
const count = z.number().int();

export const PriceRangeSchema = z
  .object({
    minCents: count.describe('Cheapest ticket, in US cents'),
    maxCents: count.describe('Most expensive ticket, in US cents'),
  })
  .describe('Prices of all the event’s tickets (sold, held and not yet released included)')
  .meta({ id: 'PriceRange' });

const summaryFields = {
  id,
  slug: z.string(),
  title: z.string(),
  performer: z.string(),
  category: EventCategorySchema,
  venue: CatalogueVenueSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  salesOpenAt: z.iso.datetime(),
  seating: EventSeatingSchema,
  availability: EventAvailabilitySchema,
  availableTickets: count.describe(
    'Released tickets that are neither sold nor held (tickets whose hold expired count). Buyable while the event is `ON_SALE`.',
  ),
  priceRange: PriceRangeSchema,
};

export const CatalogueEventSummarySchema = z
  .object(summaryFields)
  .meta({ id: 'CatalogueEventSummary' });

export const CatalogueSectionSchema = z
  .object({
    id,
    name: z.string(),
    type: SectionTypeSchema,
    tickets: TicketCountsSchema.describe('Released tickets in this section, by state'),
    priceRange: PriceRangeSchema,
    nextReleaseAt: z.iso
      .datetime()
      .nullable()
      .describe('When the next scheduled batch releases more tickets here; null if none is due'),
  })
  .meta({ id: 'CatalogueSection' });

export const CatalogueEventSchema = z
  .object({
    ...summaryFields,
    description: z.string(),
    venue: CatalogueVenueSchema.extend({ address: z.string() }).meta({
      id: 'CatalogueEventVenue',
    }),
    maxTicketsPerOrder: count.describe('Most tickets in one hold or order'),
    waitingRoomEnabled: z
      .boolean()
      .describe(
        'A ticket drop: join the waiting room (`POST /events/{eventId}/queue`) before choosing seats',
      ),
    tickets: TicketCountsSchema.describe('Released tickets by state, across all sections'),
    sections: z
      .array(CatalogueSectionSchema)
      .describe('Sections with tickets for this event, in the venue’s order'),
  })
  .meta({ id: 'CatalogueEvent' });

export const CatalogueEventPageSchema = pageSchema(CatalogueEventSummarySchema).meta({
  id: 'CatalogueEventPage',
});

export const EventSlugParamSchema = z.object({ slug: z.string().max(200) });

export type PriceRange = z.infer<typeof PriceRangeSchema>;
export type CatalogueEventSummary = z.infer<typeof CatalogueEventSummarySchema>;
export type CatalogueEvent = z.infer<typeof CatalogueEventSchema>;
export type CatalogueSection = z.infer<typeof CatalogueSectionSchema>;

export class EventCatalogueQueryDto extends createZodDto(EventCatalogueQuerySchema) {}
export class EventSlugParamDto extends createZodDto(EventSlugParamSchema) {}
export class CatalogueEventDto extends createZodDto(CatalogueEventSchema) {}
export class CatalogueEventPageDto extends createZodDto(CatalogueEventPageSchema) {}
