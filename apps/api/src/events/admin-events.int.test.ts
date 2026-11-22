import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PROBLEM_TYPES, ProblemDetailsSchema } from '@testtix/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaService } from '../infra/prisma.service.js';
import { uuidv7 } from '../infra/uuid.js';
import {
  createTestSession,
  type SessionClient,
  sessionClient,
  type TestSession,
} from '../testing/auth.js';
import { createIntegrationApp } from '../testing/integration/integration-app.js';
import { type AdminVenue, AdminVenueSchema } from '../venues/venue.schemas.js';
import {
  type AdminEvent,
  AdminBatchSchema,
  AdminEventPageSchema,
  AdminEventSchema,
} from './event.schemas.js';

const NOW = new Date('2027-03-01T12:00:00.000Z');
const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();
const MISSING_ID = '019b76da-a800-7000-8000-000000000000';

let app: NestFastifyApplication;
let prisma: PrismaService;
let adminSession: TestSession;
let admin: SessionClient;
let customer: SessionClient;
let venue: AdminVenue;
/** A second venue, for references that don't belong to the event's venue. */
let otherVenue: AdminVenue;

function setClock(body: object) {
  return request(app.getHttpServer()).post('/__test/clock').send(body).expect(200);
}

function problem(res: request.Response) {
  return ProblemDetailsSchema.parse(res.body);
}

function eventBody(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Integration Night',
    performer: 'The Fixtures',
    description: 'An event made by the admin API.',
    category: 'CONCERT',
    venueId: venue.id,
    startsAt: at(30 * DAY),
    endsAt: at(30 * DAY + 3 * 3_600_000),
    salesOpenAt: at(DAY),
    ...overrides,
  };
}

async function createEvent(overrides: Record<string, unknown> = {}): Promise<AdminEvent> {
  const res = await admin.post('/admin/events', eventBody(overrides));
  expect(res.status).toBe(201);
  return AdminEventSchema.parse(res.body);
}

async function getEvent(id: string): Promise<AdminEvent> {
  const res = await admin.get(`/admin/events/${id}`);
  expect(res.status).toBe(200);
  return AdminEventSchema.parse(res.body);
}

function section(v: AdminVenue, name: string) {
  const found = v.sections.find((s) => s.name === name);
  if (found === undefined) throw new Error(`No section ${name}`);
  return found;
}

function release(eventId: string, body: Record<string, unknown>) {
  return admin.post(`/admin/events/${eventId}/batches`, {
    name: 'Batch',
    priceCents: 1000,
    ...body,
  });
}

async function releaseGa(eventId: string, quantity = 10) {
  const res = await release(eventId, {
    gaSections: [{ sectionId: section(venue, 'Floor').id, quantity }],
  });
  expect(res.status).toBe(201);
  return AdminBatchSchema.parse(res.body);
}

beforeAll(async () => {
  app = await createIntegrationApp({ env: { TESTTIX_TEST_MODE: 'true' } });
  prisma = app.get(PrismaService);
  await setClock({ freezeAt: NOW.toISOString() });
  adminSession = await createTestSession(app, { role: 'ADMIN' });
  admin = sessionClient(app, adminSession);
  customer = sessionClient(app, await createTestSession(app, { role: 'CUSTOMER' }));
  const created = await admin.post('/admin/venues', {
    name: 'Event Test Hall',
    address: '2 Test Street',
    city: 'Port Ellis',
    timezone: 'America/New_York',
    sections: [
      { type: 'SEATED', name: 'Stalls', rows: 2, seatsPerRow: 5 },
      { type: 'SEATED', name: 'Balcony', rows: 1, seatsPerRow: 4 },
      { type: 'GA', name: 'Floor', capacity: 20 },
    ],
  });
  venue = AdminVenueSchema.parse(created.body);
  const other = await admin.post('/admin/venues', {
    name: 'Elsewhere',
    address: '3 Test Street',
    city: 'Port Ellis',
    timezone: 'America/New_York',
    sections: [
      { type: 'SEATED', name: 'Stalls', rows: 1, seatsPerRow: 2 },
      { type: 'GA', name: 'Floor', capacity: 5 },
    ],
  });
  otherVenue = AdminVenueSchema.parse(other.body);
});

beforeEach(async () => {
  await setClock({ freezeAt: NOW.toISOString() });
});

afterAll(async () => {
  await setClock({ reset: true });
  await app.close();
});

