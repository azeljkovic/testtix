import type { SeatStatus } from '@testtix/shared';

import type { Prisma } from '../generated/prisma/client.js';

type Db = Prisma.TransactionClient;

export interface SeatRow {
  sectionId: string;
  seatId: string;
  row: string;
  rowIndex: number;
  number: number;
  priceCents: number | null;
  status: SeatStatus;
}

export interface GaPriceRow {
  sectionId: string;
  priceCents: number;
  available: number;
}

/**
 * Every seat of the venue with its status for the event at `now`, by section order, row and
 * number. A seat is `NOT_ON_SALE` without an inventory unit or while the unit's batch is
 * unreleased, and `AVAILABLE` when its hold has expired (lazy expiry, like `countUnits()`).
 */
export function findSeatRows(
  db: Db,
  eventId: string,
  venueId: string,
  now: Date,
): Promise<SeatRow[]> {
  return db.$queryRaw<SeatRow[]>`
    SELECT s.id AS "sectionId", st.id AS "seatId", st.row, st.row_index AS "rowIndex", st.number,
      u.price_cents AS "priceCents",
      CASE
        WHEN u.id IS NULL OR b.releases_at > ${now} THEN 'NOT_ON_SALE'
        WHEN u.status = 'SOLD' THEN 'SOLD'
        WHEN u.status = 'HELD' AND u.held_until > ${now} THEN 'HELD'
        ELSE 'AVAILABLE'
      END AS status
    FROM sections s
    JOIN seats st ON st.section_id = s.id
    LEFT JOIN inventory_units u ON u.event_id = ${eventId}::uuid AND u.seat_id = st.id
    LEFT JOIN ticket_batches b ON b.id = u.batch_id
    WHERE s.venue_id = ${venueId}::uuid
    ORDER BY s.sort_order, st.row_index, st.number`;
}

/**
 * The event's GA places that a hold could claim at `now` (released, and available or in an
 * expired hold), per section and price.
 */
export function findGaPriceRows(db: Db, eventId: string, now: Date): Promise<GaPriceRow[]> {
  return db.$queryRaw<GaPriceRow[]>`
    SELECT u.section_id AS "sectionId", u.price_cents AS "priceCents", count(*)::int AS available
    FROM inventory_units u
    JOIN ticket_batches b ON b.id = u.batch_id
    WHERE u.event_id = ${eventId}::uuid
      AND u.seat_id IS NULL
      AND b.releases_at <= ${now}
      AND (u.status = 'AVAILABLE' OR (u.status = 'HELD' AND u.held_until <= ${now}))
    GROUP BY u.section_id, u.price_cents
    ORDER BY u.section_id, u.price_cents`;
}
