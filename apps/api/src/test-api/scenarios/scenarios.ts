/**
 * Seed scenarios (`POST /__test/seed/{scenario}`). Each builder is a pure function of its context:
 * it returns the rows to insert and the response body that describes them. Every run gets its own
 * venue, events and buyer, with fresh IDs and `ctx.suffix` in every slug and title, so runs never
 * collide and parallel tests can each create their own data.
 *
 * Event dates are relative to the start of the clock's UTC day (`D`), like the baseline seed.
 */
import { HOLD_DURATION_SEC, MAX_TICKETS_PER_ORDER } from '@testtix/shared';

import type { Prisma } from '../../generated/prisma/client.js';
import type { DayTime } from '../../seed/fixtures.js';
import type { CatalogueEventSpec } from '../../seed/seed-data.js';
import {
  addBuyer,
  addCustomer,
  buildScenarioCatalogue,
  holdUnits,
  requireId,
  type ScenarioContext,
  type ScenarioRows,
  scenarioVenue,
  sellUnits,
} from './scenario-data.js';
import type {
  BasicCatalogueResult,
  GaLastTicketResult,
  GaMeetupResult,
  HoldAboutToExpireRequest,
  HoldAboutToExpireScenario,
  OneSeatLeftResult,
  ScenarioEvent,
  ScenarioGaSection,
  ScenarioSeat,
  ScenarioVenue,
  SoldOutEventResult,
} from './scenario.schemas.js';

export interface Scenario<TResult> {
  rows: ScenarioRows;
  result: TResult;
}

/** Scenario events have been on sale since the day before. */
const ON_SALE: DayTime = [-1, '15:00'];

function scenarioEvent(
  ctx: ScenarioContext,
  event: Pick<CatalogueEventSpec, 'category' | 'starts' | 'durationMin' | 'batches'> & {
    slug: string;
    title: string;
    description: string;
  },
): CatalogueEventSpec {
  return {
    ...event,
    slug: `${event.slug}-${ctx.suffix}`,
    title: `${event.title} ${ctx.suffix}`,
    performer: `Scenario Artist ${ctx.suffix}`,
    status: 'PUBLISHED',
    venue: `scenario-venue-${ctx.suffix}`,
    salesOpen: ON_SALE,
  };
}

/** Three published events on sale (concert, talk, meetup) at a venue with seats and a GA area. */
export function basicCatalogue(ctx: ScenarioContext): Scenario<BasicCatalogueResult> {
  const rows = buildScenarioCatalogue(
    ctx,
    scenarioVenue(ctx, [
      { name: 'Seats', type: 'SEATED', rows: 3, seatsPerRow: 6 },
      { name: 'Standing', type: 'GA', capacity: 20 },
    ]),
    [
      scenarioEvent(ctx, {
        slug: 'scenario-concert',
        title: 'Scenario Concert',
        description: 'Test scenario basic-catalogue: seats and a standing area.',
        category: 'CONCERT',
        starts: [14, '23:00'],
        durationMin: 150,
        batches: [
          { name: 'Seats', priceCents: 4000, sections: ['Seats'], releases: ON_SALE },
          { name: 'Standing', priceCents: 2500, sections: ['Standing'], releases: ON_SALE },
        ],
      }),
      scenarioEvent(ctx, {
        slug: 'scenario-talk',
        title: 'Scenario Talk',
        description: 'Test scenario basic-catalogue: a seated talk.',
        category: 'TALK',
        starts: [7, '23:00'],
        durationMin: 90,
        batches: [{ name: 'General', priceCents: 1500, sections: ['Seats'], releases: ON_SALE }],
      }),
      scenarioEvent(ctx, {
        slug: 'scenario-meetup',
        title: 'Scenario Meetup',
        description: 'Test scenario basic-catalogue: a general-admission meetup.',
        category: 'MEETUP',
        starts: [10, '23:00'],
        durationMin: 120,
        batches: [{ name: 'Entry', priceCents: 500, sections: ['Standing'], releases: ON_SALE }],
      }),
    ],
  );
  const [concert, talk, meetup] = rows.events.map((event) => describeEvent(rows, event.id));
  if (concert === undefined || talk === undefined || meetup === undefined) {
    throw new Error('basic-catalogue: expected three events');
  }
  return { rows, result: { venue: describeVenue(rows), events: { concert, talk, meetup } } };
}