describe('access', () => {
  const routes: [method: 'get' | 'post' | 'patch' | 'delete', path: string][] = [
    ['get', '/admin/events'],
    ['post', '/admin/events'],
    ['get', `/admin/events/${MISSING_ID}`],
    ['patch', `/admin/events/${MISSING_ID}`],
    ['delete', `/admin/events/${MISSING_ID}`],
    ['post', `/admin/events/${MISSING_ID}/publish`],
    ['post', `/admin/events/${MISSING_ID}/unpublish`],
    ['post', `/admin/events/${MISSING_ID}/cancel`],
    ['post', `/admin/events/${MISSING_ID}/batches`],
    ['get', '/admin/venues'],
    ['post', '/admin/venues'],
    ['get', `/admin/venues/${MISSING_ID}`],
    ['patch', `/admin/venues/${MISSING_ID}`],
    ['delete', `/admin/venues/${MISSING_ID}`],
  ];

  it.each(routes)('%s %s: 401 anonymous, 403 customer', async (method, path) => {
    const anonymous = await request(app.getHttpServer())[method](path).send({});
    expect(anonymous.status).toBe(401);
    const res =
      method === 'get' || method === 'delete'
        ? await customer[method](path)
        : await customer[method](path, {});
    expect(res.status).toBe(403);
    expect(problem(res).type).toBe('about:blank');
  });

  it('answers 404 to admins for unknown events', async () => {
    expect((await admin.get(`/admin/events/${MISSING_ID}`)).status).toBe(404);
    expect((await admin.post(`/admin/events/${MISSING_ID}/publish`)).status).toBe(404);
    expect((await release(MISSING_ID, { seatIds: [MISSING_ID] })).status).toBe(404);
  });
});

