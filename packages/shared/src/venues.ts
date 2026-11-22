import { z } from 'zod';

import { intBetween, requiredText } from './fields.js';
import { SlugSchema } from './slugs.js';

/** Size limits of a venue layout. They keep one request from creating millions of rows. */
export const VENUE_LIMITS = {
  sections: 20,
  rowsPerSection: 50,
  seatsPerRow: 100,
  gaCapacity: 5000,
  /** Seats plus GA places across all sections. */
  totalCapacity: 20_000,
} as const;

export const VENUE_NAME_MAX_LENGTH = 100;
export const VENUE_ADDRESS_MAX_LENGTH = 200;
export const VENUE_CITY_MAX_LENGTH = 100;
export const SECTION_NAME_MAX_LENGTH = 50;

const sectionName = z
  .string()
  .trim()
  .min(1, { error: 'Enter a section name' })
  .max(SECTION_NAME_MAX_LENGTH, {
    error: `Section name must be at most ${SECTION_NAME_MAX_LENGTH} characters`,
  });

export const SeatedSectionInputSchema = z
  .strictObject({
    type: z.literal('SEATED'),
    name: sectionName,
    rows: intBetween({ min: 1, max: VENUE_LIMITS.rowsPerSection }, 'Rows').describe(
      'Rows are lettered from the front: A, B, …, Z, AA, AB, …',
    ),
    seatsPerRow: intBetween({ min: 1, max: VENUE_LIMITS.seatsPerRow }, 'Seats per row').describe(
      'Seats are numbered from 1 in each row',
    ),
  })
  .describe('A seated section: a grid of `rows` × `seatsPerRow` seats');

export const GaSectionInputSchema = z
  .strictObject({
    type: z.literal('GA'),
    name: sectionName,
    capacity: intBetween({ min: 1, max: VENUE_LIMITS.gaCapacity }, 'Capacity').describe(
      'How many people the section holds',
    ),
  })
  .describe('A general-admission section: places without seat numbers');

export const SectionInputSchema = z.discriminatedUnion('type', [
  SeatedSectionInputSchema,
  GaSectionInputSchema,
]);

export type SectionInput = z.infer<typeof SectionInputSchema>;

/** Tickets a section can hold: its seats, or its GA capacity. */
export function sectionInputCapacity(section: SectionInput): number {
  return section.type === 'GA' ? section.capacity : section.rows * section.seatsPerRow;
}

export const SectionsInputSchema = z
  .array(SectionInputSchema)
  .min(1, { error: 'Add at least one section' })
  .max(VENUE_LIMITS.sections, { error: `A venue has at most ${VENUE_LIMITS.sections} sections` })
  .superRefine((sections, ctx) => {
    const seen = new Set<string>();
    sections.forEach((section, index) => {
      const key = section.name.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'name'],
          message: 'Section names must be unique within the venue',
        });
      }
      seen.add(key);
    });
    const total = sections.reduce((sum, section) => sum + sectionInputCapacity(section), 0);
    if (total > VENUE_LIMITS.totalCapacity) {
      ctx.addIssue({
        code: 'custom',
        message: `A venue holds at most ${VENUE_LIMITS.totalCapacity} people across all sections (this layout has ${total})`,
      });
    }
  })
  .describe(
    'The layout, in display order. Section names are unique within the venue (ignoring case).',
  );

/** The canonical name of an IANA time zone (e.g. `europe/paris` → `Europe/Paris`), or `undefined`. */
export function canonicalTimeZone(name: string): string | undefined {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export const TimeZoneSchema = z
  .string()
  .trim()
  .transform((name, ctx) => {
    const canonical = canonicalTimeZone(name);
    if (canonical === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Enter an IANA time zone, e.g. America/New_York' });
      return z.NEVER;
    }
    return canonical;
  })
  .describe(
    'IANA time zone, e.g. `America/New_York`. Stored in its canonical spelling. Event times are shown in this zone.',
  );

const venueFields = {
  name: requiredText('Name', VENUE_NAME_MAX_LENGTH),
  slug: SlugSchema.optional().describe(
    'Defaults to one made from the name (with `-2`, `-3`, … added if taken). 409 `slug-taken` when a given slug is taken.',
  ),
  address: requiredText('Address', VENUE_ADDRESS_MAX_LENGTH),
  city: requiredText('City', VENUE_CITY_MAX_LENGTH),
  timezone: TimeZoneSchema,
  sections: SectionsInputSchema,
};

export const CreateVenueRequestSchema = z.strictObject(venueFields);

export const UpdateVenueRequestSchema = z
  .strictObject(venueFields)
  .partial()
  .describe(
    'Only the fields sent change. `sections` replaces the whole layout (new section and seat IDs), and only while no tickets have been released for any event at the venue (else 409 `layout-locked`).',
  );

export type CreateVenueRequest = z.infer<typeof CreateVenueRequestSchema>;
export type UpdateVenueRequest = z.infer<typeof UpdateVenueRequestSchema>;
