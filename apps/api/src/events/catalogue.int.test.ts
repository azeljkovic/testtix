import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PROBLEM_TYPES, ProblemDetailsSchema } from '@testtix/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaService } from '../infra/prisma.service.js';
import { uuidv7 } from '../infra/uuid.js';
import type { DayTime } from '../seed/fixtures.js';
import { buildCatalogue, type CatalogueEventSpec, dayAt } from '../seed/seed-data.js';
import { insertRows } from '../seed/seed.js';
import { createIntegrationApp } from '../testing/integration/integration-app.js';
import { CatalogueVenuePageSchema } from '../venues/venue.schemas.js';
import {
  type CatalogueEventSummary,
  CatalogueEventPageSchema,
  CatalogueEventSchema,
} from './catalogue.schemas.js';

/** The server clock while testing: noon, so `D` (the start of the UTC day) is 12 hours ago. */
const NOW = new Date('2027-03-01T12:00:00.000Z');
const at = (dayTime: DayTime) => dayAt(NOW, dayTime);
const iso = (dayTime: DayTime) => at(dayTime).toISOString();
const OPEN: DayTime = [-10, '10:00'];
const TIE: DayTime = [5, '19:00'];

let app: NestFastifyApplication;
let prisma: PrismaService;

const ids = new Map<string, string>();
/** A random ID per row key, the same every time the key is asked for. */
function rowId(key: string): string {
  let id = ids.get(key);
  if (id === undefined) {
    id = uuidv7(NOW);
    ids.set(key, id);
  }
  return id;
}
const eventId = (slug: string) => rowId(`event:${slug}`);
/** Slugs in the order of their event IDs (the final tiebreaker; UUIDs compare like their hex). */
const byId = (...slugList: string[]) => slugList.sort((a, b) => (eventId(a) < eventId(b) ? -1 : 1));

function event(
  spec: Pick<CatalogueEventSpec, 'slug' | 'title' | 'category' | 'venue' | 'starts' | 'batches'> &
    Partial<CatalogueEventSpec>,
): CatalogueEventSpec {
  return {
    performer: 'Someone',
    description: `Catalogue test event ${spec.slug}.`,
    status: 'PUBLISHED',
    durationMin: 120,
    salesOpen: OPEN,
    ...spec,
  };
}

/**
 * The catalogue under test. Upcoming published events, by start time:
 *
 * | Slug              | Starts   | Category | Venue | Seating | Lowest price | Availability   |
 * | ----------------- | -------- | -------- | ----- | ------- | ------------ | -------------- |
 * | `beta-talk`       | D+5 (=)  | TALK     | arena | SEATED  | 1500         | ON_SALE        |
 * | `gamma-meetup`    | D+5 (=)  | MEETUP   | loft  | GA      | 500          | ON_SALE        |
 * | `theta-tie`       | D+5 (=)  | MEETUP   | loft  | GA      | 1500         | ON_SALE        |
 * | `held-out`        | D+6      | MEETUP   | loft  | GA      | 800          | SOLD_OUT       |
 * | `zeta-scheduled`  | D+8      | TALK     | hall  | GA      | 2000         | SALES_NOT_OPEN |
 * | `alpha-night`     | D+10     | CONCERT  | hall  | MIXED   | 2500         | ON_SALE        |
 * | `epsilon-preview` | D+15     | CONCERT  | hall  | SEATED  | 6000         | SALES_NOT_OPEN |
 * | `delta-sold-out`  | D+20     | CONCERT  | arena | SEATED  | 3000         | SOLD_OUT       |
 *
 * Plus `past-show` (started at D−2), and a draft and a cancelled event that never appear.
 */
