import {
  CreateEventRequestSchema,
  EventCategorySchema,
  EventStatusSchema,
  PageQuerySchema,
  pageSchema,
  ReleaseBatchRequestSchema,
  SectionTypeSchema,
  UpdateEventRequestSchema,
} from '@testtix/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const id = z.uuid();
const count = z.number().int();

export const TicketCountsSchema = z
  .object({
    total: count.describe('Released tickets (inventory units)'),
    available: count.describe('Neither sold nor held. Units whose hold has expired count here.'),
    held: count.describe('In an unexpired hold'),
    sold: count,
  })
  .describe('Released tickets by state, at the server clock')
  .meta({ id: 'TicketCounts' });

export const AdminBatchSchema = z
  .object({
    id,
    name: z.string(),
    priceCents: count.describe('Price of each ticket, in US cents'),
    releasesAt: z.iso.datetime(),
    released: z
      .boolean()
      .describe('`releasesAt` has passed (server clock). Unreleased tickets cannot be sold.'),
    createdAt: z.iso.datetime(),
    tickets: TicketCountsSchema,
    sections: z
      .array(
        z.object({
          sectionId: id,
          name: z.string(),
          type: SectionTypeSchema,
          tickets: TicketCountsSchema,
        }),
      )
      .describe('Where the tickets are, in the venue’s section order'),
  })
  .meta({ id: 'AdminBatch' });

export const AdminEventVenueSchema = z
  .object({
    id,
    slug: z.string(),
    name: z.string(),
    city: z.string(),
    timezone: z.string(),
  })
  .meta({ id: 'AdminEventVenue' });

const summaryFields = {
  id,
  slug: z.string(),
  title: z.string(),
  performer: z.string(),
  category: EventCategorySchema,
  status: EventStatusSchema,
  venue: AdminEventVenueSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  salesOpenAt: z.iso.datetime(),
  tickets: TicketCountsSchema.describe('Across all batches'),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

export const AdminEventSummarySchema = z.object(summaryFields).meta({ id: 'AdminEventSummary' });

export const AdminEventSchema = z
  .object({
    ...summaryFields,
    description: z.string(),
    holdDurationSec: count,
    maxTicketsPerOrder: count,
    batches: z.array(AdminBatchSchema).describe('By release time, then ID'),
  })
  .meta({ id: 'AdminEvent' });

export const AdminEventPageSchema = pageSchema(AdminEventSummarySchema).meta({
  id: 'AdminEventPage',
});

export const AdminEventListQuerySchema = PageQuerySchema.extend({
  status: EventStatusSchema.optional().describe('Only events with this status'),
  venueId: id.optional().describe('Only events at this venue'),
});

export const EventIdParamSchema = z.object({ eventId: id });

export type TicketCounts = z.infer<typeof TicketCountsSchema>;
export type AdminBatch = z.infer<typeof AdminBatchSchema>;
export type AdminEventSummary = z.infer<typeof AdminEventSummarySchema>;
export type AdminEvent = z.infer<typeof AdminEventSchema>;
export type AdminEventListQuery = z.infer<typeof AdminEventListQuerySchema>;

export class CreateEventRequestDto extends createZodDto(CreateEventRequestSchema) {}
export class UpdateEventRequestDto extends createZodDto(UpdateEventRequestSchema) {}
export class ReleaseBatchRequestDto extends createZodDto(ReleaseBatchRequestSchema) {}
export class AdminEventListQueryDto extends createZodDto(AdminEventListQuerySchema) {}
export class EventIdParamDto extends createZodDto(EventIdParamSchema) {}
export class AdminEventDto extends createZodDto(AdminEventSchema) {}
export class AdminEventPageDto extends createZodDto(AdminEventPageSchema) {}
export class AdminBatchDto extends createZodDto(AdminBatchSchema) {}
