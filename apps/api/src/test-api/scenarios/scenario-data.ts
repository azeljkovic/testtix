import { randomBytes } from 'node:crypto';

import type { Prisma } from '../../generated/prisma/client.js';
import type { VenueSpec } from '../../seed/fixtures.js';
import { buildCatalogue, type CatalogueEventSpec, type SeedData } from '../../seed/seed-data.js';
import type { ExtraRows } from '../../seed/seed.js';

/** Every row a scenario inserts, table by table. */
export type ScenarioRows = SeedData & ExtraRows;

export interface ScenarioContext {
  /** Server "now" (from `ClockService`). Event dates are relative to its UTC day. */
  readonly now: Date;
  /** Makes this run's slugs, titles and emails unique, e.g. `3f9a1c2b`. */
  readonly suffix: string;
  /** A new, unique row ID. */
  readonly newId: () => string;
  /** A new, unguessable ticket code. */
  readonly newTicketCode: () => string;
}

/** A random 8-character hex suffix for one scenario run. */
export function newScenarioSuffix(): string {
  return randomBytes(4).toString('hex');
}

/** Scenario tickets get codes like the ones checkout issues. */
export { newTicketCode } from '../../tickets/ticket-code.js';

/**
 * `passwordHash` of the buyers scenarios create. It is not an argon2 hash, so no password matches
 * it and nobody can log in as a scenario buyer (C1.4's login treats it as a wrong password).
 */
export const LOCKED_PASSWORD_HASH = '!locked';

/**
 * Default `Event.maxTicketsPerOrder` (Prisma schema). Scenario events keep the default, and their
 * sold-out orders respect it.
 */
export const DEFAULT_MAX_TICKETS_PER_ORDER = 6;

/** Default `Event.holdDurationSec` (Prisma schema): an order's payment window. */
const DEFAULT_HOLD_DURATION_SEC = 600;

/**
 * Builds a venue and events for one scenario run: like the baseline seed (`buildCatalogue`), but
 * with fresh random IDs and with `createdAt` at `now`, so the rows look as if an admin had just
 * created them. Slugs must already carry `ctx.suffix`.
 */
export function buildScenarioCatalogue(
  ctx: ScenarioContext,
  venue: VenueSpec,
  events: readonly CatalogueEventSpec[],
): ScenarioRows {
  const ids = new Map<string, string>();
  const id = (key: string): string => {
    let value = ids.get(key);
    if (value === undefined) {
      value = ctx.newId();
      ids.set(key, value);
    }
    return value;
  };
  const catalogue = buildCatalogue(ctx.now, {
    venues: [venue],
    events,
    id,
    createdAt: ctx.now,
  });
  return { ...catalogue, holds: [], orders: [], orderItems: [], tickets: [] };
}

/** A placeholder customer who owns a scenario's orders. Can't log in. */
export function addBuyer(rows: ScenarioRows, ctx: ScenarioContext): { id: string; email: string } {
  return addCustomer(rows, ctx, 'buyer');
}

/**
 * A verified customer without a usable password, e.g. `holder-<suffix>@scenario.testtix.test`.
 * Nobody can log in as them, but the test API can start a session for them.
 */
export function addCustomer(
  rows: ScenarioRows,
  ctx: ScenarioContext,
  kind: 'buyer' | 'holder' | 'customer',
): { id: string; email: string } {
  const label = { buyer: 'Buyer', holder: 'Holder', customer: 'Customer' }[kind];
  const buyer = {
    id: ctx.newId(),
    email: `${kind}-${ctx.suffix}@scenario.testtix.test`,
    passwordHash: LOCKED_PASSWORD_HASH,
    name: `Scenario ${label} ${ctx.suffix}`,
    role: 'CUSTOMER',
    emailVerifiedAt: ctx.now,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  } satisfies Prisma.UserCreateManyInput;
  rows.users.push(buyer);
  return { id: buyer.id, email: buyer.email };
}

/**
 * Sells inventory units the way checkout does (C4): marks them `SOLD` and adds `CONFIRMED`
 * orders for `buyerId`, with one order item and one ticket per unit, at most
 * `DEFAULT_MAX_TICKETS_PER_ORDER` units per order. Returns the order IDs. No e-ticket email is
 * due for them (`ticketsEmailedAt` is set), so the recovery job never sends one.
 */
export function sellUnits(
  rows: ScenarioRows,
  ctx: ScenarioContext,
  units: readonly Prisma.InventoryUnitCreateManyInput[],
  buyerId: string,
): string[] {
  const orderIds: string[] = [];
  for (let start = 0; start < units.length; start += DEFAULT_MAX_TICKETS_PER_ORDER) {
    const batch = units.slice(start, start + DEFAULT_MAX_TICKETS_PER_ORDER);
    const eventId = batch[0]?.eventId;
    if (eventId === undefined || batch.some((unit) => unit.eventId !== eventId)) {
      throw new Error('sellUnits: every order needs units of one event');
    }
    const orderId = ctx.newId();
    orderIds.push(orderId);
    rows.orders.push({
      id: orderId,
      userId: buyerId,
      eventId,
      status: 'CONFIRMED',
      totalCents: batch.reduce((sum, unit) => sum + unit.priceCents, 0),
      expiresAt: new Date(ctx.now.getTime() + DEFAULT_HOLD_DURATION_SEC * 1000),
      ticketsEmailedAt: ctx.now,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    for (const unit of batch) {
      unit.status = 'SOLD';
      const orderItemId = ctx.newId();
      rows.orderItems.push({
        id: orderItemId,
        orderId,
        inventoryUnitId: requireId(unit),
        priceCents: unit.priceCents,
      });
      rows.tickets.push({
        id: ctx.newId(),
        orderItemId,
        code: ctx.newTicketCode(),
        issuedAt: ctx.now,
      });
    }
  }
  return orderIds;
}

/**
 * Puts inventory units in a new hold of `userId` that expires at `expiresAt`, the way
 * `POST /events/{eventId}/holds` does. Returns the hold ID.
 */
export function holdUnits(
  rows: ScenarioRows,
  ctx: ScenarioContext,
  units: readonly Prisma.InventoryUnitCreateManyInput[],
  hold: { userId: string; createdAt: Date; expiresAt: Date },
): string {
  const eventId = units[0]?.eventId;
  if (eventId === undefined || units.some((unit) => unit.eventId !== eventId)) {
    throw new Error('holdUnits: a hold needs units of one event');
  }
  const holdId = ctx.newId();
  rows.holds.push({ id: holdId, eventId, ...hold });
  for (const unit of units) {
    if (unit.status !== 'AVAILABLE') throw new Error('holdUnits: unit is not available');
    unit.status = 'HELD';
    unit.holdId = holdId;
    unit.heldUntil = hold.expiresAt;
  }
  return holdId;
}

/** A small venue for one scenario run. */
export function scenarioVenue(ctx: ScenarioContext, sections: VenueSpec['sections']): VenueSpec {
  return {
    slug: `scenario-venue-${ctx.suffix}`,
    name: `Scenario Venue ${ctx.suffix}`,
    address: '1 Scenario Street',
    sections,
  };
}

/** The ID of a built row. The builders always set one; Prisma's input type allows leaving it out. */
export function requireId(row: { id?: string }): string {
  if (row.id === undefined) throw new Error('Scenario row without an ID');
  return row.id;
}
