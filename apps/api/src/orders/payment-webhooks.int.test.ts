import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  DEV_PAYMENTS_WEBHOOK_SECRET,
  PAYMENT_SIGNATURE_HEADER,
  PAYMENT_TIMESTAMP_HEADER,
  PROBLEM_TYPES,
} from '@testtix/shared';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { ClockService } from '../clock/clock.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import { HoldSweeperService } from '../holds/hold-sweeper.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { QUEUE_PREFIX } from '../jobs/jobs.module.js';
import { signWebhook } from '../payments/webhook-signature.js';
import type { SessionClient } from '../testing/auth.js';
import {
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
import { paymentEvent, sendWebhook, type WebhookOrder } from '../testing/webhooks.js';
import { finalizeJobId, ORDER_PROCESSING_QUEUE, OrderJobs } from './order-jobs.js';
import { OrderProcessingService, RECOVERY_GRACE_MS } from './order-processing.service.js';
import type { Order } from './orders.schemas.js';
import { type PaymentWebhookAck, PaymentWebhookAckSchema } from './payment-webhooks.schemas.js';

/** The server clock while testing: far from the real time, which signatures are checked against. */
const NOW = new Date('2027-03-01T12:00:00.000Z');
const HOLD_SEC = 600;
const DELAY_MS = 5000;

let app: NestFastifyApplication;
let prisma: PrismaService;
let clock: ClockService;
let provider: PaymentProviderStub;
let processing: OrderProcessingService;
let queue: Queue;

beforeAll(async () => {
  queue = new Queue(ORDER_PROCESSING_QUEUE, {
    prefix: QUEUE_PREFIX,
    connection: { url: inject('integration').redisUrl },
  });
  await queue.obliterate({ force: true });
  provider = await startPaymentProviderStub();
  app = await createIntegrationApp({
    env: {
      TESTTIX_TEST_MODE: 'true',
      PAYMENTS_BASE_URL: provider.url,
      JOB_PROCESSING_DELAY_MS: String(DELAY_MS),
    },
  });
  prisma = app.get(PrismaService);
  clock = app.get(ClockService);
  // The worker is off in integration tests: run the job's work directly.
  processing = new OrderProcessingService(prisma, clock, app.get(OrderJobs), app.get(APP_CONFIG));
});

beforeEach(async () => {
  await clock.freezeAt(NOW);
});

afterAll(async () => {
  await clock.reset();
  await app.close();
  await provider.close();
  await queue.close();
});

interface PendingOrder {
  event: CheckoutEvent;
  client: SessionClient;
  order: Order & WebhookOrder;
  holdId: string;
  unitIds: string[];
}

/** A customer's `PENDING_PAYMENT` order for seats A1 and A2 and one Floor place. */
async function pendingOrder(): Promise<PendingOrder> {
  const event = await insertCheckoutEvent(app, { now: NOW, holdDurationSec: HOLD_SEC });
  const client = await checkoutCustomer(app);
  const hold = await holdTickets(client, event.id, {
    seats: [event.seat('A1'), event.seat('A2')],
    ga: [{ sectionId: event.section('Floor'), quantity: 1 }],
  });
  const order = parseOrder(await checkout(client, hold.id), 201);
  const { paymentSessionId } = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    select: { paymentSessionId: true },
  });
  return {
    event,
    client,
    order: { ...order, paymentSessionId },
    holdId: hold.id,
    unitIds: hold.items.map((item) => item.inventoryUnitId),
  };
}

function ack(res: { status: number; body: unknown }): PaymentWebhookAck {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return PaymentWebhookAckSchema.parse(res.body);
}

async function stored(orderId: string) {
  return prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { status: true, holdId: true, updatedAt: true },
  });
}

async function unitStates(unitIds: string[]) {
  const units = await prisma.inventoryUnit.findMany({
    where: { id: { in: unitIds } },
    select: { status: true, holdId: true, heldUntil: true },
  });
  return units.map((unit) => `${unit.status}:${unit.holdId === null ? '-' : 'hold'}`);
}

async function getOrder(client: SessionClient, orderId: string): Promise<Order> {
  return parseOrder(await client.get(`/orders/${orderId}`), 200);
}

