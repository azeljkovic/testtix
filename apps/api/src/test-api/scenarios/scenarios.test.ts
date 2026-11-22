import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_TICKETS_PER_ORDER,
  LOCKED_PASSWORD_HASH,
  type ScenarioContext,
  type ScenarioRows,
} from './scenario-data.js';
import {
  BasicCatalogueResultSchema,
  GaLastTicketResultSchema,
  GaMeetupResultSchema,
  HoldAboutToExpireResultSchema,
  OneSeatLeftResultSchema,
  SoldOutEventResultSchema,
} from './scenario.schemas.js';
import {
  basicCatalogue,
  gaLastTicket,
  gaMeetup,
  holdAboutToExpire,
  oneSeatLeft,
  soldOutEvent,
} from './scenarios.js';

const NOW = new Date('2026-11-21T10:15:00.000Z');

function context(suffix = 'abc12345'): ScenarioContext {
  let ids = 0;
  let codes = 0;
  return {
    now: NOW,
    suffix,
    newId: () => `00000000-0000-7000-8000-${(++ids).toString(16).padStart(12, '0')}`,
    newTicketCode: () => `code-${String(++codes)}`,
  };
}

/** Invariants every scenario keeps, so its rows are valid data for the rest of the app. */
function expectConsistent(rows: ScenarioRows) {
  const ids = Object.values(rows).flatMap((table: { id?: string }[]) => table.map((r) => r.id));
  expect(new Set(ids).size).toBe(ids.length);

  const unitById = new Map(rows.inventoryUnits.map((unit) => [unit.id, unit]));
  const itemsByOrder = new Map<string, number>();
  for (const item of rows.orderItems) {
    const unit = unitById.get(item.inventoryUnitId);
    expect(unit?.status).toBe('SOLD');
    expect(item.priceCents).toBe(unit?.priceCents);
    itemsByOrder.set(item.orderId, (itemsByOrder.get(item.orderId) ?? 0) + 1);
  }
  const soldUnits = rows.inventoryUnits.filter((unit) => unit.status === 'SOLD');
  expect(rows.orderItems).toHaveLength(soldUnits.length);
  expect(rows.tickets.map((t) => t.orderItemId).sort()).toEqual(
    rows.orderItems.map((item) => item.id).sort(),
  );
  for (const order of rows.orders) {
    expect(order.status).toBe('CONFIRMED');
    const count = itemsByOrder.get(order.id ?? '') ?? 0;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(DEFAULT_MAX_TICKETS_PER_ORDER);
    const items = rows.orderItems.filter((item) => item.orderId === order.id);
    expect(order.totalCents).toBe(items.reduce((sum, item) => sum + item.priceCents, 0));
  }
  const holdById = new Map(rows.holds.map((hold) => [hold.id, hold]));
  for (const unit of rows.inventoryUnits) {
    if (unit.status !== 'HELD') {
      expect(unit.holdId ?? null).toBeNull();
      continue;
    }
    const hold = holdById.get(unit.holdId ?? '');
    expect(hold?.eventId).toBe(unit.eventId);
    expect(unit.heldUntil).toEqual(hold?.expiresAt);
  }
  for (const hold of rows.holds) {
    expect(rows.users.map((user) => user.id)).toContain(hold.userId);
  }
  for (const user of rows.users) {
    expect(user.email).toBe(user.email.toLowerCase());
    expect(user.passwordHash).toBe(LOCKED_PASSWORD_HASH);
  }
  for (const event of rows.events) {
    expect(event).toMatchObject({ status: 'PUBLISHED', createdAt: NOW });
    expect(new Date(event.salesOpenAt).getTime()).toBeLessThan(NOW.getTime());
    expect(new Date(event.startsAt).getTime()).toBeGreaterThan(NOW.getTime());
  }
  for (const batch of rows.ticketBatches) {
    expect(new Date(batch.releasesAt).getTime()).toBeLessThan(NOW.getTime());
  }
}

describe('basic-catalogue', () => {
  const { rows, result } = basicCatalogue(context());

  it('creates a concert, a talk and a meetup, all on sale', () => {
    expectConsistent(rows);
    expect(BasicCatalogueResultSchema.parse(result)).toEqual(result);
    expect(result.events.concert).toMatchObject({
      slug: 'scenario-concert-abc12345',
      title: 'Scenario Concert abc12345',
      category: 'CONCERT',
      status: 'PUBLISHED',
      venueId: result.venue.id,
      startsAt: '2026-12-05T23:00:00.000Z',
      salesOpenAt: '2026-11-20T15:00:00.000Z',
      tickets: { total: 38, available: 38, sold: 0 },
    });
    expect(result.events.talk).toMatchObject({
      category: 'TALK',
      tickets: { total: 18, available: 18, sold: 0 },
    });
    expect(result.events.meetup).toMatchObject({
      category: 'MEETUP',
      tickets: { total: 20, available: 20, sold: 0 },
    });
  });

  it('builds one venue with a seated and a GA section', () => {
    expect(result.venue).toMatchObject({
      slug: 'scenario-venue-abc12345',
      sections: [
        { name: 'Seats', type: 'SEATED', capacity: null },
        { name: 'Standing', type: 'GA', capacity: 20 },
      ],
    });
    expect(rows.seats).toHaveLength(18);
    expect(rows.users).toEqual([]);
    expect(rows.orders).toEqual([]);
  });
});

