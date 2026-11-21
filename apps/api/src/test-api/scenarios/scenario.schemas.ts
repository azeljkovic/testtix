import { EventCategorySchema, EventStatusSchema, SectionTypeSchema } from '@testtix/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

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
    tickets: z
      .object({
        total: z.number().int(),
        available: z.number().int(),
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
  seat: z
    .object({
      id,
      sectionId: id,
      row: z.string(),
      number: z.number().int(),
      inventoryUnitId: id,
      priceCents: z.number().int(),
    })
    .describe('The one seat that is still available'),
});

export type ScenarioVenue = z.infer<typeof ScenarioVenueSchema>;
export type ScenarioEvent = z.infer<typeof ScenarioEventSchema>;
export type BasicCatalogueResult = z.infer<typeof BasicCatalogueResultSchema>;
export type SoldOutEventResult = z.infer<typeof SoldOutEventResultSchema>;
export type OneSeatLeftResult = z.infer<typeof OneSeatLeftResultSchema>;

export class BasicCatalogueResultDto extends createZodDto(BasicCatalogueResultSchema) {}
export class SoldOutEventResultDto extends createZodDto(SoldOutEventResultSchema) {}
export class OneSeatLeftResultDto extends createZodDto(OneSeatLeftResultSchema) {}