describe('signature check', () => {
  it('answers 400 and records nothing for a signature made with another secret', async () => {
    const { order } = await pendingOrder();
    const event = paymentEvent(order, 'payment.succeeded');

    const res = await sendWebhook(app, event, { secret: 'whsec_somebody_else_entirely' });

    expectProblem(res, 400, PROBLEM_TYPES.WEBHOOK_SIGNATURE_INVALID);
    expect(await prisma.paymentEvent.count({ where: { providerEventId: event.id } })).toBe(0);
    expect((await stored(order.id)).status).toBe('PENDING_PAYMENT');
  });

  it('answers 400 without the signature headers', async () => {
    const { order } = await pendingOrder();
    const res = await sendWebhook(app, paymentEvent(order, 'payment.succeeded'), { headers: {} });
    expectProblem(res, 400, PROBLEM_TYPES.WEBHOOK_SIGNATURE_INVALID);
  });

  it('answers 400 when the body was changed after signing', async () => {
    const { order } = await pendingOrder();
    const event = paymentEvent(order, 'payment.failed');
    const signed = signWebhook(DEV_PAYMENTS_WEBHOOK_SECRET, JSON.stringify(event), new Date());
    const tampered = paymentEvent(order, 'payment.succeeded', { id: event.id });

    const res = await sendWebhook(app, tampered, {
      headers: {
        [PAYMENT_TIMESTAMP_HEADER]: signed.timestamp,
        [PAYMENT_SIGNATURE_HEADER]: signed.signature,
      },
    });

    expectProblem(res, 400, PROBLEM_TYPES.WEBHOOK_SIGNATURE_INVALID);
  });

  it('answers 400 for a timestamp outside the replay window of the real time', async () => {
    const { order } = await pendingOrder();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);

    const res = await sendWebhook(app, paymentEvent(order, 'payment.succeeded'), {
      signedAt: tenMinutesAgo,
    });

    expectProblem(res, 400, PROBLEM_TYPES.WEBHOOK_SIGNATURE_INVALID);
  });

  it('ignores the test clock for the replay window', async () => {
    const { order } = await pendingOrder();
    // A timestamp at the (frozen, months-away) server clock is not the provider's real time.
    const atServerClock = await sendWebhook(app, paymentEvent(order, 'payment.succeeded'), {
      signedAt: NOW,
    });
    expectProblem(atServerClock, 400, PROBLEM_TYPES.WEBHOOK_SIGNATURE_INVALID);

    // Signed now (real time): accepted although the server clock is elsewhere.
    expect(ack(await sendWebhook(app, paymentEvent(order, 'payment.succeeded'))).outcome).toBe(
      'APPLIED',
    );
  });

  it('answers 400 validation-error for a correctly signed body that isn’t an event', async () => {
    const res = await sendWebhook(app, JSON.stringify({ id: 'evt_x', type: 'payment.refunded' }));
    expectProblem(res, 400, PROBLEM_TYPES.VALIDATION_ERROR);
  });
});