describe('sold-out-event', () => {
  const { rows, result } = soldOutEvent(context());

  it('sells every seat and GA place through confirmed orders', () => {
    expectConsistent(rows);
    expect(SoldOutEventResultSchema.parse(result)).toEqual(result);
    expect(result.event).toMatchObject({
      slug: 'sold-out-show-abc12345',
      tickets: { total: 12, available: 0, sold: 12 },
    });
    expect(rows.inventoryUnits.filter((unit) => unit.seatId === null)).toHaveLength(4);
    expect(result.orderIds).toEqual(rows.orders.map((order) => order.id));
    expect(result.orderIds).toHaveLength(2);
    expect(result.buyer).toEqual({
      id: rows.users[0]?.id,
      email: 'buyer-abc12345@scenario.testtix.test',
    });
  });
});

describe('one-seat-left', () => {
  const { rows, result } = oneSeatLeft(context());

  it('leaves exactly row B seat 4 available', () => {
    expectConsistent(rows);
    expect(OneSeatLeftResultSchema.parse(result)).toEqual(result);
    expect(result.event.tickets).toEqual({ total: 8, available: 1, held: 0, sold: 7 });
    expect(result.event).toMatchObject({ holdDurationSec: 600, maxTicketsPerOrder: 6 });
    expect(result.seat).toMatchObject({ row: 'B', number: 4, priceCents: 4500 });
    expect(result.soldSeats.map((seat) => `${seat.row}${String(seat.number)}`)).toEqual([
      'A1',
      'A2',
      'A3',
      'A4',
      'B1',
      'B2',
      'B3',
    ]);

    const available = rows.inventoryUnits.filter((unit) => unit.status === 'AVAILABLE');
    expect(available).toEqual([
      expect.objectContaining({ id: result.seat.inventoryUnitId, seatId: result.seat.id }),
    ]);
    expect(rows.seats.find((seat) => seat.id === result.seat.id)?.sectionId).toBe(
      result.seat.sectionId,
    );
    expect(result.orderIds).toHaveLength(2);
  });
});

describe('hold-about-to-expire', () => {
  const { rows, result } = holdAboutToExpire(context(), { expiresInSec: 45 });

  it('holds row A seats 1 and 2 for a new customer until 45 seconds from now', () => {
    expectConsistent(rows);
    expect(HoldAboutToExpireResultSchema.omit({ holder: true }).parse(result)).toMatchObject({
      hold: result.hold,
    });
    expect(result.event.tickets).toEqual({ total: 8, available: 6, held: 2, sold: 0 });
    expect(result.hold).toMatchObject({
      createdAt: '2026-11-21T10:05:45.000Z',
      expiresAt: '2026-11-21T10:15:45.000Z',
      totalCents: 9000,
    });
    expect(result.hold.seats.map((seat) => `${seat.row}${String(seat.number)}`)).toEqual([
      'A1',
      'A2',
    ]);
    expect(rows.holds).toEqual([
      expect.objectContaining({ id: result.hold.id, userId: result.holderId }),
    ]);
    expect(rows.users).toEqual([
      expect.objectContaining({
        id: result.holderId,
        email: 'holder-abc12345@scenario.testtix.test',
      }),
    ]);
    expect(rows.orders).toEqual([]);
  });
});

describe('ga-meetup', () => {
  const { rows, result } = gaMeetup(context());

  it('has two GA sections, the Floor in two price tiers', () => {
    expectConsistent(rows);
    expect(GaMeetupResultSchema.parse(result)).toEqual(result);
    expect(result.event).toMatchObject({
      category: 'MEETUP',
      tickets: { total: 50, available: 50, held: 0, sold: 0 },
    });
    expect(result.sections.floor).toMatchObject({
      name: 'Floor',
      capacity: 40,
      available: 40,
      prices: [
        { priceCents: 1000, available: 20 },
        { priceCents: 1500, available: 20 },
      ],
    });
    expect(result.sections.balcony).toMatchObject({
      capacity: 10,
      prices: [{ priceCents: 2000, available: 10 }],
    });
    const batchPrice = new Map(rows.ticketBatches.map((batch) => [batch.id, batch.priceCents]));
    for (const unit of rows.inventoryUnits) {
      expect(unit.seatId).toBeNull();
      expect(unit.priceCents).toBe(batchPrice.get(unit.batchId));
    }
    expect(rows.ticketBatches.map((batch) => batch.name).sort()).toEqual([
      'Balcony',
      'Early bird',
      'Regular',
    ]);
  });
});

describe('ga-last-ticket', () => {
  const { rows, result } = gaLastTicket(context());

  it('sells all but one place of the Floor', () => {
    expectConsistent(rows);
    expect(GaLastTicketResultSchema.parse(result)).toEqual(result);
    expect(result.event.tickets).toEqual({ total: 10, available: 1, held: 0, sold: 9 });
    expect(result.section).toMatchObject({
      name: 'Floor',
      capacity: 10,
      available: 1,
      prices: [{ priceCents: 800, available: 1 }],
    });
    expect(result.orderIds).toHaveLength(2);
  });
});

it('keeps runs with different suffixes apart', () => {
  const first = oneSeatLeft(context('11111111')).result;
  const second = oneSeatLeft(context('22222222')).result;
  expect(first.event.slug).not.toBe(second.event.slug);
  expect(first.venue.slug).not.toBe(second.venue.slug);
  expect(first.buyer.email).not.toBe(second.buyer.email);
});
