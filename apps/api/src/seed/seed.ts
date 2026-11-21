import type { PrismaClient } from '../generated/prisma/client.js';
import { buildSeedData } from './seed-data.js';

/** Rows per INSERT: well below Postgres' 65,535 bind parameters for the widest table. */
const CHUNK_SIZE = 2_000;

export interface SeedSummary {
  venues: number;
  sections: number;
  seats: number;
  events: number;
  ticketBatches: number;
  inventoryUnits: number;
}

/** The database already has catalogue data; the seed only runs against empty tables. */
export class SeedTargetNotEmptyError extends Error {
  constructor() {
    super('The database already has venues or events. Reset it first (pnpm db:reset).');
    this.name = 'SeedTargetNotEmptyError';
  }
}

/**
 * Inserts the baseline data set (`buildSeedData`) in one transaction, so a failure leaves
 * nothing behind. `now` should come from `ClockService`: the data is relative to its UTC day.
 * Refuses to run when venues or events already exist, rather than mixing data sets.
 */
export async function seedDatabase(prisma: PrismaClient, now: Date): Promise<SeedSummary> {
  const data = buildSeedData(now);
  await prisma.$transaction(
    async (tx) => {
      // Lock out a concurrent seed between the emptiness check and the inserts.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('testtix:seed'))`;
      const [venues, events] = await Promise.all([tx.venue.count(), tx.event.count()]);
      if (venues > 0 || events > 0) throw new SeedTargetNotEmptyError();

      for (const rows of chunks(data.venues)) await tx.venue.createMany({ data: rows });
      for (const rows of chunks(data.sections)) await tx.section.createMany({ data: rows });
      for (const rows of chunks(data.seats)) await tx.seat.createMany({ data: rows });
      for (const rows of chunks(data.events)) await tx.event.createMany({ data: rows });
      for (const rows of chunks(data.ticketBatches)) {
        await tx.ticketBatch.createMany({ data: rows });
      }
      for (const rows of chunks(data.inventoryUnits)) {
        await tx.inventoryUnit.createMany({ data: rows });
      }
    },
    { timeout: 60_000 },
  );
  return {
    venues: data.venues.length,
    sections: data.sections.length,
    seats: data.seats.length,
    events: data.events.length,
    ticketBatches: data.ticketBatches.length,
    inventoryUnits: data.inventoryUnits.length,
  };
}

function* chunks<T>(rows: readonly T[]): Generator<T[]> {
  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    yield rows.slice(start, start + CHUNK_SIZE);
  }
}