/** A published, on-sale event whose every ticket (12 seats and GA places) is sold. */
export function soldOutEvent(ctx: ScenarioContext): Scenario<SoldOutEventResult> {
  const rows = buildScenarioCatalogue(
    ctx,
    scenarioVenue(ctx, [
      { name: 'Seats', type: 'SEATED', rows: 2, seatsPerRow: 4 },
      { name: 'Standing', type: 'GA', capacity: 4 },
    ]),
    [
      scenarioEvent(ctx, {
        slug: 'sold-out-show',
        title: 'Sold Out Show',
        description: 'Test scenario sold-out-event: every ticket is sold.',
        category: 'CONCERT',
        starts: [14, '23:00'],
        durationMin: 150,
        batches: [
          { name: 'Seats', priceCents: 5000, sections: ['Seats'], releases: ON_SALE },
          { name: 'Standing', priceCents: 3000, sections: ['Standing'], releases: ON_SALE },
        ],
      }),
    ],
  );
  const eventId = onlyEventId(rows);
  const buyer = addBuyer(rows, ctx);
  const orderIds = sellUnits(rows, ctx, rows.inventoryUnits, buyer.id);
  return {
    rows,
    result: {
      venue: describeVenue(rows),
      event: describeEvent(rows, eventId),
      buyer: { id: buyer.id, email: buyer.email },
      orderIds,
    },
  };
}

/**
 * A published, on-sale seated event with 8 seats, all sold but the last one (row B, seat 4).
 * Holding `seat` succeeds once; holding any of `soldSeats` is a 409.
 */
export function oneSeatLeft(ctx: ScenarioContext): Scenario<OneSeatLeftResult> {
  const rows = buildScenarioCatalogue(
    ctx,
    scenarioVenue(ctx, [{ name: 'Seats', type: 'SEATED', rows: 2, seatsPerRow: 4 }]),
    [
      scenarioEvent(ctx, {
        slug: 'one-seat-left',
        title: 'One Seat Left',
        description: 'Test scenario one-seat-left: a single seat is still available.',
        category: 'CONCERT',
        starts: [14, '23:00'],
        durationMin: 120,
        batches: [{ name: 'General', priceCents: 4500, sections: ['Seats'], releases: ON_SALE }],
      }),
    ],
  );
  const eventId = onlyEventId(rows);
  const last = rows.inventoryUnits.at(-1);
  if (last === undefined) throw new Error('one-seat-left: no last seat');
  const sold = rows.inventoryUnits.slice(0, -1);
  const buyer = addBuyer(rows, ctx);
  const orderIds = sellUnits(rows, ctx, sold, buyer.id);
  return {
    rows,
    result: {
      venue: describeVenue(rows),
      event: describeEvent(rows, eventId),
      buyer: { id: buyer.id, email: buyer.email },
      orderIds,
      seat: describeSeat(rows, last),
      soldSeats: sold.map((unit) => describeSeat(rows, unit)),
    },
  };
}

/**
 * A published, on-sale seated event (8 seats, $45.00) where a new customer holds row A seats 1
 * and 2 in a hold that expires `expiresInSec` from now. The hold was made as if by
 * `POST /events/{eventId}/holds`: its `createdAt` is the event's hold duration (600 s) before
 * `expiresAt`. The service logs the holder in.
 */
