import { verify } from '@node-rs/argon2';
import { describe, expect, it } from 'vitest';

import { EVENT_SPECS, SEED_FIXTURES, USER_SPECS, VENUE_SPECS } from './fixtures.js';
import { GENERATED_EVENT_COUNT } from './generated-events.js';
import { buildSeedData, rowLabel } from './seed-data.js';

const NOW = new Date('2026-11-21T10:15:00.000Z');
const data = buildSeedData(NOW);

describe('buildSeedData', () => {
  it('is deterministic', () => {
    expect(buildSeedData(new Date(NOW))).toEqual(data);
  });

  it('gives the same data at any time on the same UTC day', () => {
    expect(buildSeedData(new Date('2026-11-21T00:00:00.000Z'))).toEqual(data);
    expect(buildSeedData(new Date('2026-11-21T23:59:59.999Z'))).toEqual(data);
  });

  it('moves the dates, but keeps every ID, on another day', () => {
    const nextDay = buildSeedData(new Date('2026-11-22T10:15:00.000Z'));
    expect(nextDay.events.map(({ id }) => id)).toEqual(data.events.map(({ id }) => id));
    expect(nextDay.inventoryUnits.map(({ id }) => id)).toEqual(
      data.inventoryUnits.map(({ id }) => id),
    );
    const day = 24 * 60 * 60 * 1000;
    nextDay.events.forEach((event, i) => {
      expect(
        new Date(event.startsAt).getTime() - new Date(data.events[i]?.startsAt ?? 0).getTime(),
      ).toBe(day);
    });
  });

  it('uses a unique ID for every row', () => {
    const ids = Object.values(data).flatMap((rows: { id?: string }[]) => rows.map(({ id }) => id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses unique venue and event slugs', () => {
    expect(new Set(data.venues.map(({ slug }) => slug)).size).toBe(data.venues.length);
    expect(new Set(data.events.map(({ slug }) => slug)).size).toBe(data.events.length);
  });

  it('contains every named fixture with its stable ID', () => {
    for (const [slug, id] of Object.entries(SEED_FIXTURES.venues)) {
      expect(data.venues.find((venue) => venue.slug === slug)?.id).toBe(id);
    }
    for (const [slug, id] of Object.entries(SEED_FIXTURES.events)) {
      expect(data.events.find((event) => event.slug === slug)?.id).toBe(id);
    }
    expect(data.events).toHaveLength(EVENT_SPECS.length + GENERATED_EVENT_COUNT);
  });

  it('builds each venue layout from its spec', () => {
    expect(data.venues).toHaveLength(VENUE_SPECS.length);
    const riverside = VENUE_SPECS[0];
    const stalls = data.sections.find(
      (s) => s.venueId === SEED_FIXTURES.venues['riverside-hall'] && s.name === 'Stalls',
    );
    expect(stalls).toMatchObject({ type: 'SEATED', capacity: null, sortOrder: 0 });
    const seats = data.seats.filter((seat) => seat.sectionId === stalls?.id);
    expect(seats).toHaveLength(riverside.sections[0].rows * riverside.sections[0].seatsPerRow);
    expect(seats[0]).toMatchObject({ row: 'A', rowIndex: 0, number: 1 });
    expect(seats.at(-1)).toMatchObject({ row: 'J', rowIndex: 9, number: 20 });

    const floor = data.sections.find((s) => s.name === 'Standing Floor');
    expect(floor).toMatchObject({ type: 'GA', capacity: 250 });
    expect(data.seats.filter((seat) => seat.sectionId === floor?.id)).toEqual([]);
  });

  it('puts every seat, or every GA place, of a released section on sale once per event', () => {
    const sectionById = new Map(data.sections.map((section) => [section.id, section]));
    const seatById = new Map(data.seats.map((seat) => [seat.id, seat]));
    for (const event of data.events) {
      const units = data.inventoryUnits.filter((unit) => unit.eventId === event.id);
      const seatIds = units.flatMap(({ seatId }) => (seatId ? [seatId] : []));
      expect(new Set(seatIds).size).toBe(seatIds.length);
      for (const unit of units) {
        const section = sectionById.get(unit.sectionId);
        expect(section?.venueId).toBe(event.venueId);
        if (section?.type === 'GA') {
          expect(unit.seatId).toBeNull();
        } else {
          expect(seatById.get(unit.seatId ?? '')?.sectionId).toBe(unit.sectionId);
        }
        expect(unit.status).toBe('AVAILABLE');
      }
      for (const sectionId of new Set(units.map((unit) => unit.sectionId))) {
        const section = sectionById.get(sectionId);
        const size =
          section?.type === 'GA'
            ? section.capacity
            : data.seats.filter((seat) => seat.sectionId === sectionId).length;
        expect(units.filter((unit) => unit.sectionId === sectionId)).toHaveLength(size ?? -1);
      }
    }
  });

  it('prices each unit like its batch', () => {
    const batches = new Map(data.ticketBatches.map((batch) => [batch.id, batch]));
    for (const unit of data.inventoryUnits) {
      const batch = batches.get(unit.batchId);
      expect(batch?.eventId).toBe(unit.eventId);
      expect(unit.priceCents).toBe(batch?.priceCents);
    }
  });

  it('dates the fixtures relative to the seed day', () => {
    const event = (slug: string) => data.events.find((e) => e.slug === slug);
    expect(event('midnight-echoes-live')).toMatchObject({
      startsAt: new Date('2026-12-12T23:30:00.000Z'),
      endsAt: new Date('2026-12-13T02:00:00.000Z'),
      salesOpenAt: new Date('2026-10-22T15:00:00.000Z'),
    });
    // Released later: the balcony isn't on sale yet.
    expect(
      data.ticketBatches.find(
        (b) => b.eventId === SEED_FIXTURES.events['midnight-echoes-live'] && b.name === 'Balcony',
      )?.releasesAt,
    ).toEqual(new Date('2026-11-24T15:00:00.000Z'));
    expect(event('season-opener-showcase')?.startsAt).toEqual(new Date('2026-11-14T23:00:00.000Z'));
  });

  it('includes published events that start at the same time (sort tiebreaker)', () => {
    const published = data.events.filter(({ status }) => status === 'PUBLISHED');
    const starts = published.map(({ startsAt }) => new Date(startsAt).getTime());
    expect(new Set(starts).size).toBeLessThan(starts.length);
  });

  it('has events in every category and status', () => {
    expect(new Set(data.events.map(({ category }) => category))).toEqual(
      new Set(['CONCERT', 'TALK', 'MEETUP']),
    );
    expect(new Set(data.events.map(({ status }) => status))).toEqual(
      new Set(['DRAFT', 'PUBLISHED', 'CANCELLED']),
    );
  });

  it('ends every event after it starts', () => {
    for (const event of data.events) {
      expect(new Date(event.endsAt).getTime()).toBeGreaterThan(new Date(event.startsAt).getTime());
    }
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

describe('seeded users', () => {
  it('has the documented accounts with stable IDs', () => {
    expect(
      data.users.map(({ id, email, role, emailVerifiedAt }) => ({
        id,
        email,
        role,
        verified: emailVerifiedAt !== null,
      })),
    ).toEqual([
      {
        id: SEED_FIXTURES.users['admin@testtix.test'],
        email: 'admin@testtix.test',
        role: 'ADMIN',
        verified: true,
      },
      {
        id: SEED_FIXTURES.users['customer@testtix.test'],
        email: 'customer@testtix.test',
        role: 'CUSTOMER',
        verified: true,
      },
      {
        id: SEED_FIXTURES.users['unverified@testtix.test'],
        email: 'unverified@testtix.test',
        role: 'CUSTOMER',
        verified: false,
      },
    ]);
  });

  it.each(USER_SPECS)(
    'stores an argon2id hash of the documented password for $email',
    async (user) => {
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(await verify(user.passwordHash, user.password)).toBe(true);
      expect(await verify(user.passwordHash, `${user.password}x`)).toBe(false);
    },
  );
});
