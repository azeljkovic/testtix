import { describe, expect, it } from 'vitest';

import { HOLD_MESSAGES, HoldRequestSchema, holdTicketCount } from './holds.js';

const SEAT_A = '019ac6b2-0000-7000-8000-000000000001';
const SEAT_B = '019ac6b2-0000-7000-8000-000000000002';
const SECTION = '019ac6b2-0000-7000-8000-000000000003';

function issues(input: unknown) {
  const result = HoldRequestSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

describe('HoldRequestSchema', () => {
  it('accepts seats, GA places or both, defaulting the missing list to empty', () => {
    expect(HoldRequestSchema.parse({ seats: [SEAT_A] })).toEqual({ seats: [SEAT_A], ga: [] });
    expect(HoldRequestSchema.parse({ ga: [{ sectionId: SECTION, quantity: 2 }] })).toEqual({
      seats: [],
      ga: [{ sectionId: SECTION, quantity: 2 }],
    });
    expect(
      HoldRequestSchema.safeParse({
        seats: [SEAT_A, SEAT_B],
        ga: [{ sectionId: SECTION, quantity: 1 }],
      }).success,
    ).toBe(true);
  });

  it('needs at least one ticket', () => {
    expect(issues({})).toEqual([{ path: '', message: HOLD_MESSAGES.empty }]);
    expect(issues({ seats: [], ga: [] })).toEqual([{ path: '', message: HOLD_MESSAGES.empty }]);
  });

  it('refuses a seat or a GA section listed twice', () => {
    expect(issues({ seats: [SEAT_A, SEAT_A] })).toEqual([
      { path: 'seats.1', message: HOLD_MESSAGES.listedTwice },
    ]);
    expect(
      issues({
        ga: [
          { sectionId: SECTION, quantity: 1 },
          { sectionId: SECTION, quantity: 1 },
        ],
      }),
    ).toEqual([{ path: 'ga.1.sectionId', message: HOLD_MESSAGES.listedTwice }]);
  });

  it('refuses quantities below 1 or above the global maximum, and more than 20 tickets in all', () => {
    expect(issues({ ga: [{ sectionId: SECTION, quantity: 0 }] })).toContainEqual({
      path: 'ga.0.quantity',
      message: 'Quantity must be at least 1',
    });
    expect(issues({ ga: [{ sectionId: SECTION, quantity: 1.5 }] })).toContainEqual({
      path: 'ga.0.quantity',
      message: 'Quantity must be a whole number',
    });
    expect(issues({ seats: [SEAT_A], ga: [{ sectionId: SECTION, quantity: 20 }] })).toEqual([
      { path: '', message: HOLD_MESSAGES.tooMany(20) },
    ]);
  });

  it('refuses unknown fields and IDs that are not UUIDs', () => {
    expect(issues({ seats: [SEAT_A], extra: true })).toHaveLength(1);
    expect(issues({ seats: ['A-1'] })[0]?.path).toBe('seats.0');
  });
});

describe('holdTicketCount', () => {
  it('adds the seats and the GA quantities', () => {
    expect(
      holdTicketCount({
        seats: [SEAT_A, SEAT_B],
        ga: [{ quantity: 3 }, { quantity: 1 }],
      }),
    ).toBe(6);
  });
});
