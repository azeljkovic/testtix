import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DEV_PAYMENTS_API_KEY, PROBLEM_TYPES } from '@testtix/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ClockService } from '../clock/clock.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import { HoldSweeperService } from '../holds/hold-sweeper.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { uuidv7 } from '../infra/uuid.js';
import type { BatchSpec } from '../seed/fixtures.js';
import type { SessionClient } from '../testing/auth.js';
import {
  CHECKOUT_SALES_OPEN as OPEN,
  type CheckoutEvent,
  checkout,
  checkoutCustomer,
  expectProblem,
  holdTickets,
  insertCheckoutEvent,
  parseOrder,
} from '../testing/integration/checkout.js';
import { createIntegrationApp } from '../testing/integration/integration-app.js';
import {
  type PaymentProviderStub,
  startPaymentProviderStub,
} from '../testing/payment-provider-stub.js';
import { OrderJobs } from './order-jobs.js';
import { OrderProcessingService } from './order-processing.service.js';
import { OrderPageSchema, OrderSchema } from './orders.schemas.js';

/** The server clock while testing. Events are relative to the start of its UTC day. */
const NOW = new Date('2027-03-01T12:00:00.000Z');
const HOLD_SEC = 600;
const POLL_MS = 2000;
const WEB = 'http://shop.test';
const WEBHOOK = 'http://api.test/webhooks/payments';

let app: NestFastifyApplication;
let prisma: PrismaService;
let clock: ClockService;
let provider: PaymentProviderStub;

beforeAll(async () => {
  provider = await startPaymentProviderStub();
  app = await createIntegrationApp({
    env: {
      TESTTIX_TEST_MODE: 'true',
      PAYMENTS_BASE_URL: provider.url,
      PAYMENTS_WEBHOOK_URL: WEBHOOK,
      WEB_BASE_URL: WEB,
      ORDER_POLL_INTERVAL_MS: String(POLL_MS),
    },
  });
  prisma = app.get(PrismaService);
  clock = app.get(ClockService);
});

beforeEach(async () => {
  await clock.freezeAt(NOW);
  provider.behaviour = 'ok';
  provider.requests.length = 0;
});

afterAll(async () => {
  await clock.reset();
  await app.close();
  await provider.close();
});

function insertEvent(batches?: BatchSpec[]): Promise<CheckoutEvent> {
  return insertCheckoutEvent(app, { now: NOW, holdDurationSec: HOLD_SEC, batches });
}

function customer(options: { emailVerified?: boolean } = {}): Promise<SessionClient> {
  return checkoutCustomer(app, options);
}

