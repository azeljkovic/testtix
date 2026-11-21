/**
 * Seed scenarios (`POST /__test/seed/{scenario}`). Each builder is a pure function of its context:
 * it returns the rows to insert and the response body that describes them. Every run gets its own
 * venue, events and buyer, with fresh IDs and `ctx.suffix` in every slug and title, so runs never
 * collide and parallel tests can each create their own data.
 *
 * Event dates are relative to the start of the clock's UTC day (`D`), like the baseline seed.
 */
import type { DayTime } from '../../seed/fixtures.js';
import type { CatalogueEventSpec } from '../../seed/seed-data.js';
import {
  addBuyer,
  buildScenarioCatalogue,
  requireId,
  type ScenarioContext,
  type ScenarioRows,
  scenarioVenue,
  sellUnits,
} from './scenario-data.js';
import type {
  BasicCatalogueResult,
  OneSeatLeftResult,
  ScenarioEvent,
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

/** A published, on-sale seated event with 8 seats, all sold but the last one (row B, seat 4). */
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
  const seat = rows.seats.find((s) => s.id === last?.seatId);
  if (last === undefined || seat === undefined) throw new Error('one-seat-left: no last seat');
  const buyer = addBuyer(rows, ctx);
  const orderIds = sellUnits(rows, ctx, rows.inventoryUnits.slice(0, -1), buyer.id);
  return {
    rows,
    result: {
      venue: describeVenue(rows),
      event: describeEvent(rows, eventId),
      buyer: { id: buyer.id, email: buyer.email },
      orderIds,
      seat: {
        id: requireId(seat),
        sectionId: seat.sectionId,
        row: seat.row,
        number: seat.number,
        inventoryUnitId: requireId(last),
        priceCents: last.priceCents,
      },
    },
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
    tickets: { total: units.length, available: count('AVAILABLE'), sold: count('SOLD') },
  };
}