const EVENTS: CatalogueEventSpec[] = [
  event({
    slug: 'alpha-night',
    title: 'Alpha Night',
    performer: 'The Echo Chamber',
    category: 'CONCERT',
    venue: 'cat-hall',
    starts: [10, '20:00'],
    batches: [
      { name: 'Stalls', priceCents: 4000, sections: ['Stalls'], releases: OPEN },
      { name: 'Floor', priceCents: 2500, sections: ['Floor'], releases: [2, '12:00'] },
    ],
  }),
  event({
    slug: 'beta-talk',
    title: 'beta Talk',
    performer: 'Dr. Ada 100% Lovelace',
    category: 'TALK',
    venue: 'cat-arena',
    starts: TIE,
    batches: [{ name: 'Main', priceCents: 1500, sections: ['Main'], releases: OPEN }],
  }),
  event({
    slug: 'gamma-meetup',
    title: 'Gamma Meetup',
    category: 'MEETUP',
    venue: 'cat-loft',
    starts: TIE,
    batches: [{ name: 'Loft', priceCents: 500, sections: ['Loft'], releases: OPEN }],
  }),
  event({
    slug: 'theta-tie',
    title: 'Theta Tie',
    category: 'MEETUP',
    venue: 'cat-loft',
    starts: TIE,
    batches: [{ name: 'Loft', priceCents: 1500, sections: ['Loft'], releases: OPEN }],
  }),
  event({
    slug: 'held-out',
    title: 'Held Out Meetup',
    category: 'MEETUP',
    venue: 'cat-loft',
    starts: [6, '18:00'],
    batches: [{ name: 'Loft', priceCents: 800, sections: ['Loft'], releases: OPEN }],
  }),
  event({
    slug: 'zeta-scheduled',
    title: 'Zeta Scheduled',
    category: 'TALK',
    venue: 'cat-hall',
    starts: [8, '18:00'],
    batches: [{ name: 'Floor', priceCents: 2000, sections: ['Floor'], releases: [2, '12:00'] }],
  }),
  event({
    slug: 'epsilon-preview',
    title: 'Epsilon Preview',
    category: 'CONCERT',
    venue: 'cat-hall',
    starts: [15, '20:00'],
    salesOpen: [3, '12:00'],
    batches: [{ name: 'Stalls', priceCents: 6000, sections: ['Stalls'], releases: OPEN }],
  }),
  event({
    slug: 'delta-sold-out',
    title: 'Delta Sold Out',
    category: 'CONCERT',
    venue: 'cat-arena',
    starts: [20, '20:00'],
    batches: [{ name: 'Main', priceCents: 3000, sections: ['Main'], releases: OPEN }],
  }),
  event({
    slug: 'past-show',
    title: 'Past Show',
    category: 'CONCERT',
    venue: 'cat-loft',
    starts: [-2, '20:00'],
    salesOpen: [-30, '10:00'],
    batches: [{ name: 'Loft', priceCents: 900, sections: ['Loft'], releases: [-30, '10:00'] }],
  }),
  event({
    slug: 'draft-gig',
    title: 'Draft Gig',
    status: 'DRAFT',
    category: 'CONCERT',
    venue: 'cat-backstage',
    starts: [12, '20:00'],
    batches: [{ name: 'Pit', priceCents: 1000, sections: ['Pit'], releases: OPEN }],
  }),
  event({
    slug: 'cancelled-gig',
    title: 'Cancelled Gig',
    status: 'CANCELLED',
    category: 'CONCERT',
    venue: 'cat-backstage',
    starts: [13, '20:00'],
    batches: [{ name: 'Pit', priceCents: 1000, sections: ['Pit'], releases: OPEN }],
  }),
];

/** Every upcoming published event, in the default order (start time, then ID). */
const BY_DATE = [
  ...byId('beta-talk', 'gamma-meetup', 'theta-tie'),
  'held-out',
  'zeta-scheduled',
  'alpha-night',
  'epsilon-preview',
  'delta-sold-out',
];

/** The hold on `held-out`'s last four places ends 30 minutes after `NOW`. */
const HOLD_ENDS = new Date(NOW.getTime() + 30 * 60_000);