export function holdAboutToExpire(
  ctx: ScenarioContext,
  { expiresInSec }: HoldAboutToExpireRequest,
): Scenario<HoldAboutToExpireScenario> {
  const rows = buildScenarioCatalogue(
    ctx,
    scenarioVenue(ctx, [{ name: 'Seats', type: 'SEATED', rows: 2, seatsPerRow: 4 }]),
    [
      scenarioEvent(ctx, {
        slug: 'hold-about-to-expire',
        title: 'Hold About To Expire',
        description: 'Test scenario hold-about-to-expire: two seats are held, briefly.',
        category: 'CONCERT',
        starts: [14, '23:00'],
        durationMin: 120,
        batches: [{ name: 'General', priceCents: 4500, sections: ['Seats'], releases: ON_SALE }],
      }),
    ],
  );
  const eventId = onlyEventId(rows);
  const units = rows.inventoryUnits.slice(0, 2);
  const holder = addCustomer(rows, ctx, 'holder');
  const expiresAt = new Date(ctx.now.getTime() + expiresInSec * 1000);
  const createdAt = new Date(expiresAt.getTime() - HOLD_DURATION_SEC.default * 1000);
  const holdId = holdUnits(rows, ctx, units, { userId: holder.id, createdAt, expiresAt });
  return {
    rows,
    result: {
      venue: describeVenue(rows),
      event: describeEvent(rows, eventId),
      holderId: holder.id,
      hold: {
        id: holdId,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        totalCents: units.reduce((sum, unit) => sum + unit.priceCents, 0),
        seats: units.map((unit) => describeSeat(rows, unit)),
      },
    },
  };
}

/**
 * A published, on-sale general-admission meetup with two GA sections: Floor (40 places: an early
 * bird batch of 20 at $10.00 and a regular batch of 20 at $15.00) and Balcony (10 at $20.00).
 */
export function gaMeetup(ctx: ScenarioContext): Scenario<GaMeetupResult> {
  const rows = buildScenarioCatalogue(
    ctx,
    scenarioVenue(ctx, [
      { name: 'Floor', type: 'GA', capacity: 40 },
      { name: 'Balcony', type: 'GA', capacity: 10 },
    ]),
    [
      scenarioEvent(ctx, {
        slug: 'ga-meetup',
        title: 'GA Meetup',
        description: 'Test scenario ga-meetup: general admission only, in two sections.',
        category: 'MEETUP',
        starts: [10, '23:00'],
        durationMin: 180,
        batches: [
          { name: 'Early bird', priceCents: 1000, sections: ['Floor'], releases: ON_SALE },
          { name: 'Balcony', priceCents: 2000, sections: ['Balcony'], releases: ON_SALE },
        ],
      }),
    ],
  );
  const eventId = onlyEventId(rows);
  const floor = requireSection(rows, 'Floor');
  const balcony = requireSection(rows, 'Balcony');
  // The seed builder releases a whole section per batch; move the second half of the Floor into
  // a "Regular" batch, as an admin releasing 20 places, then 20 more at a higher price, would.
  const earlyBird = rows.ticketBatches.find((batch) => batch.name === 'Early bird');
  if (earlyBird === undefined) throw new Error('ga-meetup: no early bird batch');
  const regularId = ctx.newId();
  rows.ticketBatches.push({ ...earlyBird, id: regularId, name: 'Regular', priceCents: 1500 });
  for (const unit of rows.inventoryUnits.filter((u) => u.sectionId === floor).slice(20)) {
    unit.batchId = regularId;
    unit.priceCents = 1500;
  }
  return {
    rows,
    result: {
      venue: describeVenue(rows),
      event: describeEvent(rows, eventId),
      sections: {
        floor: describeGaSection(rows, floor),
        balcony: describeGaSection(rows, balcony),
      },
    },
  };
}

