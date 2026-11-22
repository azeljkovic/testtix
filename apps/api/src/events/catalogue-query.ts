import type {
  CatalogueSort,
  EventAvailability,
  EventCatalogueQuery,
  EventCategory,
  EventSeating,
  SectionType,
} from '@testtix/shared';

import { Prisma } from '../generated/prisma/client.js';

type Db = Prisma.TransactionClient;

/** One row of the catalogue: a published event with its venue and ticket figures. */
export interface CatalogueRow {
  id: string;
  slug: string;
  title: string;
  performer: string;
  category: EventCategory;
  startsAt: Date;
  endsAt: Date;
  salesOpenAt: Date;
  venueId: string;
  venueSlug: string;
  venueName: string;
  venueCity: string;
  venueTimezone: string;
  available: number;
  minPriceCents: number;
  maxPriceCents: number;
  seating: EventSeating;
  availability: EventAvailability;
}

/** Released and scheduled tickets of one section of an event. */
export interface CatalogueSectionRow {
  id: string;
  name: string;
  type: SectionType;
  total: number;
  sold: number;
  held: number;
  minPriceCents: number;
  maxPriceCents: number;
  nextReleaseAt: Date | null;
}

/**
 * Every published event that has tickets (publishing needs a batch, and batches can't be deleted,
 * so that is every published event), with figures computed at `now`:
 *
 * - `available`: units of released batches that are `AVAILABLE`, or `HELD` with an expired hold
 *   (the lazy expiry of C3.1, matching `countUnits()`).
 * - `minPriceCents` / `maxPriceCents`: over all units, released or not.
 * - `seating`: from the units: seats only, GA places only, or both.
 * - `availability`: see `EVENT_AVAILABILITIES` in `@testtix/shared`.
 *
 * It is a derived table, so filters and sorts below apply to the computed columns as well.
 */
function catalogue(now: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT e.id, e.slug, e.title, e.performer, e.category::text AS category,
      e.starts_at AS "startsAt", e.ends_at AS "endsAt", e.sales_open_at AS "salesOpenAt",
      v.id AS "venueId", v.slug AS "venueSlug", v.name AS "venueName", v.city AS "venueCity",
      v.timezone AS "venueTimezone",
      t.available, t.min_price AS "minPriceCents", t.max_price AS "maxPriceCents",
      CASE
        WHEN t.has_seats AND t.has_ga THEN 'MIXED'
        WHEN t.has_seats THEN 'SEATED'
        ELSE 'GA'
      END AS seating,
      CASE
        WHEN e.starts_at <= ${now} THEN 'SALES_ENDED'
        WHEN e.sales_open_at > ${now} OR NOT t.released THEN 'SALES_NOT_OPEN'
        WHEN t.available = 0 THEN 'SOLD_OUT'
        ELSE 'ON_SALE'
      END AS availability
    FROM events e
    JOIN venues v ON v.id = e.venue_id
    JOIN (
      SELECT u.event_id,
        (count(*) FILTER (
          WHERE b.releases_at <= ${now}
            AND (u.status = 'AVAILABLE' OR (u.status = 'HELD' AND u.held_until <= ${now}))
        ))::int AS available,
        bool_or(b.releases_at <= ${now}) AS released,
        min(u.price_cents) AS min_price,
        max(u.price_cents) AS max_price,
        bool_or(u.seat_id IS NOT NULL) AS has_seats,
        bool_or(u.seat_id IS NULL) AS has_ga
      FROM inventory_units u
      JOIN ticket_batches b ON b.id = u.batch_id
      WHERE u.event_id IN (SELECT id FROM events WHERE status = 'PUBLISHED')
      GROUP BY u.event_id
    ) t ON t.event_id = e.id
    WHERE e.status = 'PUBLISHED'`;
}

/** `%`, `_` and `\` match themselves in the search, not any text. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function filters(query: EventCatalogueQuery, now: Date): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`c."startsAt" >= ${new Date(query.from ?? now)}`];
  if (query.to !== undefined) conditions.push(Prisma.sql`c."startsAt" < ${new Date(query.to)}`);
  if (query.category !== undefined) conditions.push(Prisma.sql`c.category = ${query.category}`);
  if (query.venue !== undefined) conditions.push(Prisma.sql`c."venueSlug" = ${query.venue}`);
  if (query.seating !== undefined) conditions.push(Prisma.sql`c.seating = ${query.seating}`);
  if (query.availability !== undefined) {
    conditions.push(Prisma.sql`c.availability = ${query.availability}`);
  }
  if (query.q !== undefined && query.q !== '') {
    const pattern = likePattern(query.q);
    conditions.push(Prisma.sql`(c.title ILIKE ${pattern} OR c.performer ILIKE ${pattern})`);
  }
  return Prisma.join(conditions, ' AND ');
}

/**
 * `ORDER BY` of a sort: the key in the requested direction, then ascending tiebreakers ending
 * with the ID, so the order is total and paging never skips or repeats an event. Titles compare
 * lower-cased with the `C` collation (by code point), so the order is the same on every database.
 */
function orderBy(sort: CatalogueSort, order: 'asc' | 'desc'): Prisma.Sql {
  const direction = Prisma.raw(order === 'desc' ? 'DESC' : 'ASC');
  switch (sort) {
    case 'date':
      return Prisma.sql`c."startsAt" ${direction}, c.id ASC`;
    case 'price':
      return Prisma.sql`c."minPriceCents" ${direction}, c."startsAt" ASC, c.id ASC`;
    case 'name':
      return Prisma.sql`lower(c.title) COLLATE "C" ${direction}, c."startsAt" ASC, c.id ASC`;
  }
}

/** One page of the catalogue for `query`, and the number of events matching it. */
export async function findCatalogueEvents(
  db: Db,
  query: EventCatalogueQuery,
  now: Date,
): Promise<{ rows: CatalogueRow[]; total: number }> {
  const where = filters(query, now);
  const [rows, counted] = await Promise.all([
    db.$queryRaw<CatalogueRow[]>`
      SELECT * FROM (${catalogue(now)}) c
      WHERE ${where}
      ORDER BY ${orderBy(query.sort, query.order)}
      LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
    db.$queryRaw<[{ total: number }]>`
      SELECT count(*)::int AS total FROM (${catalogue(now)}) c WHERE ${where}`,
  ]);
  return { rows, total: counted[0].total };
}

