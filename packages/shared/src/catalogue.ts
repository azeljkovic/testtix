import { z } from 'zod';

import { EventCategorySchema } from './events.js';
import { PageQuerySchema } from './pagination.js';

/**
 * Whether an event's tickets can be bought right now (C2.2), at the server clock:
 *
 * - `SALES_NOT_OPEN`: `salesOpenAt` is in the future, or none of its batches is released yet.
 * - `ON_SALE`: sales are open and released tickets are available.
 * - `SOLD_OUT`: sales are open, but every released ticket is sold or held. Tickets come back
 *   when a hold expires, and a batch scheduled for later can still release more.
 * - `SALES_ENDED`: the event has started.
 */
export const EVENT_AVAILABILITIES = [
  'SALES_NOT_OPEN',
  'ON_SALE',
  'SOLD_OUT',
  'SALES_ENDED',
] as const;

export const EventAvailabilitySchema = z
  .enum(EVENT_AVAILABILITIES)
  .meta({ id: 'EventAvailability' });

export type EventAvailability = z.infer<typeof EventAvailabilitySchema>;

/** What kind of tickets an event sells: only seats, only general admission, or both. */
export const EVENT_SEATINGS = ['SEATED', 'GA', 'MIXED'] as const;

export const EventSeatingSchema = z.enum(EVENT_SEATINGS).meta({ id: 'EventSeating' });

export type EventSeating = z.infer<typeof EventSeatingSchema>;

/** Sort keys of the public event list. Every sort ends with the event ID as a tiebreaker. */
export const CATALOGUE_SORTS = ['date', 'price', 'name'] as const;

export const CatalogueSortSchema = z.enum(CATALOGUE_SORTS);

export type CatalogueSort = z.infer<typeof CatalogueSortSchema>;

export const SORT_ORDERS = ['asc', 'desc'] as const;

export const CATALOGUE_SEARCH_MAX_LENGTH = 100;

const dateTime = (label: string) =>
  z.iso.datetime({ offset: true, error: `${label} must be an ISO 8601 date-time` });

/** Query of `GET /events`. Every filter is optional; they combine with AND. */
export const EventCatalogueQuerySchema = PageQuerySchema.extend({
  q: z
    .string()
    .trim()
    .max(CATALOGUE_SEARCH_MAX_LENGTH, {
      error: `Search must be at most ${CATALOGUE_SEARCH_MAX_LENGTH} characters`,
    })
    .optional()
    .describe(
      'Search text: events whose title or performer contains it, ignoring case. Blank means no search.',
    ),
  category: EventCategorySchema.optional().describe('Only events of this category'),
  venue: z.string().trim().max(100).optional().describe('Only events at the venue with this slug'),
  from: dateTime('From')
    .optional()
    .describe(
      'Only events starting at or after this time (ISO 8601). Defaults to now (server clock), so past events are left out unless you ask for them.',
    ),
  to: dateTime('To').optional().describe('Only events starting before this time (ISO 8601)'),
  seating: EventSeatingSchema.optional().describe(
    'Only events selling only seats (`SEATED`), only general admission (`GA`), or both (`MIXED`)',
  ),
  availability: EventAvailabilitySchema.optional().describe(
    'Only events in this sales state (server clock)',
  ),
  sort: CatalogueSortSchema.default('date').describe(
    '`date`: start time. `price`: lowest ticket price, then start time. `name`: title (ignoring case), then start time. The event ID breaks remaining ties.',
  ),
  order: z
    .enum(SORT_ORDERS)
    .default('asc')
    .describe('Direction of the sort key; the tiebreakers stay ascending'),
}).superRefine((query, ctx) => {
  if (
    query.from !== undefined &&
    query.to !== undefined &&
    new Date(query.to).getTime() <= new Date(query.from).getTime()
  ) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: '"To" must be after "from"' });
  }
});

export type EventCatalogueQuery = z.infer<typeof EventCatalogueQuerySchema>;

/**
 * How long the web event list waits after the last keystroke in its search box before it searches
 * (C2.3), in milliseconds. Fixed on purpose: the debounced search is something to test against.
 * Pressing Enter searches straight away.
 */
export const SEARCH_DEBOUNCE_MS = 300;
