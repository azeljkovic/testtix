import {
  CreateVenueRequestSchema,
  PageQuerySchema,
  pageSchema,
  SectionTypeSchema,
  UpdateVenueRequestSchema,
} from '@testtix/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const id = z.uuid();

export const AdminSeatSchema = z
  .object({
    id,
    row: z.string().describe('Row label, lettered from the front: A, B, …, Z, AA, …'),
    number: z.number().int().describe('Seat number in the row, from 1'),
  })
  .meta({ id: 'AdminSeat' });

export const AdminSectionSchema = z
  .object({
    id,
    name: z.string(),
    type: SectionTypeSchema,
    capacity: z
      .number()
      .int()
      .describe('Tickets the section holds: its number of seats (SEATED) or its capacity (GA)'),
  })
  .meta({ id: 'AdminSection' });

export const AdminVenueSectionSchema = AdminSectionSchema.extend({
  seats: z
    .array(AdminSeatSchema)
    .describe('SEATED: every seat, front row first, then by number. GA: empty.'),
}).meta({ id: 'AdminVenueSection' });

const venueFields = {
  id,
  slug: z.string(),
  name: z.string(),
  address: z.string(),
  city: z.string(),
  timezone: z.string().describe('IANA time zone'),
  capacity: z.number().int().describe('Tickets across all sections'),
  layoutLocked: z
    .boolean()
    .describe(
      'True once tickets have been released for an event at the venue: the layout (`sections`) can no longer change',
    ),
  createdAt: z.iso.datetime(),
};

export const AdminVenueSummarySchema = z
  .object({ ...venueFields, sections: z.array(AdminSectionSchema) })
  .meta({ id: 'AdminVenueSummary' });

export const AdminVenueSchema = z
  .object({ ...venueFields, sections: z.array(AdminVenueSectionSchema) })
  .meta({ id: 'AdminVenue' });

export const AdminVenuePageSchema = pageSchema(AdminVenueSummarySchema).meta({
  id: 'AdminVenuePage',
});

export const VenueIdParamSchema = z.object({ venueId: id });

export const CatalogueVenueSchema = z
  .object({
    id,
    slug: z.string(),
    name: z.string(),
    city: z.string(),
    timezone: z.string().describe('IANA time zone; show event times in it'),
  })
  .meta({ id: 'CatalogueVenue' });

export const CatalogueVenuePageSchema = pageSchema(CatalogueVenueSchema).meta({
  id: 'CatalogueVenuePage',
});

export type CatalogueVenue = z.infer<typeof CatalogueVenueSchema>;
export type AdminSection = z.infer<typeof AdminSectionSchema>;
export type AdminVenueSummary = z.infer<typeof AdminVenueSummarySchema>;
export type AdminVenue = z.infer<typeof AdminVenueSchema>;

export class CreateVenueRequestDto extends createZodDto(CreateVenueRequestSchema) {}
export class UpdateVenueRequestDto extends createZodDto(UpdateVenueRequestSchema) {}
export class VenueListQueryDto extends createZodDto(PageQuerySchema) {}
export class VenueIdParamDto extends createZodDto(VenueIdParamSchema) {}
export class AdminVenueDto extends createZodDto(AdminVenueSchema) {}
export class AdminVenuePageDto extends createZodDto(AdminVenuePageSchema) {}
export class CatalogueVenuePageDto extends createZodDto(CatalogueVenuePageSchema) {}