/** The published event with this slug, or `undefined`. Past events are included. */
export async function findCatalogueEvent(
  db: Db,
  slug: string,
  now: Date,
): Promise<CatalogueRow | undefined> {
  const rows = await db.$queryRaw<CatalogueRow[]>`
    SELECT * FROM (${catalogue(now)}) c WHERE c.slug = ${slug}`;
  return rows[0];
}

/** The published event with this ID, or `undefined`. Past events are included. */
export async function findCatalogueEventById(
  db: Db,
  eventId: string,
  now: Date,
): Promise<CatalogueRow | undefined> {
  const rows = await db.$queryRaw<CatalogueRow[]>`
    SELECT * FROM (${catalogue(now)}) c WHERE c.id = ${eventId}::uuid`;
  return rows[0];
}

/**
 * The sections in which `eventId` has tickets, in the venue's order. `total`, `sold` and `held`
 * count released units only (`held`: in an unexpired hold); prices cover all units.
 */
export async function findCatalogueSections(
  db: Db,
  eventId: string,
  now: Date,
): Promise<CatalogueSectionRow[]> {
  return db.$queryRaw<CatalogueSectionRow[]>`
    SELECT s.id, s.name, s.type::text AS type,
      (count(*) FILTER (WHERE b.releases_at <= ${now}))::int AS total,
      (count(*) FILTER (WHERE b.releases_at <= ${now} AND u.status = 'SOLD'))::int AS sold,
      (count(*) FILTER (
        WHERE b.releases_at <= ${now} AND u.status = 'HELD' AND u.held_until > ${now}
      ))::int AS held,
      min(u.price_cents) AS "minPriceCents",
      max(u.price_cents) AS "maxPriceCents",
      min(b.releases_at) FILTER (WHERE b.releases_at > ${now}) AS "nextReleaseAt"
    FROM inventory_units u
    JOIN ticket_batches b ON b.id = u.batch_id
    JOIN sections s ON s.id = u.section_id
    WHERE u.event_id = ${eventId}::uuid
    GROUP BY s.id
    ORDER BY s.sort_order`;
}
