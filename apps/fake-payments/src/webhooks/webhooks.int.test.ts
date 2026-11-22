import { createHmac } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PaymentWebhookEventSchema } from '@testtix/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEV_WEBHOOK_SECRET } from '../config/config.schema.js';
import { createSession, createTestApp, getSession, submitCard } from '../testing/test-app.js';
import { type ReceivedWebhook, WebhookReceiver } from '../testing/webhook-receiver.js';

const CARDS = {
  success: '4242 4242 4242 4242',
  declined: '4000 0000 0000 0002',
  insufficientFunds: '4000 0000 0000 9995',
  noWebhook: '4000 0000 0000 0077',
  delayed: '4000 0000 0000 0457',
  duplicate: '4000 0000 0000 0887',
};

const DELAYED_WEBHOOK_MS = 400;
const RETRY_BASE_MS = 50;
const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 200;
/** Long enough for any webhook that was going to come with these settings to have arrived. */
const QUIET_MS = 600;

/** `list[index]`, failing the test if it is missing. */
function at<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`Expected an item at index ${index}`);
  return item;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Verifies a delivery the way a receiver must, independently of the provider's own code. */
function verify(webhook: ReceivedWebhook, secret = DEV_WEBHOOK_SECRET): boolean {
  const timestamp = webhook.headers['x-payments-timestamp'];
  const signature = webhook.headers['x-payments-signature'];
  const expected = createHmac('sha256', secret).update(`${String(timestamp)}.${webhook.body}`);
  return signature === `v1=${expected.digest('hex')}`;
}

