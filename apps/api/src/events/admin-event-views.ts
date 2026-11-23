import type { Prisma } from '../generated/prisma/client.js';
import type { AdminBatch, AdminEvent, AdminEventSummary } from './event.schemas.js';
import { countUnits, sumCounts, type UnitCountRow } from './ticket-counts.js';

type Db = Prisma.TransactionClient;

const VENUE_SELECT = {
  id: true,
  slug: true,
  name: true,
  city: true,
  timezone: true,
} as const satisfies Prisma.VenueSelect;

export const SUMMARY_INCLUDE = {
  venue: { select: VENUE_SELECT },
} as const satisfies Prisma.EventInclude;

const DETAIL_INCLUDE = {
  venue: {
    select: {
      ...VENUE_SELECT,
      sections: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, type: true },
      },
    },
  },
  batches: { orderBy: [{ releasesAt: 'asc' }, { id: 'asc' }] },
} as const satisfies Prisma.EventInclude;

type EventWithVenue = Prisma.EventGetPayload<{ include: typeof SUMMARY_INCLUDE }>;
type EventWithBatches = Prisma.EventGetPayload<{ include: typeof DETAIL_INCLUDE }>;
type Batch = EventWithBatches['batches'][number];
type Section = EventWithBatches['venue']['sections'][number];

/** The admin view of an event, with its batches and ticket counts, or `null`. */
export async function loadAdminEvent(
  db: Db,
  eventId: string,
  now: Date,
): Promise<AdminEvent | null> {
  const event = await db.event.findUnique({ where: { id: eventId }, include: DETAIL_INCLUDE });
  if (event === null) return null;
  const counts = await countUnits(db, [event.id], now);
  return {
    ...toAdminEventSummary(event, counts),
    description: event.description,
    holdDurationSec: event.holdDurationSec,
    maxTicketsPerOrder: event.maxTicketsPerOrder,
    waitingRoomEnabled: event.waitingRoomEnabled,
    admissionRatePerSec: event.admissionRatePerSec,
    admissionTokenTtlSec: event.admissionTokenTtlSec,
    batches: event.batches.map((batch) => toAdminBatch(batch, event.venue.sections, counts, now)),
  };
}

/** The admin view of one batch of `eventId`. */
export async function loadAdminBatch(
  db: Db,
  eventId: string,
  batchId: string,
  now: Date,
): Promise<AdminBatch> {
  const event = await db.event.findUniqueOrThrow({
    where: { id: eventId },
    include: { ...DETAIL_INCLUDE, batches: { where: { id: batchId } } },
  });
  const [batch] = event.batches;
  if (batch === undefined) throw new Error(`Batch ${batchId} of event ${eventId} not found`);
  const counts = await countUnits(db, [eventId], now);
  return toAdminBatch(batch, event.venue.sections, counts, now);
}

/** Summaries of `events` (with their venues), with ticket counts. */
export async function toAdminEventSummaries(
  db: Db,
  events: EventWithVenue[],
  now: Date,
): Promise<AdminEventSummary[]> {
  const counts = await countUnits(
    db,
    events.map((event) => event.id),
    now,
  );
  return events.map((event) =>
    toAdminEventSummary(
      event,
      counts.filter((row) => row.eventId === event.id),
    ),
  );
}

function toAdminEventSummary(
  event: EventWithVenue | EventWithBatches,
  counts: readonly UnitCountRow[],
): AdminEventSummary {
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    performer: event.performer,
    category: event.category,
    status: event.status,
    venue: {
      id: event.venue.id,
      slug: event.venue.slug,
      name: event.venue.name,
      city: event.venue.city,
      timezone: event.venue.timezone,
    },
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    salesOpenAt: event.salesOpenAt.toISOString(),
    tickets: sumCounts(counts),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

function toAdminBatch(
  batch: Batch,
  sections: readonly Section[],
  counts: readonly UnitCountRow[],
  now: Date,
): AdminBatch {
  const ofBatch = counts.filter((row) => row.batchId === batch.id);
  return {
    id: batch.id,
    name: batch.name,
    priceCents: batch.priceCents,
    releasesAt: batch.releasesAt.toISOString(),
    released: batch.releasesAt.getTime() <= now.getTime(),
    createdAt: batch.createdAt.toISOString(),
    tickets: sumCounts(ofBatch),
    sections: sections
      .filter((section) => ofBatch.some((row) => row.sectionId === section.id))
      .map((section) => ({
        sectionId: section.id,
        name: section.name,
        type: section.type,
        tickets: sumCounts(ofBatch, (row) => row.sectionId === section.id),
      })),
  };
}