async function storedStatus(orderId: string) {
  return (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;
}

/** A customer who holds A1, A2 and two Floor places of a new event. */
async function customerWithHold() {
  const event = await insertEvent();
  const client = await customer();
  const hold = await holdTickets(client, event.id, {
    seats: [event.seat('A2'), event.seat('A1')],
    ga: [{ sectionId: event.section('Floor'), quantity: 2 }],
  });
  return { event, client, hold };
}

describe('POST /orders', () => {
  it('creates a pending order for the hold’s tickets and a payment session', async () => {
    const { event, client, hold } = await customerWithHold();

    const order = parseOrder(await checkout(client, hold.id), 201);

    expect(order).toMatchObject({
      status: 'PENDING_PAYMENT',
      event: { id: event.id, title: event.title, venue: { timezone: 'America/New_York' } },
      totalCents: 2 * 4000 + 2 * 2500,
      ticketCount: 4,
      expiresAt: hold.expiresAt,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      retryAfterMs: POLL_MS,
      paymentUrl: `${provider.url}/pay/ps_test_1`,
    });
    expect(order.items).toEqual(hold.items);

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.headers.authorization).toBe(`Bearer ${DEV_PAYMENTS_API_KEY}`);
    expect(provider.requests[0]?.body).toEqual({
      amountCents: 13_000,
      currency: 'USD',
      description: `4 tickets for ${event.title}`,
      returnUrl: `${WEB}/orders/${order.id}`,
      webhookUrl: WEBHOOK,
      metadata: { orderId: order.id },
    });

    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true },
    });
    expect(stored).toMatchObject({ holdId: hold.id, paymentSessionId: 'ps_test_1' });
    expect(stored.items.map((item) => item.inventoryUnitId).sort()).toEqual(
      hold.items.map((item) => item.inventoryUnitId).sort(),
    );
    // The tickets stay in the hold, which the order now owns.
    const units = await prisma.inventoryUnit.findMany({ where: { holdId: hold.id } });
    expect(units).toHaveLength(4);
    expect(units.every((unit) => unit.status === 'HELD')).toBe(true);
  });

  it('returns the existing order with 200 when the hold is checked out again', async () => {
    const { client, hold } = await customerWithHold();
    const first = parseOrder(await checkout(client, hold.id), 201);

    const again = parseOrder(await checkout(client, hold.id), 200);

    expect(again).toEqual(first);
    expect(provider.requests).toHaveLength(1);
    expect(await prisma.order.count({ where: { holdId: hold.id } })).toBe(1);
  });

  it('creates one order when the same hold is checked out concurrently', async () => {
    const { client, hold } = await customerWithHold();

    const responses = await Promise.all([checkout(client, hold.id), checkout(client, hold.id)]);

    expect(responses.map((res) => res.status).sort()).toEqual([200, 201]);
    const [a, b] = responses.map((res) => OrderSchema.parse(res.body));
    expect(a?.id).toBe(b?.id);
    expect(a?.paymentUrl).toBe(b?.paymentUrl);
    expect(await prisma.order.count({ where: { holdId: hold.id } })).toBe(1);
  });

  it('requires a verified email', async () => {
    const event = await insertEvent();
    const client = await customer({ emailVerified: false });
    const hold = await holdTickets(client, event.id, { seats: [event.seat('A1')] });

    expectProblem(await checkout(client, hold.id), 403, PROBLEM_TYPES.EMAIL_NOT_VERIFIED);
    expect(await prisma.order.count({ where: { eventId: event.id } })).toBe(0);
  });

  it('answers 404 for someone else’s hold and for unknown holds', async () => {
    const { event, hold } = await customerWithHold();
    const other = await customer();

    expect((await checkout(other, hold.id)).status).toBe(404);
    expect((await checkout(other, uuidv7(NOW))).status).toBe(404);
    expect(await prisma.order.count({ where: { eventId: event.id } })).toBe(0);
  });

  it('answers 409 hold-expired once the hold has expired', async () => {
    const { event, client, hold } = await customerWithHold();
    await clock.advanceBy(HOLD_SEC * 1000);

    expectProblem(await checkout(client, hold.id), 409, PROBLEM_TYPES.HOLD_EXPIRED);
    expect(await prisma.order.count({ where: { eventId: event.id } })).toBe(0);
  });

  it('answers 409 event-not-on-sale when the event was cancelled after the hold', async () => {
    const { event, client, hold } = await customerWithHold();
    await prisma.event.update({ where: { id: event.id }, data: { status: 'CANCELLED' } });

    expectProblem(await checkout(client, hold.id), 409, PROBLEM_TYPES.EVENT_NOT_ON_SALE);
  });

  it('answers 400 for a body without a valid hold ID', async () => {
    const client = await customer();
    expectProblem(await client.post('/orders', {}), 400, PROBLEM_TYPES.VALIDATION_ERROR);
    expectProblem(
      await client.post('/orders', { holdId: 'nope' }),
      400,
      PROBLEM_TYPES.VALIDATION_ERROR,
    );
  });

  it('answers 401 without a session', async () => {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .send({ holdId: uuidv7(NOW) });
    expect(res.status).toBe(401);
  });

  it('keeps the order and answers 503 when the provider fails; a retry gets the payment page', async () => {
    const { client, hold } = await customerWithHold();
    provider.behaviour = 'error';

    expectProblem(await checkout(client, hold.id), 503, PROBLEM_TYPES.PAYMENT_PROVIDER_UNAVAILABLE);
    const stored = await prisma.order.findUniqueOrThrow({ where: { holdId: hold.id } });
    expect(stored).toMatchObject({
      status: 'PENDING_PAYMENT',
      paymentSessionId: null,
      paymentUrl: null,
    });

    provider.behaviour = 'ok';
    const order = parseOrder(await checkout(client, hold.id), 200);
    expect(order.id).toBe(stored.id);
    expect(order.paymentUrl).toMatch(/\/pay\/ps_test_\d+$/);
  });

  it('creates a free order without a payment session', async () => {
    const event = await insertEvent([
      { name: 'Free', priceCents: 0, sections: ['Seats', 'Floor'], releases: OPEN },
    ]);
    const client = await customer();
    const hold = await holdTickets(client, event.id, { seats: [event.seat('B1')] });

    const order = parseOrder(await checkout(client, hold.id), 201);

    // No payment to wait for: it is processing at once, and the hold is used up.
    expect(order).toMatchObject({
      status: 'PROCESSING',
      totalCents: 0,
      paymentUrl: null,
      retryAfterMs: POLL_MS,
    });
    expect(provider.requests).toHaveLength(0);
    expect(await prisma.hold.findUnique({ where: { id: hold.id } })).toBeNull();
    expect(await prisma.inventoryUnit.findMany({ where: { seatId: event.seat('B1') } })).toEqual([
      expect.objectContaining({ status: 'SOLD', holdId: null, heldUntil: null }),
    ]);

    const processing = new OrderProcessingService(
      prisma,
      clock,
      app.get(OrderJobs),
      app.get(APP_CONFIG),
    );
    expect(await processing.finalize(order.id)).toBe('CONFIRMED');
    const confirmed = parseOrder(await client.get(`/orders/${order.id}`), 200);
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', retryAfterMs: null });
  });
});