describe('payment.succeeded', () => {
  it('moves the order to PROCESSING, takes its tickets off the hold and enqueues the job', async () => {
    const { client, order, holdId, unitIds } = await pendingOrder();
    const event = paymentEvent(order, 'payment.succeeded');

    expect(ack(await sendWebhook(app, event))).toEqual({
      eventId: event.id,
      outcome: 'APPLIED',
      duplicate: false,
    });

    expect(await getOrder(client, order.id)).toMatchObject({
      status: 'PROCESSING',
      paymentUrl: null,
      refundDue: false,
      updatedAt: NOW.toISOString(),
    });
    expect(await unitStates(unitIds)).toEqual(['SOLD:-', 'SOLD:-', 'SOLD:-']);
    expect(await prisma.hold.findUnique({ where: { id: holdId } })).toBeNull();
    expect(
      await prisma.paymentEvent.findUniqueOrThrow({ where: { providerEventId: event.id } }),
    ).toMatchObject({ orderId: order.id, type: 'payment.succeeded', outcome: 'APPLIED' });

    const job = await queue.getJob(finalizeJobId(order.id));
    expect(job?.data).toEqual({ orderId: order.id });
    expect(job?.opts.delay).toBe(DELAY_MS);
  });

  it('keeps a processing order’s tickets from hold release, replacement and the sweeper', async () => {
    const { event, client, order, holdId, unitIds } = await pendingOrder();
    ack(await sendWebhook(app, paymentEvent(order, 'payment.succeeded')));

    // The hold is used up: it can't be released, and a new hold can't take the same seats.
    expect((await client.delete(`/holds/${holdId}`)).status).toBe(404);
    expectProblem(
      await client.post(`/events/${event.id}/holds`, { seats: [event.seat('A1')] }),
      409,
      PROBLEM_TYPES.TICKETS_UNAVAILABLE,
    );
    const other = await checkoutCustomer(app);
    expectProblem(
      await other.post(`/events/${event.id}/holds`, {
        ga: [{ sectionId: event.section('Floor'), quantity: 5 }],
      }),
      409,
      PROBLEM_TYPES.TICKETS_UNAVAILABLE,
    );
    // Long past the old hold's expiry.
    await clock.advanceBy(HOLD_SEC * 2000);
    await new HoldSweeperService(prisma, clock).sweep();

    expect(await unitStates(unitIds)).toEqual(['SOLD:-', 'SOLD:-', 'SOLD:-']);
    expect((await getOrder(client, order.id)).status).toBe('PROCESSING');
    expect(await processing.finalize(order.id)).toBe('CONFIRMED');
  });

  it('confirms the order when the job runs; running it again changes nothing', async () => {
    const { client, order, unitIds } = await pendingOrder();
    ack(await sendWebhook(app, paymentEvent(order, 'payment.succeeded')));
    await clock.advanceBy(DELAY_MS);

    expect(await processing.finalize(order.id)).toBe('CONFIRMED');
    const confirmed = await getOrder(client, order.id);
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', retryAfterMs: null, refundDue: false });
    expect(await unitStates(unitIds)).toEqual(['SOLD:-', 'SOLD:-', 'SOLD:-']);

    const before = await stored(order.id);
    expect(await processing.finalize(order.id)).toBeNull();
    expect(await stored(order.id)).toEqual(before);
  });

  it('applies a duplicate webhook once, even when both deliveries arrive at the same time', async () => {
    const { order } = await pendingOrder();
    const event = paymentEvent(order, 'payment.succeeded');

    const acks = (await Promise.all([sendWebhook(app, event), sendWebhook(app, event)])).map(ack);

    expect(acks.map((a) => a.duplicate).sort()).toEqual([false, true]);
    expect(acks.map((a) => a.outcome)).toEqual(['APPLIED', 'APPLIED']);
    expect(await prisma.paymentEvent.count({ where: { orderId: order.id } })).toBe(1);
    const processingSince = (await stored(order.id)).updatedAt;

    // A later redelivery (the provider retrying) is a duplicate too.
    await clock.advanceBy(1000);
    expect(ack(await sendWebhook(app, event))).toMatchObject({ duplicate: true });
    expect((await stored(order.id)).updatedAt).toEqual(processingSince);
    expect(await processing.finalize(order.id)).toBe('CONFIRMED');
    expect(ack(await sendWebhook(app, event))).toMatchObject({ duplicate: true });
    expect((await stored(order.id)).status).toBe('CONFIRMED');
  });
});

describe('payment.failed', () => {
  it('fails the order when the job runs and releases its tickets', async () => {
    const { event, client, order, unitIds } = await pendingOrder();
    expect(ack(await sendWebhook(app, paymentEvent(order, 'payment.failed'))).outcome).toBe(
      'APPLIED',
    );
    expect((await getOrder(client, order.id)).status).toBe('PROCESSING');

    expect(await processing.finalize(order.id)).toBe('FAILED');

    expect(await getOrder(client, order.id)).toMatchObject({
      status: 'FAILED',
      retryAfterMs: null,
      refundDue: false,
    });
    expect(await unitStates(unitIds)).toEqual(['AVAILABLE:-', 'AVAILABLE:-', 'AVAILABLE:-']);
    // Someone else can buy them now.
    const other = await checkoutCustomer(app);
    await holdTickets(other, event.id, { seats: [event.seat('A1'), event.seat('A2')] });
  });
});

