import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PROBLEM_TYPES, ProblemDetailsSchema } from '@testtix/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestSession, type SessionClient, sessionClient } from '../testing/auth.js';
import { createIntegrationApp } from '../testing/integration/integration-app.js';
import { AdminVenuePageSchema, AdminVenueSchema } from './venue.schemas.js';

let app: NestFastifyApplication;
let admin: SessionClient;
let customer: SessionClient;

const layout = [
  { type: 'SEATED', name: 'Stalls', rows: 3, seatsPerRow: 4 },
  { type: 'GA', name: 'Standing', capacity: 50 },
];

function venueBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Integration Hall',
    address: '1 Test Street',
    city: 'Port Ellis',
    timezone: 'America/New_York',
    sections: layout,
    ...overrides,
  };
}

async function createVenue(overrides: Record<string, unknown> = {}) {
  const res = await admin.post('/admin/venues', venueBody(overrides));
  expect(res.status).toBe(201);
  return AdminVenueSchema.parse(res.body);
}

function problem(res: request.Response) {
  return ProblemDetailsSchema.parse(res.body);
}

beforeAll(async () => {
  app = await createIntegrationApp({ env: { TESTTIX_TEST_MODE: 'true' } });
  admin = sessionClient(app, await createTestSession(app, { role: 'ADMIN' }));
  customer = sessionClient(app, await createTestSession(app, { role: 'CUSTOMER' }));
});

afterAll(async () => {
  await app.close();
});

describe('access', () => {
  it('answers 401 without a session and 403 for customers', async () => {
    const anonymous = await request(app.getHttpServer()).get('/admin/venues');
    expect(anonymous.status).toBe(401);
    expect((await customer.get('/admin/venues')).status).toBe(403);
    const created = await customer.post('/admin/venues', venueBody());
    expect(created.status).toBe(403);
    expect(problem(created).type).toBe('about:blank');
  });

  it('needs the CSRF token on writes, even for admins', async () => {
    const session = await createTestSession(app, { role: 'ADMIN' });
    const res = await request(app.getHttpServer())
      .post('/admin/venues')
      .set('Cookie', session.cookie)
      .send(venueBody());
    expect(res.status).toBe(403);
    expect(problem(res).type).toBe(PROBLEM_TYPES.CSRF_TOKEN_INVALID);
  });
});

describe('POST /admin/venues', () => {
  it('creates the venue with a generated seat grid and GA capacity', async () => {
    const venue = await createVenue({ name: 'Grid Hall', timezone: 'europe/london' });
    expect(venue).toMatchObject({
      slug: 'grid-hall',
      name: 'Grid Hall',
      timezone: 'Europe/London',
      capacity: 62,
      layoutLocked: false,
    });
    const [stalls, standing] = venue.sections;
    expect(stalls).toMatchObject({ name: 'Stalls', type: 'SEATED', capacity: 12 });
    expect(stalls?.seats.map((seat) => `${seat.row}${seat.number}`)).toEqual([
      'A1',
      'A2',
      'A3',
      'A4',
      'B1',
      'B2',
      'B3',
      'B4',
      'C1',
      'C2',
      'C3',
      'C4',
    ]);
    expect(standing).toMatchObject({ name: 'Standing', type: 'GA', capacity: 50, seats: [] });

    const fetched = await admin.get(`/admin/venues/${venue.id}`);
    expect(fetched.status).toBe(200);
    expect(AdminVenueSchema.parse(fetched.body)).toEqual(venue);
  });

  it('numbers generated slugs that are taken, and rejects a taken explicit slug', async () => {
    const first = await createVenue({ name: 'Twin Venue' });
    const second = await createVenue({ name: 'Twin Venue' });
    const third = await createVenue({ name: 'Twin  Venue!' });
    expect([first.slug, second.slug, third.slug]).toEqual([
      'twin-venue',
      'twin-venue-2',
      'twin-venue-3',
    ]);

    const res = await admin.post('/admin/venues', venueBody({ slug: 'twin-venue' }));
    expect(res.status).toBe(409);
    expect(problem(res)).toMatchObject({
      type: PROBLEM_TYPES.SLUG_TAKEN,
      errors: [{ path: 'slug' }],
    });
  });

  it.each([
    [{ timezone: 'Mars/Base' }, 'timezone'],
    [{ sections: [] }, 'sections'],
    [{ name: '  ' }, 'name'],
    [{ slug: 'Bad Slug' }, 'slug'],
    [{ sections: [{ type: 'SEATED', name: 'A', rows: 0, seatsPerRow: 5 }] }, 'sections.0.rows'],
    [
      {
        sections: [
          { type: 'GA', name: 'Floor', capacity: 5 },
          { type: 'GA', name: 'FLOOR', capacity: 5 },
        ],
      },
      'sections.1.name',
    ],
  ])('rejects %j with a validation error at %s', async (overrides, path) => {
    const res = await admin.post('/admin/venues', venueBody(overrides));
    expect(res.status).toBe(400);
    const body = problem(res);
    expect(body.type).toBe(PROBLEM_TYPES.VALIDATION_ERROR);
    expect(body.errors.map((error) => error.path)).toContain(path);
  });
});

