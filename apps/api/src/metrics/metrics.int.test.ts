import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ClockService } from '../clock/clock.service.js';
import { SeatMapSchema } from '../holds/holds.schemas.js';
import { PrismaService } from '../infra/prisma.service.js';
import {
  ConfirmedOrderResultSchema,
  HoldAboutToExpireResultSchema,
} from '../test-api/scenarios/scenario.schemas.js';
import { createTestSession, sessionClient } from '../testing/auth.js';
import { createIntegrationApp } from '../testing/integration/integration-app.js';

let app: NestFastifyApplication;
let clock: ClockService;

beforeAll(async () => {
  app = await createIntegrationApp({ env: { TESTTIX_TEST_MODE: 'true' } });
  clock = app.get(ClockService);
});

afterEach(async () => {
  await clock.reset();
});

afterAll(async () => {
  await app.close();
});

async function scrape(): Promise<string> {
  const res = await request(app.getHttpServer()).get('/metrics').expect(200);
  return res.text;
}

async function seed<T>(scenario: string, body: object, parse: (value: unknown) => T): Promise<T> {
  const res = await request(app.getHttpServer())
    .post(`/__test/seed/${scenario}`)
    .send(body)
    .expect(201);
  return parse(res.body);
}

describe('hold metrics', () => {
  it('counts hold requests by outcome and the tickets held per event', async () => {
    const seeded = await seed('hold-about-to-expire', { expiresInSec: 60 }, (body) =>
      HoldAboutToExpireResultSchema.parse(body),
    );
    const eventId = seeded.event.id;
    const map = SeatMapSchema.parse(
      (await request(app.getHttpServer()).get(`/events/${eventId}/seats`).expect(200)).body,
    );
    const free = map.sections
      .flatMap((s) => (s.type === 'SEATED' ? s.rows.flatMap((r) => r.seats) : []))
      .find((seat) => seat.status === 'AVAILABLE');
    if (free === undefined) throw new Error('The scenario has no available seat');

    const customer = sessionClient(app, await createTestSession(app, { role: 'CUSTOMER' }));
    const takenSeat = seeded.hold.seats[0]?.id;
    await customer
      .post(`/events/${eventId}/holds`)
      .send({ seats: [takenSeat], ga: [] })
      .expect(409);
    await customer
      .post(`/events/${eventId}/holds`)
      .send({ seats: [free.id], ga: [] })
      .expect(201);
    await customer
      .post(`/events/${eventId}/holds`)
      .send({ seats: [map.sections[0]?.id], ga: [] }) // Not a seat of the venue.
      .expect(400);

    let text = await scrape();
    expect(text).toContain('testtix_hold_requests_total{outcome="created"} 1');
    expect(text).toContain('testtix_hold_requests_total{outcome="tickets_unavailable"} 1');
    expect(text).toContain('testtix_hold_requests_total{outcome="rejected"} 1');
    expect(text).toContain(`testtix_held_tickets{event_id="${eventId}"} 3`);

    // Expired holds count as available (lazy expiry), before any sweep.
    await clock.advanceBy(60_000);
    text = await scrape();
    expect(text).toContain(`testtix_held_tickets{event_id="${eventId}"} 1`);
  });
});

describe('order metrics', () => {
  it('reports every status, an unpaid order past its expiry as EXPIRED', async () => {
    await seed('confirmed-order', {}, (body) => ConfirmedOrderResultSchema.parse(body));
    const second = await seed('confirmed-order', {}, (body) =>
      ConfirmedOrderResultSchema.parse(body),
    );
    const now = await clock.now();
    await app.get(PrismaService).order.update({
      where: { id: second.order.id },
      data: { status: 'PENDING_PAYMENT', expiresAt: new Date(now.getTime() + 60_000) },
    });

    let text = await scrape();
    expect(text).toContain('testtix_orders{status="CONFIRMED"} 1');
    expect(text).toContain('testtix_orders{status="PENDING_PAYMENT"} 1');
    expect(text).toContain('testtix_orders{status="PROCESSING"} 0');
    expect(text).toContain('testtix_orders{status="FAILED"} 0');
    expect(text).toContain('testtix_orders{status="EXPIRED"} 0');

    await clock.advanceBy(60_000);
    text = await scrape();
    expect(text).toContain('testtix_orders{status="PENDING_PAYMENT"} 0');
    expect(text).toContain('testtix_orders{status="EXPIRED"} 1');
  });
});
