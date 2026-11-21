import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_TICKETS_PER_ORDER,
  LOCKED_PASSWORD_HASH,
  type ScenarioContext,
  type ScenarioRows,
} from './scenario-data.js';
import {
  BasicCatalogueResultSchema,
  OneSeatLeftResultSchema,
  SoldOutEventResultSchema,
} from './scenario.schemas.js';
import { basicCatalogue, oneSeatLeft, soldOutEvent } from './scenarios.js';

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
    expect(result.event.tickets).toEqual({ total: 8, available: 1, sold: 7 });
    expect(result.seat).toMatchObject({ row: 'B', number: 4, priceCents: 4500 });

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

it('keeps runs with different suffixes apart', () => {
  const first = oneSeatLeft(context('11111111')).result;
  const second = oneSeatLeft(context('22222222')).result;
  expect(first.event.slug).not.toBe(second.event.slug);
  expect(first.venue.slug).not.toBe(second.venue.slug);
  expect(first.buyer.email).not.toBe(second.buyer.email);
});