describe('GET /admin/venues', () => {
  it('pages through venues by name, then ID', async () => {
    const all = AdminVenuePageSchema.parse((await admin.get('/admin/venues?pageSize=100')).body);
    const names = all.items.map((venue) => venue.name);
    expect(names).toEqual([...names].sort());
    expect(all.items[0]?.sections[0]).not.toHaveProperty('seats');

    const page2 = AdminVenuePageSchema.parse(
      (await admin.get('/admin/venues?page=2&pageSize=2')).body,
    );
    expect(page2).toMatchObject({ page: 2, pageSize: 2, total: all.total });
    expect(page2.totalPages).toBe(Math.ceil(all.total / 2));
    expect(page2.items.map((venue) => venue.id)).toEqual(all.items.slice(2, 4).map((v) => v.id));

    const beyond = AdminVenuePageSchema.parse(
      (await admin.get(`/admin/venues?page=${all.total + 1}&pageSize=1`)).body,
    );
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(all.total);
  });

  it('rejects a bad page query', async () => {
    const res = await admin.get('/admin/venues?pageSize=101');
    expect(res.status).toBe(400);
    expect(problem(res).errors[0]?.path).toBe('pageSize');
  });
});

describe('GET/PATCH/DELETE /admin/venues/:venueId', () => {
  it('answers 404 for an unknown venue and 400 for a malformed ID', async () => {
    const missing = '019b76da-a800-7000-8000-000000000000';
    expect((await admin.get(`/admin/venues/${missing}`)).status).toBe(404);
    expect((await admin.patch(`/admin/venues/${missing}`, { name: 'X' })).status).toBe(404);
    expect((await admin.delete(`/admin/venues/${missing}`)).status).toBe(404);
    const malformed = await admin.get('/admin/venues/not-a-uuid');
    expect(malformed.status).toBe(400);
    expect(problem(malformed).errors[0]?.path).toBe('venueId');
  });

  it('updates fields and replaces the layout with new IDs', async () => {
    const venue = await createVenue({ name: 'Changing Hall' });
    const res = await admin.patch(`/admin/venues/${venue.id}`, {
      name: 'Changed Hall',
      sections: [{ type: 'GA', name: 'Lawn', capacity: 300 }],
    });
    expect(res.status).toBe(200);
    const updated = AdminVenueSchema.parse(res.body);
    expect(updated).toMatchObject({
      id: venue.id,
      slug: venue.slug,
      name: 'Changed Hall',
      address: venue.address,
      capacity: 300,
    });
    expect(updated.sections).toEqual([
      { id: expect.any(String) as string, name: 'Lawn', type: 'GA', capacity: 300, seats: [] },
    ]);
    expect(venue.sections.map((s) => s.id)).not.toContain(updated.sections[0]?.id);
  });

  it('rejects a slug another venue has', async () => {
    const a = await createVenue({ name: 'Slug A' });
    const b = await createVenue({ name: 'Slug B' });
    const res = await admin.patch(`/admin/venues/${b.id}`, { slug: a.slug });
    expect(res.status).toBe(409);
    expect(problem(res).type).toBe(PROBLEM_TYPES.SLUG_TAKEN);
  });

  it('locks the layout once tickets are released, and keeps venues in use', async () => {
    const venue = await createVenue({ name: 'Busy Hall' });
    const event = await admin.post('/admin/events', {
      title: 'Busy Night',
      performer: 'The Testers',
      description: 'Uses the venue.',
      category: 'CONCERT',
      venueId: venue.id,
      startsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 30 * 86_400_000 + 7_200_000).toISOString(),
      salesOpenAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(event.status).toBe(201);
    const eventId = (event.body as { id: string }).id;

    // An event without inventory keeps the venue in use, but not its layout locked.
    expect((await admin.delete(`/admin/venues/${venue.id}`)).status).toBe(409);
    expect(
      (await admin.patch(`/admin/venues/${venue.id}`, { sections: layout.slice(1) })).status,
    ).toBe(200);

    const reloaded = AdminVenueSchema.parse((await admin.get(`/admin/venues/${venue.id}`)).body);
    const batch = await admin.post(`/admin/events/${eventId}/batches`, {
      name: 'Standing',
      priceCents: 2000,
      gaSections: [{ sectionId: reloaded.sections[0]?.id, quantity: 10 }],
    });
    expect(batch.status).toBe(201);

    const locked = await admin.patch(`/admin/venues/${venue.id}`, {
      name: 'Still Renamable',
      sections: layout,
    });
    expect(locked.status).toBe(409);
    expect(problem(locked)).toMatchObject({
      type: PROBLEM_TYPES.LAYOUT_LOCKED,
      errors: [{ path: 'sections' }],
    });
    // Nothing changed, not even the name sent with the layout.
    const after = AdminVenueSchema.parse((await admin.get(`/admin/venues/${venue.id}`)).body);
    expect(after).toMatchObject({ name: 'Busy Hall', layoutLocked: true });
    // Other fields can still change.
    expect((await admin.patch(`/admin/venues/${venue.id}`, { name: 'Renamed' })).status).toBe(200);

    const inUse = await admin.delete(`/admin/venues/${venue.id}`);
    expect(inUse.status).toBe(409);
    expect(problem(inUse).type).toBe(PROBLEM_TYPES.VENUE_IN_USE);
  });

  it('deletes an unused venue', async () => {
    const venue = await createVenue({ name: 'Short-lived Hall' });
    expect((await admin.delete(`/admin/venues/${venue.id}`)).status).toBe(204);
    expect((await admin.get(`/admin/venues/${venue.id}`)).status).toBe(404);
  });
});
