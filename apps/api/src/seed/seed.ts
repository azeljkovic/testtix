import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { chunks } from '../infra/chunks.js';
import { buildSeedData, type SeedData } from './seed-data.js';

/** Serializes everything that seeds or wipes the database (seed, reset). */
const SEED_LOCK_KEY = 'testtix:seed';

/** Long enough for the baseline's ~10k rows on a slow CI runner. */
const SEED_TRANSACTION_TIMEOUT_MS = 60_000;

export interface SeedSummary {
  users: number;
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
      // Lock out a concurrent seed or reset between the emptiness check and the inserts.
      await lockSeed(tx);
      const [venues, events] = await Promise.all([tx.venue.count(), tx.event.count()]);
      if (venues > 0 || events > 0) throw new SeedTargetNotEmptyError();
      await insertRows(tx, data);
    },
    { timeout: SEED_TRANSACTION_TIMEOUT_MS },
  );
  return summarize(data);
}

/**
 * Empties every table and inserts the baseline data set, in one transaction: other requests see
 * either the old data or the complete new baseline, never an empty or half-seeded database, and a
 * failure changes nothing. Concurrent resets run one after the other. Used by `POST /__test/reset`.
 */
export async function resetAndSeedDatabase(prisma: PrismaClient, now: Date): Promise<SeedSummary> {
  const data = buildSeedData(now);
  await prisma.$transaction(
    async (tx) => {
      await lockSeed(tx);
      await truncateAllTables(tx);
      await insertRows(tx, data);
    },
    { timeout: SEED_TRANSACTION_TIMEOUT_MS },
  );
  return summarize(data);
}

/** Rows of tables the baseline leaves empty, for data sets that add them (test scenarios). */
export interface ExtraRows {
  orders: Prisma.OrderCreateManyInput[];
  orderItems: Prisma.OrderItemCreateManyInput[];
  tickets: Prisma.TicketCreateManyInput[];
}

/** Inserts a data set table by table, parents first, in chunks. Run it inside a transaction. */
export async function insertRows(
  tx: Prisma.TransactionClient,
  data: SeedData & Partial<ExtraRows>,
): Promise<void> {
  for (const rows of chunks(data.users)) await tx.user.createMany({ data: rows });
  for (const rows of chunks(data.venues)) await tx.venue.createMany({ data: rows });
  for (const rows of chunks(data.sections)) await tx.section.createMany({ data: rows });
  for (const rows of chunks(data.seats)) await tx.seat.createMany({ data: rows });
  for (const rows of chunks(data.events)) await tx.event.createMany({ data: rows });
  for (const rows of chunks(data.ticketBatches)) await tx.ticketBatch.createMany({ data: rows });
  for (const rows of chunks(data.inventoryUnits)) {
    await tx.inventoryUnit.createMany({ data: rows });
  }
  for (const rows of chunks(data.orders ?? [])) await tx.order.createMany({ data: rows });
  for (const rows of chunks(data.orderItems ?? [])) await tx.orderItem.createMany({ data: rows });
  for (const rows of chunks(data.tickets ?? [])) await tx.ticket.createMany({ data: rows });
}

/** The client methods `truncateAllTables` needs: a `PrismaClient` or a transaction client. */
export type RawSqlClient = Pick<PrismaClient, '$queryRaw' | '$executeRawUnsafe'>;

/**
 * Empties every table in the `public` schema except Prisma's migration history. Lists the tables
 * at run time, so tables added by later migrations are included without changes here.
 */
export async function truncateAllTables(db: RawSqlClient): Promise<void> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename`;
  if (tables.length === 0) return;
  const list = tables.map(({ tablename }) => `"public"."${tablename.replaceAll('"', '""')}"`);
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list.join(', ')} RESTART IDENTITY CASCADE`);
}

async function lockSeed(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SEED_LOCK_KEY}::text))`;
}

function summarize(data: SeedData): SeedSummary {
  return {
    users: data.users.length,
    venues: data.venues.length,
    sections: data.sections.length,
    seats: data.seats.length,
    events: data.events.length,
    ticketBatches: data.ticketBatches.length,
    inventoryUnits: data.inventoryUnits.length,
  };
}
