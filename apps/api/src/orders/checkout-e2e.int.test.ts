import { setTimeout as sleep } from 'node:timers/promises';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { isFinalOrderStatus } from '@testtix/shared';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { ClockService } from '../clock/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { QUEUE_PREFIX } from '../jobs/jobs.module.js';
import type { SessionClient } from '../testing/auth.js';
import {
  checkout,
  checkoutCustomer,
  holdTickets,
  insertCheckoutEvent,
  parseOrder,
} from '../testing/integration/checkout.js';
import {
  type FakePayments,
  freePort,
  getPaymentSession,
  payWithCard,
  startFakePayments,
} from '../testing/integration/fake-payments.js';
import { createIntegrationApp } from '../testing/integration/integration-app.js';
import { ORDER_PROCESSING_QUEUE } from './order-jobs.js';
import type { Order } from './orders.schemas.js';

/**
 * Checkout end to end (C4.3): the API with its worker running, the real fake payment provider in a
 * container, real webhooks between them. Test cards from `apps/fake-payments/src/cards/`.
 */
const CARDS = {
  success: '4242424242424242',
  declined: '4000000000000002',
  duplicateWebhook: '4000000000000887',
} as const;

let app: NestFastifyApplication;
let prisma: PrismaService;
let provider: FakePayments;
let queue: Queue;

beforeAll(async () => {
  queue = new Queue(ORDER_PROCESSING_QUEUE, {
    prefix: QUEUE_PREFIX,
    connection: { url: inject('integration').redisUrl },
  });
  await queue.obliterate({ force: true });
  provider = await startFakePayments();
  const port = await freePort();
  app = await createIntegrationApp({
    env: {
      TESTTIX_TEST_MODE: 'true',
      WORKER_IN_PROCESS: 'true',
      HOLD_SWEEPER_ENABLED: 'false',
      PORT: String(port),
      PAYMENTS_BASE_URL: provider.url,
      PAYMENTS_WEBHOOK_URL: `http://host.docker.internal:${String(port)}/webhooks/payments`,
      JOB_PROCESSING_DELAY_MS: '200',
      ORDER_POLL_INTERVAL_MS: '100',
    },
  });
  // Reachable from the provider's container, not only from this process.
  await app.listen(port, '0.0.0.0');
  prisma = app.get(PrismaService);
  // The real clock: the provider and the worker run on real time.
  await app.get(ClockService).reset();
}, 300_000);

afterAll(async () => {
  await app.close();
  await provider.stop();
  await queue.close();
});

/** Holds seat A1 and two Floor places of a new event and checks them out. */
async function startCheckout() {
  const now = await app.get(ClockService).now();
  const event = await insertCheckoutEvent(app, { now, holdDurationSec: 600 });
  const client = await checkoutCustomer(app);
  const hold = await holdTickets(client, event.id, {
    seats: [event.seat('A1')],
    ga: [{ sectionId: event.section('Floor'), quantity: 2 }],
  });
  const order = parseOrder(await checkout(client, hold.id), 201);
  const { paymentSessionId } = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    select: { paymentSessionId: true },
  });
  if (paymentSessionId === null) throw new Error('no payment session');
  const unitIds = hold.items.map((item) => item.inventoryUnitId);
  return { event, client, order, sessionId: paymentSessionId, unitIds };
}

/** Polls the order like the web app does (`retryAfterMs`) until its status is final. */
async function pollUntilFinal(client: SessionClient, orderId: string): Promise<Order[]> {
  const seen: Order[] = [];
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const order = parseOrder(await client.get(`/orders/${orderId}`), 200);
    seen.push(order);
    if (isFinalOrderStatus(order.status)) return seen;
    await sleep(order.retryAfterMs ?? 100);
  }
  throw new Error(`Order ${orderId} did not finish: ${seen.at(-1)?.status ?? 'never read'}`);
}

async function unitStatuses(unitIds: string[]): Promise<string[]> {
  const units = await prisma.inventoryUnit.findMany({
    where: { id: { in: unitIds } },
    select: { status: true },
  });
  return units.map((unit) => unit.status);
}

describe('checkout with the real payment provider', () => {
  it('confirms the order after a successful payment, through processing', async () => {
    const { client, order, sessionId, unitIds } = await startCheckout();
    expect(order.paymentUrl).toContain(`/pay/${sessionId}`);

    await payWithCard(provider.url, sessionId, CARDS.success);
    const seen = await pollUntilFinal(client, order.id);

    expect(seen.at(-1)).toMatchObject({ status: 'CONFIRMED', refundDue: false });
    const statuses = [...new Set(seen.map((o) => o.status))];
    expect(statuses.at(-1)).toBe('CONFIRMED');
    expect(statuses.every((s) => ['PENDING_PAYMENT', 'PROCESSING', 'CONFIRMED'].includes(s))).toBe(
      true,
    );
    expect(await unitStatuses(unitIds)).toEqual(['SOLD', 'SOLD', 'SOLD']);
    const session = await getPaymentSession(provider.url, sessionId);
    expect(session.webhookDeliveries.map((d) => d.statusCode)).toEqual([200]);
  });

  it('fails the order and releases the tickets after a declined payment', async () => {
    const { client, order, sessionId, unitIds } = await startCheckout();

    await payWithCard(provider.url, sessionId, CARDS.declined);
    const seen = await pollUntilFinal(client, order.id);

    expect(seen.at(-1)).toMatchObject({ status: 'FAILED', refundDue: false });
    expect(await unitStatuses(unitIds)).toEqual(['AVAILABLE', 'AVAILABLE', 'AVAILABLE']);
  });

  it('confirms the order once when the provider delivers the webhook twice', async () => {
    const { client, order, sessionId } = await startCheckout();

    await payWithCard(provider.url, sessionId, CARDS.duplicateWebhook);
    const seen = await pollUntilFinal(client, order.id);

    expect(seen.at(-1)?.status).toBe('CONFIRMED');
    // Both deliveries were accepted; one event was recorded.
    const deadline = Date.now() + 5000;
    let session = await getPaymentSession(provider.url, sessionId);
    while (session.webhookDeliveries.length < 2 && Date.now() < deadline) {
      await sleep(100);
      session = await getPaymentSession(provider.url, sessionId);
    }
    expect(session.webhookDeliveries.map((d) => d.statusCode)).toEqual([200, 200]);
    expect(await prisma.paymentEvent.count({ where: { orderId: order.id } })).toBe(1);
  });
});
