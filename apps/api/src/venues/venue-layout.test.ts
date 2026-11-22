import { describe, expect, it } from 'vitest';

import { buildVenueLayout, rowLabel } from './venue-layout.js';

function counter() {
  let n = 0;
  return () => `id-${++n}`;
}

describe('buildVenueLayout', () => {
  it('generates a seat grid for seated sections and a capacity for GA ones', () => {
    const layout = buildVenueLayout(
      'venue-1',
      [
        { type: 'GA', name: 'Floor', capacity: 250 },
        { type: 'SEATED', name: 'Balcony', rows: 2, seatsPerRow: 3 },
      ],
      counter(),
    );
    expect(layout.sections).toEqual([
      { id: 'id-1', venueId: 'venue-1', name: 'Floor', type: 'GA', capacity: 250, sortOrder: 0 },
      {
        id: 'id-2',
        venueId: 'venue-1',
        name: 'Balcony',
        type: 'SEATED',
        capacity: null,
        sortOrder: 1,
      },
    ]);
    expect(layout.seats.map((seat) => `${seat.row}${seat.number}`)).toEqual([
      'A1',
      'A2',
      'A3',
      'B1',
      'B2',
      'B3',
    ]);
    expect(layout.seats.every((seat) => seat.sectionId === 'id-2')).toBe(true);
    expect(layout.seats.map((seat) => seat.rowIndex)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(new Set(layout.seats.map((seat) => seat.id)).size).toBe(6);
  });

  it('letters rows past Z as AA, AB, …', () => {
    const layout = buildVenueLayout(
      'v',
      [{ type: 'SEATED', name: 'Deep', rows: 28, seatsPerRow: 1 }],
      counter(),
    );
    expect(layout.seats.slice(-3).map((seat) => seat.row)).toEqual(['Z', 'AA', 'AB']);
  });
});

describe('rowLabel', () => {
  it.each([
    [0, 'A'],
    [9, 'J'],
    [25, 'Z'],
    [26, 'AA'],
    [27, 'AB'],
    [51, 'AZ'],
    [52, 'BA'],
    [701, 'ZZ'],
    [702, 'AAA'],
  ])('labels row %i as %s', (index, label) => {
    expect(rowLabel(index)).toBe(label);
  });
});
