import { describe, expect, it } from 'vitest';

import {
  concertSeatMap,
  fixtureSeatId,
  meetupSeatMap,
  mixedSeatMap,
} from '../testing/seat-fixtures.js';
import { withSeatStatus } from '../testing/seats.js';
import { gaCost, pruneSelection, seatName, summarize } from './selection.js';

const LOFT = '01970000-0000-7000-8000-0000000000b3';
const FLOOR = '01970000-0000-7000-8000-0000000000b6';
const loftPrices = [
  { priceCents: 1000, available: 2 },
  { priceCents: 1500, available: 1 },
];

describe('seatName', () => {
  const seat = { id: fixtureSeatId(1, 'B', 12), number: 12, status: 'AVAILABLE' as const };

  it('names the section, row, seat, price and state', () => {
    expect(seatName('Stalls', 'B', { ...seat, priceCents: 8900 }, 'AVAILABLE')).toBe(
      'Stalls, row B, seat 12, $89.00, available',
    );
    expect(seatName('Stalls', 'B', { ...seat, priceCents: 0 }, 'SELECTED')).toBe(
      'Stalls, row B, seat 12, Free, selected',
    );
  });

  it('leaves the price out when the seat has none', () => {
    expect(
      seatName('Stalls', 'C', { ...seat, priceCents: null, status: 'NOT_ON_SALE' }, 'NOT_ON_SALE'),
    ).toBe('Stalls, row C, seat 12, not on sale');
  });
});

describe('gaCost', () => {
  it.each([
    [0, 0],
    [1, 1000],
    [2, 2000],
    [3, 3500],
  ])('%i places cost %i cents, cheapest first', (quantity, cents) => {
    expect(gaCost(loftPrices, quantity)).toBe(cents);
  });
});

describe('summarize', () => {
  it('lists picked seats in venue, row and seat order with their total', () => {
    const summary = summarize(concertSeatMap, {
      seats: [fixtureSeatId(1, 'B', 2), fixtureSeatId(1, 'A', 4)],
      ga: {},
    });
    expect(summary.seats.map(({ row, seat }) => `${row.label}${seat.number.toString()}`)).toEqual([
      'A4',
      'B2',
    ]);
    expect(summary).toMatchObject({ count: 2, totalCents: 17800, ga: [] });
  });

  it('counts GA places with their cheapest-first cost', () => {
    const summary = summarize(mixedSeatMap, {
      seats: [fixtureSeatId(5, 'A', 2)],
      ga: { [FLOOR]: 3 },
    });
    expect(summary.ga).toMatchObject([{ quantity: 3, cents: 7500 }]);
    expect(summary).toMatchObject({ count: 4, totalCents: 4500 + 7500 });
  });

  it('leaves out seats that are no longer available and caps GA quantities', () => {
    const summary = summarize(meetupSeatMap, { seats: [], ga: { [LOFT]: 5 } });
    expect(summary).toMatchObject({ count: 3, totalCents: 3500 });

    const taken = withSeatStatus(concertSeatMap, [fixtureSeatId(1, 'A', 3)], 'HELD');
    expect(summarize(taken, { seats: [fixtureSeatId(1, 'A', 3)], ga: {} }).count).toBe(0);
  });
});

describe('pruneSelection', () => {
  it('returns the same selection when the map still allows all of it', () => {
    const selection = { seats: [fixtureSeatId(1, 'A', 3)], ga: {} };
    expect(pruneSelection(concertSeatMap, selection)).toBe(selection);
  });

  it('drops taken seats and caps GA quantities', () => {
    const taken = withSeatStatus(concertSeatMap, [fixtureSeatId(1, 'A', 3)], 'SOLD');
    expect(
      pruneSelection(taken, {
        seats: [fixtureSeatId(1, 'A', 3), fixtureSeatId(1, 'B', 1)],
        ga: {},
      }),
    ).toEqual({ seats: [fixtureSeatId(1, 'B', 1)], ga: {} });
    expect(pruneSelection(meetupSeatMap, { seats: [], ga: { [LOFT]: 5 } })).toEqual({
      seats: [],
      ga: { [LOFT]: 3 },
    });
  });
});