describe('full lifecycle', () => {
  it('creates, releases, publishes, unpublishes and cancels an event', async () => {
    const event = await createEvent({ title: 'Lifecycle Live', holdDurationSec: 300 });
    expect(event).toMatchObject({
      slug: 'lifecycle-live',
      status: 'DRAFT',
      holdDurationSec: 300,
      maxTicketsPerOrder: 6,
      venue: { id: venue.id, slug: venue.slug, timezone: 'America/New_York' },
      tickets: { total: 0, available: 0, held: 0, sold: 0 },
      batches: [],
      createdAt: NOW.toISOString(),
    });

    const noBatches = await admin.post(`/admin/events/${event.id}/publish`);
    expect(noBatches.status).toBe(409);
    expect(problem(noBatches).type).toBe(PROBLEM_TYPES.EVENT_HAS_NO_BATCHES);

    const stalls = await release(event.id, {
      name: 'Stalls',
      priceCents: 4500,
      seatedSectionIds: [section(venue, 'Stalls').id],
    });
    expect(stalls.status).toBe(201);
    expect(AdminBatchSchema.parse(stalls.body)).toMatchObject({
      name: 'Stalls',
      priceCents: 4500,
      releasesAt: NOW.toISOString(),
      released: true,
      tickets: { total: 10, available: 10, held: 0, sold: 0 },
      sections: [{ name: 'Stalls', type: 'SEATED', tickets: { total: 10 } }],
    });
    const later = await release(event.id, {
      name: 'Balcony and floor',
      priceCents: 2500,
      releasesAt: at(3 * DAY),
      seatedSectionIds: [section(venue, 'Balcony').id],
      gaSections: [{ sectionId: section(venue, 'Floor').id, quantity: 15 }],
    });
    expect(later.status).toBe(201);
    expect(AdminBatchSchema.parse(later.body)).toMatchObject({
      released: false,
      tickets: { total: 19 },
      sections: [
        { name: 'Balcony', tickets: { total: 4 } },
        { name: 'Floor', tickets: { total: 15 } },
      ],
    });

    const published = await admin.post(`/admin/events/${event.id}/publish`);
    expect(published.status).toBe(200);
    expect(AdminEventSchema.parse(published.body)).toMatchObject({
      status: 'PUBLISHED',
      tickets: { total: 29, available: 29 },
      batches: [{ name: 'Stalls' }, { name: 'Balcony and floor', released: false }],
    });

    // Scheduled batches count as released once their time has passed.
    await setClock({ advanceBy: 3 * DAY });
    expect((await getEvent(event.id)).batches.map((b) => b.released)).toEqual([true, true]);

    const again = await admin.post(`/admin/events/${event.id}/publish`);
    expect(again.status).toBe(409);
    expect(problem(again).type).toBe(PROBLEM_TYPES.EVENT_STATUS_CONFLICT);

    const unpublished = await admin.post(`/admin/events/${event.id}/unpublish`);
    expect(unpublished.status).toBe(200);
    expect(AdminEventSchema.parse(unpublished.body).status).toBe('DRAFT');
    expect((await admin.post(`/admin/events/${event.id}/unpublish`)).status).toBe(409);
    expect((await admin.post(`/admin/events/${event.id}/publish`)).status).toBe(200);

    const cancelled = await admin.post(`/admin/events/${event.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(AdminEventSchema.parse(cancelled.body).status).toBe('CANCELLED');

    // Cancelled is final.
    for (const res of [
      await admin.post(`/admin/events/${event.id}/cancel`),
      await admin.post(`/admin/events/${event.id}/publish`),
      await admin.patch(`/admin/events/${event.id}`, { title: 'Back from the dead' }),
      await releaseGaRaw(event.id, 1),
      await admin.delete(`/admin/events/${event.id}`),
    ]) {
      expect(res.status).toBe(409);
      expect(problem(res).type).toBe(PROBLEM_TYPES.EVENT_STATUS_CONFLICT);
    }
  });

  it('can cancel a draft', async () => {
    const event = await createEvent();
    const res = await admin.post(`/admin/events/${event.id}/cancel`);
    expect(res.status).toBe(200);
    expect(AdminEventSchema.parse(res.body).status).toBe('CANCELLED');
  });
});

function releaseGaRaw(eventId: string, quantity: number) {
  return release(eventId, { gaSections: [{ sectionId: section(venue, 'Floor').id, quantity }] });
}

describe('POST /admin/events validation', () => {
  it.each([
    [{ startsAt: at(-DAY), endsAt: at(-DAY + 3_600_000), salesOpenAt: at(-2 * DAY) }, 'startsAt'],
    [{ startsAt: NOW.toISOString(), salesOpenAt: at(-DAY) }, 'startsAt'],
    [{ endsAt: at(30 * DAY) }, 'endsAt'],
    [{ salesOpenAt: at(31 * DAY) }, 'salesOpenAt'],
    [{ venueId: MISSING_ID }, 'venueId'],
    [{ category: 'PARTY' }, 'category'],
    [{ maxTicketsPerOrder: 0 }, 'maxTicketsPerOrder'],
    [{ status: 'PUBLISHED' }, ''],
  ])('rejects %j at %j', async (overrides, path) => {
    const res = await admin.post('/admin/events', eventBody(overrides));
    expect(res.status).toBe(400);
    const body = problem(res);
    expect(body.type).toBe(PROBLEM_TYPES.VALIDATION_ERROR);
    expect(body.errors.map((e) => e.path)).toContain(path);
  });

  it('generates unique slugs and rejects a taken one', async () => {
    const a = await createEvent({ title: 'Same Title' });
    const b = await createEvent({ title: 'Same Title' });
    expect([a.slug, b.slug]).toEqual(['same-title', 'same-title-2']);
    const res = await admin.post('/admin/events', eventBody({ slug: 'same-title' }));
    expect(res.status).toBe(409);
    expect(problem(res).type).toBe(PROBLEM_TYPES.SLUG_TAKEN);
    expect((await createEvent({ slug: 'custom-slug' })).slug).toBe('custom-slug');
  });
});

describe('PATCH /admin/events/:eventId', () => {
  it('changes only the fields sent and moves updatedAt', async () => {
    const event = await createEvent();
    await setClock({ advanceBy: 60_000 });
    const res = await admin.patch(`/admin/events/${event.id}`, {
      title: 'Renamed Night',
      maxTicketsPerOrder: 2,
    });
    expect(res.status).toBe(200);
    const updated = AdminEventSchema.parse(res.body);
    expect(updated).toMatchObject({
      title: 'Renamed Night',
      slug: event.slug,
      maxTicketsPerOrder: 2,
      startsAt: event.startsAt,
      createdAt: event.createdAt,
      updatedAt: at(60_000),
    });
  });

  it('applies the time rules to the merged event', async () => {
    const event = await createEvent();
    const res = await admin.patch(`/admin/events/${event.id}`, { endsAt: at(29 * DAY) });
    expect(res.status).toBe(400);
    expect(problem(res).errors).toEqual([
      { path: 'endsAt', code: 'custom', message: 'End time must be after the start time' },
    ]);
    const past = await admin.patch(`/admin/events/${event.id}`, { startsAt: at(-1) });
    expect(problem(past).errors.map((e) => e.path)).toEqual(['startsAt', 'salesOpenAt']);
  });

  it('moves an event to another venue only before its first batch', async () => {
    const event = await createEvent();
    const moved = await admin.patch(`/admin/events/${event.id}`, { venueId: otherVenue.id });
    expect(moved.status).toBe(200);
    expect(AdminEventSchema.parse(moved.body).venue.id).toBe(otherVenue.id);
    const unknown = await admin.patch(`/admin/events/${event.id}`, { venueId: MISSING_ID });
    expect(problem(unknown).errors.map((e) => e.path)).toEqual(['venueId']);

    const batch = await release(event.id, { seatedSectionIds: [section(otherVenue, 'Stalls').id] });
    expect(batch.status).toBe(201);
    const locked = await admin.patch(`/admin/events/${event.id}`, { venueId: venue.id });
    expect(locked.status).toBe(409);
    expect(problem(locked)).toMatchObject({
      type: PROBLEM_TYPES.LAYOUT_LOCKED,
      errors: [{ path: 'venueId' }],
    });
    // Sending the current venue is not a change.
    expect(
      (await admin.patch(`/admin/events/${event.id}`, { venueId: otherVenue.id })).status,
    ).toBe(200);
  });

  it('rejects a slug another event has', async () => {
    const a = await createEvent({ title: 'Slug Owner' });
    const b = await createEvent({ title: 'Slug Wanter' });
    const res = await admin.patch(`/admin/events/${b.id}`, { slug: a.slug });
    expect(res.status).toBe(409);
    expect(problem(res).type).toBe(PROBLEM_TYPES.SLUG_TAKEN);
  });
});

describe('POST /admin/events/:eventId/batches', () => {
  it('releases single seats, then the rest of their section', async () => {
    const event = await createEvent();
    const stalls = section(venue, 'Stalls');
    const [a1, a2] = stalls.seats;
    const single = await release(event.id, { name: 'Front', seatIds: [a1?.id, a2?.id] });
    expect(single.status).toBe(201);
    expect(AdminBatchSchema.parse(single.body).tickets.total).toBe(2);

    const again = await release(event.id, { seatIds: [stalls.seats[3]?.id, a2?.id] });
    expect(again.status).toBe(409);
    expect(problem(again)).toMatchObject({
      type: PROBLEM_TYPES.INVENTORY_ALREADY_RELEASED,
      errors: [{ path: 'seatIds.1', code: 'already_released' }],
    });

    const rest = await release(event.id, { name: 'Rest', seatedSectionIds: [stalls.id] });
    expect(rest.status).toBe(201);
    expect(AdminBatchSchema.parse(rest.body).tickets.total).toBe(8);

    const none = await release(event.id, { seatedSectionIds: [stalls.id] });
    expect(none.status).toBe(409);
    expect(problem(none).errors).toEqual([
      {
        path: 'seatedSectionIds.0',
        code: 'already_released',
        message: 'Every seat in this section has already been released',
      },
    ]);
    const units = await prisma.inventoryUnit.findMany({ where: { eventId: event.id } });
    expect(units).toHaveLength(10);
    expect(new Set(units.map((u) => u.seatId)).size).toBe(10);
    expect(units.every((u) => u.status === 'AVAILABLE')).toBe(true);
  });

  it('keeps GA releases within the section capacity', async () => {
    const event = await createEvent();
    await releaseGa(event.id, 15);
    const over = await releaseGaRaw(event.id, 6);
    expect(over.status).toBe(409);
    expect(problem(over)).toMatchObject({
      type: PROBLEM_TYPES.GA_CAPACITY_EXCEEDED,
      errors: [
        {
          path: 'gaSections.0.quantity',
          message: 'Only 5 places left to release in Floor',
        },
      ],
    });
    await releaseGa(event.id, 5);
    expect((await getEvent(event.id)).tickets.total).toBe(20);
  });

  it('rejects inventory that is not at the event’s venue or has the wrong type', async () => {
    const event = await createEvent();
    const res = await release(event.id, {
      seatedSectionIds: [section(venue, 'Floor').id, section(otherVenue, 'Stalls').id],
      seatIds: [otherVenue.sections[0]?.seats[0]?.id, section(venue, 'Balcony').seats[0]?.id],
      gaSections: [{ sectionId: section(venue, 'Balcony').id, quantity: 1 }],
    });
    expect(res.status).toBe(400);
    expect(problem(res).errors).toEqual([
      { path: 'seatedSectionIds.0', code: 'invalid_section_type', message: 'Not a seated section' },
      {
        path: 'seatedSectionIds.1',
        code: 'not_found',
        message: 'No section with this ID at the venue',
      },
      { path: 'gaSections.0.sectionId', code: 'invalid_section_type', message: 'Not a GA section' },
      { path: 'seatIds.0', code: 'not_found', message: 'No seat with this ID at the venue' },
    ]);

    const overlap = await release(event.id, {
      seatedSectionIds: [section(venue, 'Balcony').id],
      seatIds: [section(venue, 'Balcony').seats[0]?.id],
    });
    expect(overlap.status).toBe(400);
    expect(problem(overlap).errors.map((e) => e.path)).toEqual(['seatIds.0']);
    expect(await prisma.ticketBatch.count({ where: { eventId: event.id } })).toBe(0);
  });

  it('rejects an empty batch', async () => {
    const event = await createEvent();
    const res = await release(event.id, {});
    expect(res.status).toBe(400);
    expect(problem(res).errors[0]?.message).toBe(
      'Release at least one seated section, seat or GA place',
    );
  });

  it('never releases a seat twice or exceeds GA capacity under concurrent requests', async () => {
    const event = await createEvent();
    const seatId = section(venue, 'Balcony').seats[0]?.id;
    const seatResults = await Promise.all(
      Array.from({ length: 5 }, () => release(event.id, { seatIds: [seatId] })),
    );
    expect(seatResults.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);

    const gaResults = await Promise.all(Array.from({ length: 4 }, () => releaseGaRaw(event.id, 8)));
    expect(gaResults.map((r) => r.status).sort()).toEqual([201, 201, 409, 409]);
    const event2 = await getEvent(event.id);
    expect(event2.tickets.total).toBe(17);
  });
});

describe('publish rules', () => {
  it('refuses to publish an event that has already started', async () => {
    const event = await createEvent({
      startsAt: at(2 * 3_600_000),
      endsAt: at(4 * 3_600_000),
      salesOpenAt: at(60_000),
    });
    await releaseGa(event.id);
    // Stay within the admin's session lifetime (7 days of server time).
    await setClock({ advanceBy: 2 * 3_600_000 });
    const res = await admin.post(`/admin/events/${event.id}/publish`);
    expect(res.status).toBe(409);
    expect(problem(res).type).toBe(PROBLEM_TYPES.EVENT_ALREADY_STARTED);
  });
});

describe('sales block unpublishing and deleting', () => {
  /** Marks `count` units of the event sold, or held until `heldUntil`, like checkout will. */
  async function claim(eventId: string, count: number, heldUntil?: Date) {
    const units = await prisma.inventoryUnit.findMany({
      where: { eventId, status: 'AVAILABLE' },
      take: count,
      orderBy: { id: 'asc' },
    });
    const ids = units.map((u) => u.id);
    if (heldUntil === undefined) {
      await prisma.inventoryUnit.updateMany({
        where: { id: { in: ids } },
        data: { status: 'SOLD' },
      });
      return;
    }
    const hold = await prisma.hold.create({
      data: {
        id: uuidv7(NOW),
        eventId,
        userId: adminSession.user.id,
        expiresAt: heldUntil,
        createdAt: NOW,
      },
    });
    await prisma.inventoryUnit.updateMany({
      where: { id: { in: ids } },
      data: { status: 'HELD', holdId: hold.id, heldUntil },
    });
  }

  async function publishedEvent() {
    const event = await createEvent();
    await releaseGa(event.id, 10);
    expect((await admin.post(`/admin/events/${event.id}/publish`)).status).toBe(200);
    return event;
  }

  it('counts held and sold tickets, and expired holds as available', async () => {
    const event = await publishedEvent();
    await claim(event.id, 2);
    await claim(event.id, 3, new Date(NOW.getTime() + 600_000));
    expect((await getEvent(event.id)).tickets).toEqual({
      total: 10,
      available: 5,
      held: 3,
      sold: 2,
    });
    await setClock({ advanceBy: 600_000 });
    expect((await getEvent(event.id)).tickets).toEqual({
      total: 10,
      available: 8,
      held: 0,
      sold: 2,
    });
  });

  it('refuses to unpublish with sold tickets', async () => {
    const event = await publishedEvent();
    await claim(event.id, 1);
    const res = await admin.post(`/admin/events/${event.id}/unpublish`);
    expect(res.status).toBe(409);
    expect(problem(res)).toMatchObject({
      type: PROBLEM_TYPES.EVENT_HAS_SALES,
      detail: '1 ticket is sold or held, so the event cannot be unpublished; cancel it instead.',
    });
    expect((await admin.post(`/admin/events/${event.id}/cancel`)).status).toBe(200);
  });

  it('refuses to unpublish with an active hold, but not an expired one', async () => {
    const event = await publishedEvent();
    await claim(event.id, 2, new Date(NOW.getTime() + 60_000));
    expect((await admin.post(`/admin/events/${event.id}/unpublish`)).status).toBe(409);
    await setClock({ advanceBy: 60_000 });
    expect((await admin.post(`/admin/events/${event.id}/unpublish`)).status).toBe(200);
  });

  it('deletes a draft with its batches and tickets, but not a published one', async () => {
    const event = await createEvent();
    await releaseGa(event.id, 10);
    await admin.post(`/admin/events/${event.id}/publish`);
    const published = await admin.delete(`/admin/events/${event.id}`);
    expect(published.status).toBe(409);
    expect(problem(published).type).toBe(PROBLEM_TYPES.EVENT_STATUS_CONFLICT);

    await admin.post(`/admin/events/${event.id}/unpublish`);
    expect((await admin.delete(`/admin/events/${event.id}`)).status).toBe(204);
    expect((await admin.get(`/admin/events/${event.id}`)).status).toBe(404);
    expect(await prisma.inventoryUnit.count({ where: { eventId: event.id } })).toBe(0);
  });

  it('refuses to delete a draft that has orders', async () => {
    const event = await createEvent();
    await prisma.order.create({
      data: {
        id: uuidv7(NOW),
        userId: adminSession.user.id,
        eventId: event.id,
        status: 'EXPIRED',
        totalCents: 0,
        expiresAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    const res = await admin.delete(`/admin/events/${event.id}`);
    expect(res.status).toBe(409);
    expect(problem(res).type).toBe(PROBLEM_TYPES.EVENT_HAS_SALES);
  });
});

describe('GET /admin/events', () => {
  it('lists every status by start time, then ID, with filters and pages', async () => {
    const startsAt = at(40 * DAY);
    const endsAt = at(40 * DAY + 3_600_000);
    const tied = [
      await createEvent({ title: 'Tie One', startsAt, endsAt }),
      await createEvent({ title: 'Tie Two', startsAt, endsAt }),
      await createEvent({ title: 'Tie Three', startsAt, endsAt, venueId: otherVenue.id }),
    ];
    await admin.post(`/admin/events/${tied[2]?.id ?? ''}/cancel`);

    const all = AdminEventPageSchema.parse((await admin.get('/admin/events?pageSize=100')).body);
    const keys = all.items.map((e) => `${e.startsAt}|${e.id}`);
    expect(keys).toEqual([...keys].sort());
    expect(new Set(all.items.map((e) => e.status))).toEqual(
      new Set(['DRAFT', 'PUBLISHED', 'CANCELLED']),
    );
    expect(all.items[0]).not.toHaveProperty('batches');

    const ids = tied.map((e) => e.id).sort();
    const tiedInList = all.items.filter((e) => e.startsAt === startsAt).map((e) => e.id);
    expect(tiedInList).toEqual(ids);

    const cancelled = AdminEventPageSchema.parse(
      (await admin.get(`/admin/events?status=CANCELLED&venueId=${otherVenue.id}`)).body,
    );
    expect(cancelled.items.map((e) => e.id)).toContain(tied[2]?.id);
    expect(cancelled.items.every((e) => e.status === 'CANCELLED')).toBe(true);
    expect(cancelled.items.every((e) => e.venue.id === otherVenue.id)).toBe(true);

    const page = AdminEventPageSchema.parse(
      (await admin.get('/admin/events?page=2&pageSize=1')).body,
    );
    expect(page).toMatchObject({ page: 2, pageSize: 1, total: all.total, totalPages: all.total });
    expect(page.items.map((e) => e.id)).toEqual([all.items[1]?.id]);

    const bad = await admin.get('/admin/events?status=LIVE');
    expect(bad.status).toBe(400);
    expect(problem(bad).errors[0]?.path).toBe('status');
  });
});
