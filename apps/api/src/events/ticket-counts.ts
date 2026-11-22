import type { Prisma } from '../generated/prisma/client.js';
import type { TicketCounts } from './event.schemas.js';

/** Inventory units of one event, batch and section, by state. */
export interface UnitCountRow {
  eventId: string;
  batchId: string;
  sectionId: string;
  total: number;
  sold: number;
  held: number;
}

/**
 * Counts the inventory units of `eventIds` per event, batch and section. A `HELD` unit counts as
 * held only while its hold lasts (`heldUntil > now`); after that it is available again, even
 * before the sweeper (C3.2) resets it.
 */
export async function countUnits(
  db: Prisma.TransactionClient,
  eventIds: readonly string[],
  now: Date,
): Promise<UnitCountRow[]> {
  if (eventIds.length === 0) return [];
  return db.$queryRaw<UnitCountRow[]>`
    SELECT event_id AS "eventId", batch_id AS "batchId", section_id AS "sectionId",
      count(*)::int AS total,
      (count(*) FILTER (WHERE status = 'SOLD'))::int AS sold,
      (count(*) FILTER (WHERE status = 'HELD' AND held_until > ${now}))::int AS held
    FROM inventory_units
    WHERE event_id = ANY(${eventIds}::uuid[])
    GROUP BY event_id, batch_id, section_id`;
}

/** Adds up count rows (all of them, or the ones `filter` keeps). */
export function sumCounts<TRow extends Pick<UnitCountRow, 'total' | 'sold' | 'held'>>(
  rows: readonly TRow[],
  filter: (row: TRow) => boolean = () => true,
): TicketCounts {
  const sums = { total: 0, sold: 0, held: 0 };
  for (const row of rows) {
    if (!filter(row)) continue;
    sums.total += row.total;
    sums.sold += row.sold;
    sums.held += row.held;
  }
  return { ...sums, available: sums.total - sums.sold - sums.held };
}
