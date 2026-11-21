import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { ClockService } from '../../clock/clock.service.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { seedDatabase } from '../../seed/seed.js';
import { dataHash } from '../../testing/integration/data-hash.js';
import { createIntegrationApp } from '../../testing/integration/integration-app.js';
import { resetState } from '../../testing/integration/reset.js';
import {
  BasicCatalogueResultSchema,
  OneSeatLeftResultSchema,
  type ScenarioEvent,
  SoldOutEventResultSchema,
} from './scenario.schemas.js';

const TEST_MODE = { TESTTIX_TEST_MODE: 'true' };
const FROZEN = '2026-11-21T10:15:00.000Z';

let app: NestFastifyApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  app = await createIntegrationApp({ env: TEST_MODE });
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());
});

afterAll(async () => {
  await app.get(ClockService).reset();
  await app.close();
});

beforeEach(async () => {
  await resetState(inject('integration'));
  await app.get(ClockService).freezeAt(new Date(FROZEN));
});

async function seed(scenario: string) {
  const res = await http.post(`/__test/seed/${scenario}`);
  expect(res.status).toBe(201);
  return res.body as unknown;
}

/** The event as stored, with its inventory counted by status. */
async function expectStored(event: ScenarioEvent) {
  const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
  expect(stored).toMatchObject({
    slug: event.slug,
    title: event.title,
    status: event.status,
    venueId: event.venueId,
    startsAt: new Date(event.startsAt),
    createdAt: new Date(FROZEN),
  });
  const counts = await prisma.inventoryUnit.groupBy({
    by: ['status'],
    where: { eventId: event.id },
    _count: true,
  });
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count]));
  expect({
    total: counts.reduce((sum, c) => sum + c._count, 0),
    available: byStatus.AVAILABLE ?? 0,
    sold: byStatus.SOLD ?? 0,
  }).toEqual(event.tickets);
}

describe('POST /__test/seed/basic-catalogue', () => {
  it('creates three published events on sale, with usable IDs', async () => {
    const body = BasicCatalogueResultSchema.parse(await seed('basic-catalogue'));

    for (const event of Object.values(body.events)) await expectStored(event);
    const venue = await prisma.venue.findUniqueOrThrow({
      where: { id: body.venue.id },
      include: { sections: { orderBy: { sortOrder: 'asc' } } },
    });
    expect(venue.sections.map(({ id, name }) => ({ id, name }))).toEqual(
      body.venue.sections.map(({ id, name }) => ({ id, name })),
    );
    expect(body.events.concert.tickets).toEqual({ total: 38, available: 38, sold: 0 });
    expect(await prisma.order.count()).toBe(0);
  });
});

describe('POST /__test/seed/sold-out-event', () => {
  it('creates an event whose every ticket is sold through confirmed orders', async () => {
    const body = SoldOutEventResultSchema.parse(await seed('sold-out-event'));

    await expectStored(body.event);
    expect(body.event.tickets).toEqual({ total: 12, available: 0, sold: 12 });
    const orders = await prisma.order.findMany({
      where: { id: { in: body.orderIds } },
      include: { items: { include: { ticket: true } }, event: true },
    });
    expect(orders).toHaveLength(body.orderIds.length);
    for (const order of orders) {
      expect(order).toMatchObject({ status: 'CONFIRMED', userId: body.buyer.id });
      expect(order.items.length).toBeLessThanOrEqual(order.event.maxTicketsPerOrder);
      expect(order.totalCents).toBe(order.items.reduce((sum, item) => sum + item.priceCents, 0));
      for (const item of order.items) expect(item.ticket).not.toBeNull();
    }
    expect(orders.flatMap((order) => order.items)).toHaveLength(12);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: body.buyer.id } })).toMatchObject({
      email: body.buyer.email,
      role: 'CUSTOMER',
    });
  });
});

describe('POST /__test/seed/one-seat-left', () => {
  it('leaves exactly the returned seat available', async () => {
    const body = OneSeatLeftResultSchema.parse(await seed('one-seat-left'));

    await expectStored(body.event);
    const available = await prisma.inventoryUnit.findMany({
      where: { eventId: body.event.id, status: 'AVAILABLE' },
      include: { seat: true },
    });
    expect(available).toHaveLength(1);
    expect(available[0]).toMatchObject({
      id: body.seat.inventoryUnitId,
      seatId: body.seat.id,
      sectionId: body.seat.sectionId,
      priceCents: body.seat.priceCents,
      seat: { row: body.seat.row, number: body.seat.number },
    });
  });
});

describe('every scenario', () => {
  const scenarios = ['basic-catalogue', 'sold-out-event', 'one-seat-left'];

  it.each(scenarios)('%s creates new rows on every call', async (scenario) => {
    const first = (await seed(scenario)) as { venue: { id: string; slug: string } };
    const second = (await seed(scenario)) as { venue: { id: string; slug: string } };

    expect(second.venue.id).not.toBe(first.venue.id);
    expect(second.venue.slug).not.toBe(first.venue.slug);
    expect(await prisma.venue.count()).toBe(2);
  });

  it('only adds data: the baseline is untouched, and a reset removes the scenarios', async () => {
    await seedDatabase(prisma, new Date(FROZEN));
    const baseline = await dataHash(prisma);

    await Promise.all(scenarios.map((scenario) => seed(scenario)));

    // Every baseline row is still there unchanged: deleting the scenario rows restores the hash.
    const venues = await prisma.venue.findMany({ where: { slug: { startsWith: 'scenario-' } } });
    expect(venues).toHaveLength(3);
    const venueIds = venues.map(({ id }) => id);
    await prisma.$transaction(async (tx) => {
      const events = { venueId: { in: venueIds } };
      await tx.ticket.deleteMany({ where: { orderItem: { order: { event: events } } } });
      await tx.orderItem.deleteMany({ where: { order: { event: events } } });
      await tx.order.deleteMany({ where: { event: events } });
      await tx.user.deleteMany({ where: { email: { endsWith: '@scenario.testtix.test' } } });
      await tx.event.deleteMany({ where: events });
      await tx.venue.deleteMany({ where: { id: { in: venueIds } } });
    });
    expect(await dataHash(prisma)).toEqual(baseline);

    await Promise.all(scenarios.map((scenario) => seed(scenario)));
    const res = await http.post('/__test/reset').send({ freezeAt: FROZEN });
    expect(res.status).toBe(200);
    expect(await dataHash(prisma)).toEqual(baseline);
  });

  it('works on an empty database (no baseline needed)', async () => {
    expect(await prisma.venue.count()).toBe(0);
    for (const scenario of scenarios) await seed(scenario);
    expect(await prisma.event.count()).toBe(5);
  });

  it.each(scenarios)('%s stays open when the server has a test API key', async (scenario) => {
    const keyed = await createIntegrationApp({
      env: { ...TEST_MODE, TEST_API_KEY: 'integration-test-key-0123' },
    });
    try {
      expect((await request(keyed.getHttpServer()).post(`/__test/seed/${scenario}`)).status).toBe(
        201,
      );
    } finally {
      await keyed.close();
    }
  });
});
