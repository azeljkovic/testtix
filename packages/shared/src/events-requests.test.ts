import { describe, expect, it } from 'vitest';

import {
  CreateEventRequestSchema,
  EVENT_SCHEDULE_MESSAGES,
  eventScheduleIssues,
  ReleaseBatchRequestSchema,
  UpdateEventRequestSchema,
} from './events.js';

const event = {
  title: 'Gig',
  performer: 'Band',
  description: 'A gig.',
  category: 'CONCERT',
  venueId: '019b76da-a800-7fbc-a24e-2ac58eab7ced',
  startsAt: '2027-01-10T20:00:00Z',
  endsAt: '2027-01-10T23:00:00Z',
  salesOpenAt: '2026-12-01T10:00:00+01:00',
};

const UUID_A = '019b76da-a800-7000-8000-00000000000a';
const UUID_B = '019b76da-a800-7000-8000-00000000000b';

function paths(result: { error?: { issues: { path: PropertyKey[] }[] } }): string[] {
  return (result.error?.issues ?? []).map((issue) => issue.path.join('.'));
}

describe('eventScheduleIssues', () => {
  const at = (iso: string) => new Date(iso);

  it('accepts a valid schedule', () => {
    expect(
      eventScheduleIssues({
        startsAt: at(event.startsAt),
        endsAt: at(event.endsAt),
        salesOpenAt: at(event.salesOpenAt),
      }),
    ).toEqual([]);
  });

  it('needs the end after the start and sales to open before it', () => {
    const t = at(event.startsAt);
    expect(eventScheduleIssues({ startsAt: t, endsAt: t, salesOpenAt: t })).toEqual([
      { path: 'endsAt', message: EVENT_SCHEDULE_MESSAGES.endsBeforeStart },
      { path: 'salesOpenAt', message: EVENT_SCHEDULE_MESSAGES.salesOpenAfterStart },
    ]);
  });
});

describe('CreateEventRequestSchema', () => {
  it('accepts an event and leaves the optional settings out', () => {
    const parsed = CreateEventRequestSchema.parse(event);
    expect(parsed.holdDurationSec).toBeUndefined();
    expect(parsed.slug).toBeUndefined();
  });

  it('applies the schedule rules', () => {
    expect(paths(CreateEventRequestSchema.safeParse({ ...event, endsAt: event.startsAt }))).toEqual(
      ['endsAt'],
    );
  });

  it.each([
    ['startsAt', '2027-01-10 20:00'],
    ['startsAt', '2027-01-10T20:00:00'],
    ['category', 'PARTY'],
    ['venueId', 'riverside-hall'],
    ['holdDurationSec', 59],
    ['maxTicketsPerOrder', 21],
    ['title', '   '],
    ['slug', 'Not A Slug'],
  ])('rejects %s = %j', (field, value) => {
    expect(paths(CreateEventRequestSchema.safeParse({ ...event, [field]: value }))).toContain(
      field,
    );
  });
});

describe('UpdateEventRequestSchema', () => {
  it('accepts a partial body, without the cross-field rules', () => {
    expect(UpdateEventRequestSchema.parse({ endsAt: event.startsAt })).toEqual({
      endsAt: event.startsAt,
    });
  });

  it('rejects unknown fields such as status', () => {
    expect(UpdateEventRequestSchema.safeParse({ status: 'PUBLISHED' }).success).toBe(false);
  });
});

describe('ReleaseBatchRequestSchema', () => {
  const batch = { name: 'Early bird', priceCents: 4500 };

  it('accepts each kind of inventory', () => {
    expect(
      ReleaseBatchRequestSchema.safeParse({ ...batch, seatedSectionIds: [UUID_A] }).success,
    ).toBe(true);
    expect(
      ReleaseBatchRequestSchema.safeParse({ ...batch, seatIds: [UUID_A, UUID_B] }).success,
    ).toBe(true);
    expect(
      ReleaseBatchRequestSchema.safeParse({
        ...batch,
        gaSections: [{ sectionId: UUID_A, quantity: 5 }],
      }).success,
    ).toBe(true);
  });

  it('accepts free tickets', () => {
    expect(
      ReleaseBatchRequestSchema.safeParse({ ...batch, priceCents: 0, seatIds: [UUID_A] }).success,
    ).toBe(true);
  });

  it('needs some inventory', () => {
    const result = ReleaseBatchRequestSchema.safeParse({ ...batch, seatIds: [] });
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      'Release at least one seated section, seat or GA place',
    ]);
  });

  it('rejects duplicates, fractional or negative prices and zero quantities', () => {
    expect(
      paths(ReleaseBatchRequestSchema.safeParse({ ...batch, seatIds: [UUID_A, UUID_A] })),
    ).toEqual(['seatIds.1']);
    expect(
      paths(
        ReleaseBatchRequestSchema.safeParse({
          ...batch,
          gaSections: [
            { sectionId: UUID_A, quantity: 1 },
            { sectionId: UUID_A, quantity: 0 },
          ],
        }),
      ),
    ).toEqual(['gaSections.1.quantity', 'gaSections.1.sectionId']);
    expect(
      paths(ReleaseBatchRequestSchema.safeParse({ ...batch, priceCents: 10.5, seatIds: [UUID_A] })),
    ).toEqual(['priceCents']);
    expect(
      paths(ReleaseBatchRequestSchema.safeParse({ ...batch, priceCents: -1, seatIds: [UUID_A] })),
    ).toEqual(['priceCents']);
  });
});
