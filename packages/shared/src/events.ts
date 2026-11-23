import { z } from 'zod';

import { intBetween, requiredText } from './fields.js';
import { SlugSchema } from './slugs.js';

/** What kind of event it is. Filterable in the catalogue (C2.2). */
export const EVENT_CATEGORIES = ['CONCERT', 'TALK', 'MEETUP'] as const;

export const EventCategorySchema = z.enum(EVENT_CATEGORIES).meta({ id: 'EventCategory' });

export type EventCategory = z.infer<typeof EventCategorySchema>;

/**
 * Event lifecycle (C2.1):
 *
 * - `DRAFT`: being set up by an admin; not visible in the public catalogue.
 * - `PUBLISHED`: visible in the catalogue; tickets sell once sales open and a batch is released.
 * - `CANCELLED`: no longer on sale; stays visible to people who bought tickets.
 */
export const EVENT_STATUSES = ['DRAFT', 'PUBLISHED', 'CANCELLED'] as const;

export const EventStatusSchema = z.enum(EVENT_STATUSES).meta({ id: 'EventStatus' });

export type EventStatus = z.infer<typeof EventStatusSchema>;

export const EVENT_TITLE_MAX_LENGTH = 200;
export const EVENT_PERFORMER_MAX_LENGTH = 200;
export const EVENT_DESCRIPTION_MAX_LENGTH = 5000;

/** How long a customer's seat hold lasts (C3.1), in seconds. */
export const HOLD_DURATION_SEC = { min: 60, max: 3600, default: 600 } as const;

/** Most tickets in one hold or order (resolved question 4 of the plan). */
export const MAX_TICKETS_PER_ORDER = { min: 1, max: 20, default: 6 } as const;

/** Customers a drop's waiting room lets in per second of server time (C5.1). */
export const ADMISSION_RATE_PER_SEC = { min: 1, max: 1000, default: 10 } as const;

/** How long an admission from the waiting room lasts, in seconds (C5.1). */
export const ADMISSION_TOKEN_TTL_SEC = { min: 60, max: 3600, default: 600 } as const;

const dateTime = (label: string) =>
  z.iso.datetime({
    offset: true,
    error: (issue) =>
      issue.input === undefined
        ? `Enter the ${label.toLowerCase()}`
        : `${label} must be an ISO 8601 date-time`,
  });

export const EVENT_SCHEDULE_MESSAGES = {
  endsBeforeStart: 'End time must be after the start time',
  salesOpenAfterStart: 'Sales must open before the event starts',
  startsInPast: 'Start time must be in the future',
} as const;

export interface EventSchedule {
  startsAt: Date;
  endsAt: Date;
  salesOpenAt: Date;
}

/**
 * The rules between an event's times: it ends after it starts, and sales open before it starts.
 * Returns one issue per broken rule (empty when the schedule is valid). The API applies them to
 * the merged result of a partial update too.
 */
export function eventScheduleIssues({
  startsAt,
  endsAt,
  salesOpenAt,
}: EventSchedule): { path: 'endsAt' | 'salesOpenAt'; message: string }[] {
  const issues: { path: 'endsAt' | 'salesOpenAt'; message: string }[] = [];
  if (endsAt.getTime() <= startsAt.getTime()) {
    issues.push({ path: 'endsAt', message: EVENT_SCHEDULE_MESSAGES.endsBeforeStart });
  }
  if (salesOpenAt.getTime() >= startsAt.getTime()) {
    issues.push({ path: 'salesOpenAt', message: EVENT_SCHEDULE_MESSAGES.salesOpenAfterStart });
  }
  return issues;
}

const eventFields = {
  title: requiredText('Title', EVENT_TITLE_MAX_LENGTH),
  slug: SlugSchema.optional().describe(
    'Defaults to one made from the title (with `-2`, `-3`, … added if taken). 409 `slug-taken` when a given slug is taken.',
  ),
  performer: requiredText('Performer', EVENT_PERFORMER_MAX_LENGTH).describe(
    'Artist, speaker or host. Searched together with the title.',
  ),
  description: requiredText('Description', EVENT_DESCRIPTION_MAX_LENGTH),
  category: EventCategorySchema,
  venueId: z.uuid({ error: 'Choose a venue' }),
  startsAt: dateTime('Start time').describe(
    'ISO 8601 with `Z` or an offset. Must be in the future (server clock) when set.',
  ),
  endsAt: dateTime('End time').describe('After `startsAt`'),
  salesOpenAt: dateTime('Sales open time').describe(
    'When tickets go on sale. Before `startsAt`. Each batch can also release later.',
  ),
  holdDurationSec: intBetween(HOLD_DURATION_SEC, 'Hold duration')
    .optional()
    .describe(
      `How long a seat hold lasts, in seconds (${HOLD_DURATION_SEC.min}–${HOLD_DURATION_SEC.max}, default ${HOLD_DURATION_SEC.default})`,
    ),
  maxTicketsPerOrder: intBetween(MAX_TICKETS_PER_ORDER, 'Tickets per order')
    .optional()
    .describe(
      `Most tickets in one hold or order (${MAX_TICKETS_PER_ORDER.min}–${MAX_TICKETS_PER_ORDER.max}, default ${MAX_TICKETS_PER_ORDER.default})`,
    ),
  waitingRoomEnabled: z
    .boolean({ error: 'Waiting room must be true or false' })
    .optional()
    .describe(
      'A ticket drop (default false): customers join a queue (`POST /events/{eventId}/queue`) and need an admission token for the seat map and holds. Turning it off lets everyone waiting in at once.',
    ),
  admissionRatePerSec: intBetween(ADMISSION_RATE_PER_SEC, 'Admission rate')
    .optional()
    .describe(
      `Customers the waiting room lets in per second of server time (${ADMISSION_RATE_PER_SEC.min}–${ADMISSION_RATE_PER_SEC.max}, default ${ADMISSION_RATE_PER_SEC.default})`,
    ),
  admissionTokenTtlSec: intBetween(ADMISSION_TOKEN_TTL_SEC, 'Admission time')
    .optional()
    .describe(
      `How long an admission lasts, in seconds (${ADMISSION_TOKEN_TTL_SEC.min}–${ADMISSION_TOKEN_TTL_SEC.max}, default ${ADMISSION_TOKEN_TTL_SEC.default})`,
    ),
};