async function insertCatalogue(): Promise<void> {
  const data = buildCatalogue(NOW, {
    venues: [
      {
        slug: 'cat-hall',
        name: 'Cat Hall',
        address: '1 Hall Road',
        sections: [
          { name: 'Stalls', type: 'SEATED', rows: 2, seatsPerRow: 5 },
          { name: 'Floor', type: 'GA', capacity: 20 },
        ],
      },
      {
        slug: 'cat-loft',
        name: 'Cat Loft',
        address: '2 Loft Lane',
        sections: [{ name: 'Loft', type: 'GA', capacity: 10 }],
      },
      {
        slug: 'cat-arena',
        name: 'Cat Arena',
        address: '3 Arena Way',
        sections: [{ name: 'Main', type: 'SEATED', rows: 1, seatsPerRow: 4 }],
      },
      {
        slug: 'cat-backstage',
        name: 'Cat Backstage',
        address: '4 Back Alley',
        sections: [{ name: 'Pit', type: 'GA', capacity: 5 }],
      },
    ],
    events: EVENTS,
    id: rowId,
    createdAt: [-20, '10:00'],
  });
  const userId = uuidv7(NOW);
  const holdId = uuidv7(NOW);
  await prisma.$transaction(async (tx) => {
    await insertRows(tx, data);
    await tx.inventoryUnit.updateMany({
      where: { eventId: eventId('delta-sold-out') },
      data: { status: 'SOLD' },
    });
    // held-out: 6 places sold, the other 4 in an unexpired hold.
    const units = await tx.inventoryUnit.findMany({
      where: { eventId: eventId('held-out') },
      orderBy: { id: 'asc' },
    });
    await tx.inventoryUnit.updateMany({
      where: { id: { in: units.slice(0, 6).map((unit) => unit.id) } },
      data: { status: 'SOLD' },
    });
    await tx.user.create({
      data: {
        id: userId,
        email: `holder-${userId}@example.com`,
        passwordHash: '!locked',
        name: 'Holder',
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    await tx.hold.create({
      data: {
        id: holdId,
        eventId: eventId('held-out'),
        userId,
        expiresAt: HOLD_ENDS,
        createdAt: NOW,
      },
    });
    await tx.inventoryUnit.updateMany({
      where: { id: { in: units.slice(6).map((unit) => unit.id) } },
      data: { status: 'HELD', holdId, heldUntil: HOLD_ENDS },
    });
  });
}

function setClock(body: object) {
  return request(app.getHttpServer()).post('/__test/clock').send(body).expect(200);
}

/** `GET /events` as an anonymous visitor; expects a 200 page. */
async function list(query: Record<string, string | number> = {}) {
  const res = await request(app.getHttpServer()).get('/events').query(query);
  expect(res.status).toBe(200);
  return CatalogueEventPageSchema.parse(res.body);
}

const slugs = (items: CatalogueEventSummary[]) => items.map((item) => item.slug);

async function listSlugs(query: Record<string, string | number> = {}) {
  return slugs((await list({ pageSize: 100, ...query })).items);
}

beforeAll(async () => {
  app = await createIntegrationApp({ env: { TESTTIX_TEST_MODE: 'true' } });
  prisma = app.get(PrismaService);
  await insertCatalogue();
});

beforeEach(async () => {
  await setClock({ freezeAt: NOW.toISOString() });
});

afterAll(async () => {
  await setClock({ reset: true });
  await app.close();
});

describe('GET /events', () => {
  it('lists upcoming published events by start time, then ID, without a session', async () => {
    const page = await list();
    expect(slugs(page.items)).toEqual(BY_DATE);
    expect(page).toMatchObject({ page: 1, pageSize: 20, total: 8, totalPages: 1 });
  });

  it('describes each event', async () => {
    const { items } = await list({ q: 'Alpha' });
    expect(items).toEqual([
      {
        id: eventId('alpha-night'),
        slug: 'alpha-night',
        title: 'Alpha Night',
        performer: 'The Echo Chamber',
        category: 'CONCERT',
        venue: {
          id: rowId('venue:cat-hall'),
          slug: 'cat-hall',
          name: 'Cat Hall',
          city: expect.any(String) as string,
          timezone: expect.any(String) as string,
        },
        startsAt: iso([10, '20:00']),
        endsAt: new Date(at([10, '20:00']).getTime() + 120 * 60_000).toISOString(),
        salesOpenAt: iso(OPEN),
        seating: 'MIXED',
        availability: 'ON_SALE',
        // The Floor batch isn't released yet: only the 10 stalls count…
        availableTickets: 10,
        // …but its price is part of the range.
        priceRange: { minCents: 2500, maxCents: 4000 },
      },
    ]);
  });

  it('never lists drafts or cancelled events, even in the past', async () => {
    const all = await listSlugs({ from: iso([-60, '00:00']) });
    expect(all).toEqual(['past-show', ...BY_DATE]);
  });

  describe('date range', () => {
    it('leaves out events that have started, unless `from` is earlier', async () => {
      expect(await listSlugs()).not.toContain('past-show');
      expect(await listSlugs({ from: iso([-3, '00:00']), to: iso([0, '00:00']) })).toEqual([
        'past-show',
      ]);
    });

    it('includes `from` and excludes `to`', async () => {
      expect(await listSlugs({ from: iso(TIE), to: iso([8, '18:00']) })).toEqual([
        ...BY_DATE.slice(0, 3),
        'held-out',
      ]);
    });

    it('follows the server clock', async () => {
      await setClock({ freezeAt: iso([7, '00:00']) });
      expect(await listSlugs()).toEqual(BY_DATE.slice(4));
    });

    it('accepts offsets', async () => {
      // D+8 18:00 UTC is D+8 20:00 at +02:00.
      const to = `${iso([8, '00:00']).slice(0, 10)}T20:00:00+02:00`;
      expect(await listSlugs({ from: iso([6, '00:00']), to })).toEqual(['held-out']);
    });
  });

  it.each([
    ['CONCERT', ['alpha-night', 'epsilon-preview', 'delta-sold-out']],
    ['TALK', ['beta-talk', 'zeta-scheduled']],
    ['MEETUP', BY_DATE.filter((slug) => ['gamma-meetup', 'theta-tie', 'held-out'].includes(slug))],
  ])('filters by category %s', async (category, expected) => {
    expect(await listSlugs({ category })).toEqual(expected);
  });

  it('filters by venue slug', async () => {
    expect(await listSlugs({ venue: 'cat-arena' })).toEqual(['beta-talk', 'delta-sold-out']);
    expect(await listSlugs({ venue: 'cat-backstage' })).toEqual([]);
    expect(await listSlugs({ venue: 'no-such-venue' })).toEqual([]);
  });

  it.each([
    ['SEATED', ['beta-talk', 'epsilon-preview', 'delta-sold-out']],
    [
      'GA',
      BY_DATE.filter((slug) =>
        ['gamma-meetup', 'theta-tie', 'held-out', 'zeta-scheduled'].includes(slug),
      ),
    ],
    ['MIXED', ['alpha-night']],
  ])('filters by seating %s', async (seating, expected) => {
    expect(await listSlugs({ seating })).toEqual(expected);
  });

  describe('availability', () => {
    it.each([
      [
        'ON_SALE',
        BY_DATE.filter((slug) =>
          ['beta-talk', 'gamma-meetup', 'theta-tie', 'alpha-night'].includes(slug),
        ),
      ],
      ['SOLD_OUT', ['held-out', 'delta-sold-out']],
      ['SALES_NOT_OPEN', ['zeta-scheduled', 'epsilon-preview']],
      ['SALES_ENDED', []],
    ])('filters by %s', async (availability, expected) => {
      expect(await listSlugs({ availability })).toEqual(expected);
    });

    it('reports events that have started as SALES_ENDED', async () => {
      expect(await listSlugs({ availability: 'SALES_ENDED', from: iso([-60, '00:00']) })).toEqual([
        'past-show',
      ]);
    });

    it('opens sales when `salesOpenAt` and the first release have passed', async () => {
      await setClock({ freezeAt: iso([4, '00:00']) });
      const { items } = await list({ availability: 'ON_SALE' });
      expect(slugs(items)).toContain('zeta-scheduled');
      expect(slugs(items)).toContain('epsilon-preview');
      const alpha = items.find((item) => item.slug === 'alpha-night');
      // The Floor batch is released now: 10 stalls + 20 standing places.
      expect(alpha?.availableTickets).toBe(30);
    });

    it('counts expired holds as available', async () => {
      const before = (await list({ q: 'Held Out' })).items[0];
      expect(before).toMatchObject({ availability: 'SOLD_OUT', availableTickets: 0 });

      await setClock({ freezeAt: HOLD_ENDS.toISOString() });
      const after = (await list({ q: 'Held Out' })).items[0];
      expect(after).toMatchObject({ availability: 'ON_SALE', availableTickets: 4 });
    });
  });

  describe('search', () => {
    it.each([
      ['alpha', ['alpha-night']],
      ['NIGHT', ['alpha-night']],
      ['echo chamber', ['alpha-night']],
      ['lovelace', ['beta-talk']],
      ['meetup', BY_DATE.filter((slug) => ['gamma-meetup', 'held-out'].includes(slug))],
    ])('finds %j in titles and performers, ignoring case', async (q, expected) => {
      expect(await listSlugs({ q })).toEqual(expected);
    });

    it('matches % and _ literally', async () => {
      expect(await listSlugs({ q: '%' })).toEqual(['beta-talk']);
      expect(await listSlugs({ q: '_' })).toEqual([]);
      expect(await listSlugs({ q: '\\' })).toEqual([]);
    });

    it('ignores a blank search', async () => {
      expect(await listSlugs({ q: '   ' })).toEqual(BY_DATE);
    });
  });

  it('combines filters', async () => {
    expect(
      await listSlugs({ category: 'CONCERT', seating: 'SEATED', availability: 'SOLD_OUT' }),
    ).toEqual(['delta-sold-out']);
    expect(await listSlugs({ category: 'TALK', venue: 'cat-loft' })).toEqual([]);
  });

  it('returns an empty page when nothing matches', async () => {
    expect(await list({ q: 'no such event' })).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
    });
  });

  describe('sort', () => {
    const tied = byId('beta-talk', 'theta-tie');

    it('sorts by date, latest first', async () => {
      // The tiebreaker stays ascending.
      expect(await listSlugs({ sort: 'date', order: 'desc' })).toEqual([
        'delta-sold-out',
        'epsilon-preview',
        'alpha-night',
        'zeta-scheduled',
        'held-out',
        ...BY_DATE.slice(0, 3),
      ]);
    });

    it('sorts by lowest price, then start time and ID', async () => {
      expect(await listSlugs({ sort: 'price' })).toEqual([
        'gamma-meetup',
        'held-out',
        ...tied,
        'zeta-scheduled',
        'alpha-night',
        'delta-sold-out',
        'epsilon-preview',
      ]);
      expect(await listSlugs({ sort: 'price', order: 'desc' })).toEqual([
        'epsilon-preview',
        'delta-sold-out',
        'alpha-night',
        'zeta-scheduled',
        ...tied,
        'held-out',
        'gamma-meetup',
      ]);
    });

    it('sorts by title, ignoring case', async () => {
      const expected = [
        'alpha-night',
        'beta-talk',
        'delta-sold-out',
        'epsilon-preview',
        'gamma-meetup',
        'held-out',
        'theta-tie',
        'zeta-scheduled',
      ];
      expect(await listSlugs({ sort: 'name' })).toEqual(expected);
      expect(await listSlugs({ sort: 'name', order: 'desc' })).toEqual([...expected].reverse());
    });
  });

  describe('pagination', () => {
    it('splits the list into pages', async () => {
      const first = await list({ pageSize: 3 });
      expect(first).toMatchObject({ page: 1, pageSize: 3, total: 8, totalPages: 3 });
      expect(slugs(first.items)).toEqual(BY_DATE.slice(0, 3));

      const last = await list({ pageSize: 3, page: 3 });
      expect(last).toMatchObject({ page: 3, total: 8, totalPages: 3 });
      expect(slugs(last.items)).toEqual(BY_DATE.slice(6));
    });

    it('returns no items past the last page', async () => {
      expect(await list({ pageSize: 3, page: 4 })).toEqual({
        items: [],
        page: 4,
        pageSize: 3,
        total: 8,
        totalPages: 3,
      });
    });

    it('pages one event at a time without skipping or repeating equal start times', async () => {
      const seen: string[] = [];
      for (let page = 1; page <= 8; page++) {
        const result = await list({ pageSize: 1, page });
        expect(result).toMatchObject({ total: 8, totalPages: 8 });
        seen.push(...slugs(result.items));
      }
      expect(seen).toEqual(BY_DATE);
    });

    it('applies filters before paging', async () => {
      const page = await list({ category: 'MEETUP', pageSize: 2, page: 2 });
      expect(page).toMatchObject({ total: 3, totalPages: 2 });
      expect(page.items).toHaveLength(1);
    });
  });

  it.each([
    ['page', { page: 0 }],
    ['pageSize', { pageSize: 101 }],
    ['category', { category: 'OPERA' }],
    ['seating', { seating: 'seated' }],
    ['availability', { availability: 'AVAILABLE' }],
    ['sort', { sort: 'popularity' }],
    ['order', { order: 'up' }],
    ['from', { from: 'yesterday' }],
    ['to', { from: iso([5, '00:00']), to: iso([5, '00:00']) }],
  ])('answers 400 for an invalid %s', async (path, query) => {
    const res = await request(app.getHttpServer()).get('/events').query(query);
    expect(res.status).toBe(400);
    const problem = ProblemDetailsSchema.parse(res.body);
    expect(problem.type).toBe(PROBLEM_TYPES.VALIDATION_ERROR);
    expect(problem.errors.map((error) => error.path)).toEqual([path]);
  });
});

describe('GET /events/:slug', () => {
  async function get(slug: string) {
    const res = await request(app.getHttpServer()).get(`/events/${slug}`);
    expect(res.status).toBe(200);
    return CatalogueEventSchema.parse(res.body);
  }

  it('describes the event with its availability per section, without a session', async () => {
    const alpha = await get('alpha-night');
    const [summary] = (await list({ q: 'Alpha' })).items;
    expect(alpha).toEqual({
      ...summary,
      venue: { ...summary?.venue, address: '1 Hall Road' },
      description: 'Catalogue test event alpha-night.',
      maxTicketsPerOrder: 6,
      tickets: { total: 10, available: 10, held: 0, sold: 0 },
      sections: [
        {
          id: rowId('section:cat-hall:Stalls'),
          name: 'Stalls',
          type: 'SEATED',
          tickets: { total: 10, available: 10, held: 0, sold: 0 },
          priceRange: { minCents: 4000, maxCents: 4000 },
          nextReleaseAt: null,
        },
        {
          id: rowId('section:cat-hall:Floor'),
          name: 'Floor',
          type: 'GA',
          tickets: { total: 0, available: 0, held: 0, sold: 0 },
          priceRange: { minCents: 2500, maxCents: 2500 },
          nextReleaseAt: iso([2, '12:00']),
        },
      ],
    });
  });

  it('counts sold and held tickets, and expired holds as available', async () => {
    const before = await get('held-out');
    expect(before).toMatchObject({
      availability: 'SOLD_OUT',
      availableTickets: 0,
      tickets: { total: 10, available: 0, held: 4, sold: 6 },
    });
    expect(before.sections).toMatchObject([
      { name: 'Loft', tickets: { total: 10, available: 0, held: 4, sold: 6 } },
    ]);

    await setClock({ freezeAt: HOLD_ENDS.toISOString() });
    const after = await get('held-out');
    expect(after).toMatchObject({
      availability: 'ON_SALE',
      availableTickets: 4,
      tickets: { total: 10, available: 4, held: 0, sold: 6 },
    });
  });

  it('includes released tickets once a scheduled batch releases', async () => {
    await setClock({ freezeAt: iso([2, '12:00']) });
    const alpha = await get('alpha-night');
    expect(alpha.tickets).toEqual({ total: 30, available: 30, held: 0, sold: 0 });
    expect(alpha.sections[1]).toMatchObject({
      name: 'Floor',
      tickets: { total: 20, available: 20 },
      nextReleaseAt: null,
    });
  });

  it('shows past events as SALES_ENDED', async () => {
    expect(await get('past-show')).toMatchObject({ availability: 'SALES_ENDED' });
  });

  it.each(['draft-gig', 'cancelled-gig', 'no-such-event', 'Alpha-Night'])(
    'answers 404 for %s',
    async (slug) => {
      const res = await request(app.getHttpServer()).get(`/events/${slug}`);
      expect(res.status).toBe(404);
      expect(ProblemDetailsSchema.parse(res.body).detail).toBe(
        'No published event with this slug.',
      );
    },
  );
});

describe('GET /venues', () => {
  it('lists venues with published events by name, without a session', async () => {
    const res = await request(app.getHttpServer()).get('/venues');
    expect(res.status).toBe(200);
    const page = CatalogueVenuePageSchema.parse(res.body);
    // Cat Backstage only has a draft and a cancelled event.
    expect(page.items.map((venue) => venue.slug)).toEqual(['cat-arena', 'cat-hall', 'cat-loft']);
    expect(page).toMatchObject({ total: 3, totalPages: 1 });
  });

  it('paginates', async () => {
    const res = await request(app.getHttpServer()).get('/venues').query({ pageSize: 1, page: 2 });
    const page = CatalogueVenuePageSchema.parse(res.body);
    expect(page.items.map((venue) => venue.slug)).toEqual(['cat-hall']);
    expect(page).toMatchObject({ total: 3, totalPages: 3 });
  });
});