describe('webhooks', () => {
  let app: NestFastifyApplication;
  let receiver: WebhookReceiver;

  beforeAll(async () => {
    receiver = await WebhookReceiver.start();
    app = await createTestApp({
      env: {
        DELAYED_WEBHOOK_MS: String(DELAYED_WEBHOOK_MS),
        WEBHOOK_RETRY_BASE_MS: String(RETRY_BASE_MS),
        WEBHOOK_MAX_ATTEMPTS: String(MAX_ATTEMPTS),
        WEBHOOK_TIMEOUT_MS: String(TIMEOUT_MS),
      },
    });
  });
  afterEach(() => {
    receiver.reset();
  });
  afterAll(async () => {
    await app.close();
    await receiver.close();
  });

  async function pay(cardNumber: string) {
    const session = await createSession(app, { webhookUrl: receiver.url });
    const response = await submitCard(app, session.id, { cardNumber });
    expect(response.statusCode).toBe(303);
    return { session, paidAt: Date.now() };
  }

  async function waitForWebhooks(count: number) {
    await vi.waitFor(() => {
      expect(receiver.received).toHaveLength(count);
    });
    return receiver.received;
  }

  it('sends one signed payment.succeeded event for the success card', async () => {
    const { session } = await pay(CARDS.success);
    const webhook = at(await waitForWebhooks(1), 0);

    expect(webhook.headers['content-type']).toBe('application/json');
    expect(webhook.headers['x-payments-attempt']).toBe('1');
    expect(verify(webhook)).toBe(true);
    expect(verify(webhook, 'whsec_some_other_secret')).toBe(false);
    const timestamp = Number(webhook.headers['x-payments-timestamp']);
    expect(Math.abs(timestamp - Date.now() / 1000)).toBeLessThan(5);

    const event = PaymentWebhookEventSchema.parse(JSON.parse(webhook.body));
    expect(event).toEqual({
      id: expect.stringMatching(/^evt_/) as string,
      type: 'payment.succeeded',
      createdAt: expect.any(String) as string,
      data: {
        sessionId: session.id,
        status: 'SUCCEEDED',
        amountCents: 9000,
        currency: 'USD',
        failureCode: null,
        metadata: { orderId: 'o1' },
      },
    });

    await sleep(QUIET_MS);
    expect(receiver.received).toHaveLength(1);
    const after = await getSession(app, session.id);
    expect(after.status).toBe('SUCCEEDED');
    expect(after.webhookDeliveries).toEqual([
      {
        eventId: event.id,
        attempt: 1,
        sentAt: expect.any(String) as string,
        statusCode: 200,
        error: null,
      },
    ]);
  });

  it.each([
    ['declined', CARDS.declined, 'CARD_DECLINED', 'Your card was declined.'],
    [
      'insufficient funds',
      CARDS.insufficientFunds,
      'INSUFFICIENT_FUNDS',
      'Your card has insufficient funds.',
    ],
  ])('sends payment.failed for the %s card', async (_, card, failureCode, pageText) => {
    const { session } = await pay(card);
    const webhook = at(await waitForWebhooks(1), 0);

    expect(verify(webhook)).toBe(true);
    const event = PaymentWebhookEventSchema.parse(JSON.parse(webhook.body));
    expect(event.type).toBe('payment.failed');
    expect(event.data).toMatchObject({ sessionId: session.id, status: 'FAILED', failureCode });
    expect(await getSession(app, session.id)).toMatchObject({ status: 'FAILED', failureCode });

    const page = await app.inject({ method: 'GET', url: `/pay/${session.id}` });
    expect(page.body).toContain('<h1>Payment failed</h1>');
    expect(page.body).toContain(pageText);
  });

  it('never sends a webhook for the no-webhook card, though the payment succeeds', async () => {
    const { session } = await pay(CARDS.noWebhook);
    await sleep(QUIET_MS);
    expect(receiver.received).toHaveLength(0);
    expect(await getSession(app, session.id)).toMatchObject({
      status: 'SUCCEEDED',
      webhookDeliveries: [],
    });
  });

  it('sends the delayed card’s webhook after DELAYED_WEBHOOK_MS', async () => {
    const { paidAt } = await pay(CARDS.delayed);
    await sleep(DELAYED_WEBHOOK_MS / 2);
    expect(receiver.received).toHaveLength(0);

    const webhook = at(await waitForWebhooks(1), 0);
    expect(webhook.receivedAt - paidAt).toBeGreaterThanOrEqual(DELAYED_WEBHOOK_MS - 10);
    expect(verify(webhook)).toBe(true);
  });

  it('delivers the duplicate card’s event twice with the same ID', async () => {
    const { session } = await pay(CARDS.duplicate);
    const webhooks = await waitForWebhooks(2);

    const events = webhooks.map((webhook) =>
      PaymentWebhookEventSchema.parse(JSON.parse(webhook.body)),
    );
    expect(events[0]).toEqual(events[1]);
    expect(webhooks.every((webhook) => verify(webhook))).toBe(true);

    await sleep(QUIET_MS);
    expect(receiver.received).toHaveLength(2);
    expect((await getSession(app, session.id)).webhookDeliveries).toHaveLength(2);
  });

  it('retries a failed delivery with backoff and a fresh signature each time', async () => {
    receiver.respond = (n) => [500, 503][n - 1] ?? 200;
    const { session } = await pay(CARDS.success);
    const webhooks = await waitForWebhooks(3);

    expect(webhooks.map((webhook) => webhook.headers['x-payments-attempt'])).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(webhooks.every((webhook) => verify(webhook))).toBe(true);
    expect(new Set(webhooks.map((webhook) => webhook.body)).size).toBe(1);
    const times = webhooks.map((webhook) => webhook.receivedAt);
    expect(at(times, 1) - at(times, 0)).toBeGreaterThanOrEqual(RETRY_BASE_MS - 10);
    expect(at(times, 2) - at(times, 1)).toBeGreaterThanOrEqual(2 * RETRY_BASE_MS - 10);

    await vi.waitFor(async () => {
      const deliveries = (await getSession(app, session.id)).webhookDeliveries;
      expect(deliveries.map((delivery) => delivery.statusCode)).toEqual([500, 503, 200]);
    });
  });

  it('gives up after WEBHOOK_MAX_ATTEMPTS', async () => {
    receiver.respond = () => 500;
    await pay(CARDS.success);
    await waitForWebhooks(MAX_ATTEMPTS);
    await sleep(QUIET_MS);
    expect(receiver.received).toHaveLength(MAX_ATTEMPTS);
  });

  it('retries when the receiver does not answer in time', async () => {
    receiver.respond = (n) => (n === 1 ? 'hang' : 204);
    const { session } = await pay(CARDS.success);
    await waitForWebhooks(2);

    await vi.waitFor(async () => {
      expect((await getSession(app, session.id)).webhookDeliveries).toMatchObject([
        { attempt: 1, statusCode: null, error: `No response within ${TIMEOUT_MS} ms` },
        { attempt: 2, statusCode: 204, error: null },
      ]);
    });
  });

  it('records a connection error and retries', async () => {
    const closed = await WebhookReceiver.start();
    const unreachable = closed.url;
    await closed.close();
    const session = await createSession(app, { webhookUrl: unreachable });
    await submitCard(app, session.id, { cardNumber: CARDS.success });

    await vi.waitFor(async () => {
      const deliveries = (await getSession(app, session.id)).webhookDeliveries;
      expect(deliveries).toHaveLength(MAX_ATTEMPTS);
      expect(deliveries[0]).toMatchObject({ statusCode: null, error: 'ECONNREFUSED' });
    });
  });
});