describe('order expiry', () => {
  it('expires an unpaid order when its hold expires: lazily, then stored by the sweep', async () => {
    const { event, client, hold } = await customerWithHold();
    const created = parseOrder(await checkout(client, hold.id), 201);

    await clock.advanceBy(HOLD_SEC * 1000 - 500);
    expect(parseOrder(await client.get(`/orders/${created.id}`), 200)).toMatchObject({
      status: 'PENDING_PAYMENT',
      retryAfterMs: 500,
    });

    await clock.advanceBy(500);
    expect(parseOrder(await client.get(`/orders/${created.id}`), 200)).toMatchObject({
      status: 'EXPIRED',
      paymentUrl: null,
      retryAfterMs: null,
    });
    expect(await storedStatus(created.id)).toBe('PENDING_PAYMENT');

    await new HoldSweeperService(prisma, clock).sweep();
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored).toMatchObject({ status: 'EXPIRED', holdId: null });
    expect(stored.updatedAt.getTime()).toBe(NOW.getTime() + HOLD_SEC * 1000);
    const units = await prisma.inventoryUnit.findMany({ where: { eventId: event.id } });
    expect(units.every((unit) => unit.status === 'AVAILABLE')).toBe(true);
  });

  it('expires the unpaid order when the customer releases its hold', async () => {
    const { client, hold } = await customerWithHold();
    const order = parseOrder(await checkout(client, hold.id), 201);

    expect((await client.delete(`/holds/${hold.id}`)).status).toBe(204);

    expect(await storedStatus(order.id)).toBe('EXPIRED');
    expect(parseOrder(await client.get(`/orders/${order.id}`), 200).status).toBe('EXPIRED');
  });

  it('expires the unpaid order when the customer replaces its hold', async () => {
    const { event, client, hold } = await customerWithHold();
    const order = parseOrder(await checkout(client, hold.id), 201);

    const replacement = await holdTickets(client, event.id, { seats: [event.seat('B3')] });

    expect(await storedStatus(order.id)).toBe('EXPIRED');
    // The new hold can be checked out on its own.
    const next = parseOrder(await checkout(client, replacement.id), 201);
    expect(next.id).not.toBe(order.id);
    expect(next.totalCents).toBe(4000);
  });
});

describe('GET /orders/:orderId', () => {
  it('answers 404 for someone else’s order and unknown orders', async () => {
    const { client, hold } = await customerWithHold();
    const order = parseOrder(await checkout(client, hold.id), 201);
    const other = await customer();

    expect(parseOrder(await client.get(`/orders/${order.id}`), 200)).toEqual(order);
    expect((await other.get(`/orders/${order.id}`)).status).toBe(404);
    expect((await client.get(`/orders/${uuidv7(NOW)}`)).status).toBe(404);
    expectProblem(await client.get('/orders/nope'), 400, PROBLEM_TYPES.VALIDATION_ERROR);
  });
});

describe('GET /orders', () => {
  it('lists only my orders, newest first, paginated', async () => {
    const client = await customer();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const event = await insertEvent();
      const hold = await holdTickets(client, event.id, { seats: [event.seat('A1')] });
      ids.push(parseOrder(await checkout(client, hold.id), 201).id);
      await clock.advanceBy(1000);
    }
    // Someone else's order isn't listed.
    const { client: other, hold } = await customerWithHold();
    parseOrder(await checkout(other, hold.id), 201);

    const first = OrderPageSchema.parse((await client.get('/orders?pageSize=2')).body);
    expect(first).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(first.items.map((item) => item.id)).toEqual([ids[2], ids[1]]);
    expect(first.items[0]).toMatchObject({
      status: 'PENDING_PAYMENT',
      ticketCount: 1,
      totalCents: 4000,
    });

    const second = OrderPageSchema.parse((await client.get('/orders?page=2&pageSize=2')).body);
    expect(second.items.map((item) => item.id)).toEqual([ids[0]]);

    const empty = OrderPageSchema.parse((await (await customer()).get('/orders')).body);
    expect(empty).toMatchObject({ items: [], total: 0, totalPages: 0 });
  });
});