describe('late and out-of-order webhooks', () => {
  it('records a success that arrives after the hold expired as due a refund, and sells nothing', async () => {
    const { client, order, holdId, unitIds } = await pendingOrder();
    await clock.advanceBy(HOLD_SEC * 1000); // Expired, not swept yet.

    expect(ack(await sendWebhook(app, paymentEvent(order, 'payment.succeeded'))).outcome).toBe(
      'REFUND_DUE',
    );

    expect(await getOrder(client, order.id)).toMatchObject({ status: 'EXPIRED', refundDue: true });
    expect(await stored(order.id)).toMatchObject({ status: 'EXPIRED', holdId: null });
    expect(await prisma.hold.findUnique({ where: { id: holdId } })).toBeNull();
    expect(await unitStates(unitIds)).toEqual(['AVAILABLE:-', 'AVAILABLE:-', 'AVAILABLE:-']);
  });

  it('records a success for an order whose hold was released as due a refund', async () => {
    const { client, order, holdId } = await pendingOrder();
    expect((await client.delete(`/holds/${holdId}`)).status).toBe(204);

    expect(ack(await sendWebhook(app, paymentEvent(order, 'payment.succeeded'))).outcome).toBe(
      'REFUND_DUE',
    );
    expect(await getOrder(client, order.id)).toMatchObject({ status: 'EXPIRED', refundDue: true });
  });

  it('ignores a failure that arrives after the success', async () => {
    const { client, order } = await pendingOrder();
    ack(await sendWebhook(app, paymentEvent(order, 'payment.succeeded')));

    expect(ack(await sendWebhook(app, paymentEvent(order, 'payment.failed'))).outcome).toBe(
      'IGNORED',
    );
    expect(await processing.finalize(order.id)).toBe('CONFIRMED');
    expect(ack(await sendWebhook(app, paymentEvent(order, 'payment.failed'))).outcome).toBe(
      'IGNORED',
    );
    expect(await getOrder(client, order.id)).toMatchObject({
      status: 'CONFIRMED',
      refundDue: false,
    });
  });

  it('flags a success that arrives after the failure for a refund; the order stays failed', async () => {
    const { client, order, unitIds } = await pendingOrder();
    ack(await sendWebhook(app, paymentEvent(order, 'payment.failed')));

    // Before and after the job has failed the order.
    expect(ack(await sendWebhook(app, paymentEvent(order, 'payment.succeeded'))).outcome).toBe(
      'REFUND_DUE',
    );
    expect(await processing.finalize(order.id)).toBe('FAILED');
    expect(ack(await sendWebhook(app, paymentEvent(order, 'payment.succeeded'))).outcome).toBe(
      'REFUND_DUE',
    );

    expect(await getOrder(client, order.id)).toMatchObject({ status: 'FAILED', refundDue: true });
    expect(await unitStates(unitIds)).toEqual(['AVAILABLE:-', 'AVAILABLE:-', 'AVAILABLE:-']);
  });

  it('ignores the same payment reported again under a new event ID', async () => {
    const { client, order } = await pendingOrder();
    ack(await sendWebhook(app, paymentEvent(order, 'payment.succeeded')));

    expect(ack(await sendWebhook(app, paymentEvent(order, 'payment.succeeded'))).outcome).toBe(
      'IGNORED',
    );
    expect(await processing.finalize(order.id)).toBe('CONFIRMED');
    expect((await getOrder(client, order.id)).refundDue).toBe(false);
  });

  it('does not let another session or amount pay the order', async () => {
    const { client, order } = await pendingOrder();

    const otherSession = paymentEvent(order, 'payment.succeeded', { sessionId: 'ps_other' });
    expect(ack(await sendWebhook(app, otherSession)).outcome).toBe('REFUND_DUE');
    const lessMoney = paymentEvent(order, 'payment.succeeded', { amountCents: 1 });
    expect(ack(await sendWebhook(app, lessMoney)).outcome).toBe('REFUND_DUE');

    expect(await getOrder(client, order.id)).toMatchObject({
      status: 'PENDING_PAYMENT',
      refundDue: true,
    });
    // The real payment still goes through.
    expect(ack(await sendWebhook(app, paymentEvent(order, 'payment.succeeded'))).outcome).toBe(
      'APPLIED',
    );
  });

  it('records events for unknown orders: successes as due a refund, failures as ignored', async () => {
    const unknown: WebhookOrder = {
      id: '0190a8f0-0000-7000-8000-000000000000',
      totalCents: 100,
      paymentSessionId: 'ps_unknown',
    };
    const success = paymentEvent(unknown, 'payment.succeeded');
    const failure = paymentEvent(unknown, 'payment.failed');
    const noOrderId = {
      ...success,
      id: 'evt_test_no_order',
      data: { ...success.data, metadata: {} },
    };

    expect(ack(await sendWebhook(app, success)).outcome).toBe('REFUND_DUE');
    expect(ack(await sendWebhook(app, failure)).outcome).toBe('IGNORED');
    expect(ack(await sendWebhook(app, noOrderId)).outcome).toBe('REFUND_DUE');

    const recorded = await prisma.paymentEvent.findMany({
      where: { providerEventId: { in: [success.id, failure.id, noOrderId.id] } },
      select: { orderId: true },
    });
    expect(recorded).toEqual([{ orderId: null }, { orderId: null }, { orderId: null }]);
  });
});

describe('recovery', () => {
  it('re-enqueues an order that has been processing too long without a job', async () => {
    const { order } = await pendingOrder();
    ack(await sendWebhook(app, paymentEvent(order, 'payment.succeeded')));
    await queue.remove(finalizeJobId(order.id)); // As if Redis had lost it.

    await clock.advanceBy(DELAY_MS + RECOVERY_GRACE_MS - 1);
    await processing.recoverStuck();
    expect(await queue.getJob(finalizeJobId(order.id))).toBeUndefined();

    await clock.advanceBy(1);
    expect(await processing.recoverStuck()).toBeGreaterThanOrEqual(1);
    const job = await queue.getJob(finalizeJobId(order.id));
    expect(job?.opts.delay).toBe(0);
  });
});