/** A published, on-sale GA meetup whose Floor (10 places, $8.00) has one place left. */
export function gaLastTicket(ctx: ScenarioContext): Scenario<GaLastTicketResult> {
  const rows = buildScenarioCatalogue(
    ctx,
    scenarioVenue(ctx, [{ name: 'Floor', type: 'GA', capacity: 10 }]),
    [
      scenarioEvent(ctx, {
        slug: 'ga-last-ticket',
        title: 'GA Last Ticket',
        description: 'Test scenario ga-last-ticket: one general-admission place is left.',
        category: 'MEETUP',
        starts: [10, '23:00'],
        durationMin: 120,
        batches: [{ name: 'Entry', priceCents: 800, sections: ['Floor'], releases: ON_SALE }],
      }),
    ],
  );
  const eventId = onlyEventId(rows);
  const buyer = addBuyer(rows, ctx);
  const orderIds = sellUnits(rows, ctx, rows.inventoryUnits.slice(0, -1), buyer.id);
  return {
    rows,
    result: {
      venue: describeVenue(rows),
      event: describeEvent(rows, eventId),
      buyer: { id: buyer.id, email: buyer.email },
      orderIds,
      section: describeGaSection(rows, requireSection(rows, 'Floor')),
    },
  };
}

function requireSection(rows: ScenarioRows, name: string): string {
  const section = rows.sections.find((s) => s.name === name);
  if (section === undefined) throw new Error(`Scenario without section ${name}`);
  return requireId(section);
}

function describeSeat(rows: ScenarioRows, unit: Prisma.InventoryUnitCreateManyInput): ScenarioSeat {
  const seat = rows.seats.find((s) => s.id === unit.seatId);
  if (seat === undefined) throw new Error('Scenario unit without a seat');
  return {
    id: requireId(seat),
    sectionId: seat.sectionId,
    row: seat.row,
    number: seat.number,
    inventoryUnitId: requireId(unit),
    priceCents: unit.priceCents,
  };
}

/** A GA section with the places a hold could take (every scenario batch is released). */
function describeGaSection(rows: ScenarioRows, sectionId: string): ScenarioGaSection {
  const section = rows.sections.find((s) => s.id === sectionId);
  if (section?.capacity === undefined || section.capacity === null)
    throw new Error(`Scenario without GA section ${sectionId}`);
  const available = rows.inventoryUnits.filter(
    (unit) => unit.sectionId === sectionId && unit.status === 'AVAILABLE',
  );
  const byPrice = new Map<number, number>();
  for (const unit of available)
    byPrice.set(unit.priceCents, (byPrice.get(unit.priceCents) ?? 0) + 1);
  return {
    id: sectionId,
    name: section.name,
    capacity: section.capacity,
    available: available.length,
    prices: [...byPrice]
      .sort(([a], [b]) => a - b)
      .map(([priceCents, count]) => ({ priceCents, available: count })),
  };
}

function onlyEventId(rows: ScenarioRows): string {
  const [event, ...rest] = rows.events;
  if (event === undefined || rest.length > 0) throw new Error('Expected exactly one event');
  return requireId(event);
}

function describeVenue(rows: ScenarioRows): ScenarioVenue {
  const [venue] = rows.venues;
  if (venue === undefined) throw new Error('Scenario without a venue');
  return {
    id: requireId(venue),
    slug: venue.slug,
    name: venue.name,
    sections: rows.sections.map((section) => ({
      id: requireId(section),
      name: section.name,
      type: section.type,
      capacity: section.capacity ?? null,
    })),
  };
}

function describeEvent(rows: ScenarioRows, eventId: string | undefined): ScenarioEvent {
  const event = rows.events.find((e) => e.id === eventId);
  if (event === undefined) throw new Error(`Scenario without event ${String(eventId)}`);
  const units = rows.inventoryUnits.filter((unit) => unit.eventId === eventId);
  const count = (status: string) => units.filter((unit) => unit.status === status).length;
  return {
    id: requireId(event),
    slug: event.slug,
    title: event.title,
    category: event.category,
    status: event.status ?? 'DRAFT',
    venueId: event.venueId,
    startsAt: new Date(event.startsAt).toISOString(),
    salesOpenAt: new Date(event.salesOpenAt).toISOString(),
    holdDurationSec: event.holdDurationSec ?? HOLD_DURATION_SEC.default,
    maxTicketsPerOrder: event.maxTicketsPerOrder ?? MAX_TICKETS_PER_ORDER.default,
    tickets: {
      total: units.length,
      available: count('AVAILABLE'),
      held: count('HELD'),
      sold: count('SOLD'),
    },
  };
}