export const CreateEventRequestSchema = z.strictObject(eventFields).superRefine((event, ctx) => {
  for (const issue of eventScheduleIssues({
    startsAt: new Date(event.startsAt),
    endsAt: new Date(event.endsAt),
    salesOpenAt: new Date(event.salesOpenAt),
  })) {
    ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
  }
});

export const UpdateEventRequestSchema = z
  .strictObject(eventFields)
  .partial()
  .describe(
    'Only the fields sent change; the time rules apply to the result. `venueId` can only change while the event has no batches (else 409 `layout-locked`). Cancelled events cannot be changed.',
  );

export type CreateEventRequest = z.infer<typeof CreateEventRequestSchema>;
export type UpdateEventRequest = z.infer<typeof UpdateEventRequestSchema>;

export const BATCH_NAME_MAX_LENGTH = 100;
/** $10,000.00. */
export const BATCH_PRICE_MAX_CENTS = 1_000_000;
/** Most seat IDs in one batch: the most seats a venue can have. */
export const BATCH_SEAT_IDS_MAX = 20_000;
/** The error of a batch that releases nothing. */
export const BATCH_EMPTY_MESSAGE = 'Release at least one seated section, seat or GA place';

const uuidList = (max: number) =>
  z
    .array(z.uuid())
    .max(max)
    .superRefine((ids, ctx) => {
      const seen = new Set<string>();
      ids.forEach((id, index) => {
        if (seen.has(id)) ctx.addIssue({ code: 'custom', path: [index], message: 'Listed twice' });
        seen.add(id);
      });
    });

export const ReleaseBatchRequestSchema = z
  .strictObject({
    name: requiredText('Name', BATCH_NAME_MAX_LENGTH).describe('e.g. "Early bird" or "Balcony"'),
    priceCents: intBetween({ min: 0, max: BATCH_PRICE_MAX_CENTS }, 'Price').describe(
      'Price of every ticket in the batch, in US cents',
    ),
    releasesAt: dateTime('Release time')
      .optional()
      .describe(
        'When the tickets go on sale (ISO 8601). Defaults to now (server clock). Tickets sell only once both this time and the event’s `salesOpenAt` have passed.',
      ),
    seatedSectionIds: uuidList(20)
      .optional()
      .describe(
        'Seated sections whose seats are all released, except seats an earlier batch of this event already released',
      ),
    seatIds: uuidList(BATCH_SEAT_IDS_MAX)
      .optional()
      .describe(
        'Individual seats to release. 409 `inventory-already-released` if any was released before.',
      ),
    gaSections: z
      .array(
        z.strictObject({
          sectionId: z.uuid(),
          quantity: z
            .number()
            .int()
            .min(1)
            .describe('Places to release; at most the capacity not yet released'),
        }),
      )
      .max(20)
      .superRefine((items, ctx) => {
        const seen = new Set<string>();
        items.forEach((item, index) => {
          if (seen.has(item.sectionId)) {
            ctx.addIssue({ code: 'custom', path: [index, 'sectionId'], message: 'Listed twice' });
          }
          seen.add(item.sectionId);
        });
      })
      .optional()
      .describe('General-admission places to release, per GA section'),
  })
  .superRefine((batch, ctx) => {
    const empty =
      (batch.seatedSectionIds?.length ?? 0) === 0 &&
      (batch.seatIds?.length ?? 0) === 0 &&
      (batch.gaSections?.length ?? 0) === 0;
    if (empty) {
      ctx.addIssue({
        code: 'custom',
        message: BATCH_EMPTY_MESSAGE,
      });
    }
  });

export type ReleaseBatchRequest = z.infer<typeof ReleaseBatchRequestSchema>;
