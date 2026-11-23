import { randomBytes } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  DEV_PAYMENTS_WEBHOOK_SECRET,
  PAYMENT_SIGNATURE_HEADER,
  PAYMENT_TIMESTAMP_HEADER,
  type PaymentEventType,
  type PaymentWebhookEvent,
} from '@testtix/shared';
import request from 'supertest';

import { signWebhook } from '../payments/webhook-signature.js';

export interface WebhookOrder {
  id: string;
  totalCents: number;
  paymentSessionId: string | null;
}

/** A provider event for `order`'s payment session, with a new event ID unless `id` is given. */
export function paymentEvent(
  order: WebhookOrder,
  type: PaymentEventType,
  overrides: { id?: string; sessionId?: string; amountCents?: number } = {},
): PaymentWebhookEvent {
  const failed = type === 'payment.failed';
  return {
    id: overrides.id ?? `evt_test_${randomBytes(8).toString('hex')}`,
    type,
    createdAt: new Date().toISOString(),
    data: {
      sessionId: overrides.sessionId ?? order.paymentSessionId ?? 'ps_none',
      status: failed ? 'FAILED' : 'SUCCEEDED',
      amountCents: overrides.amountCents ?? order.totalCents,
      currency: 'USD',
      failureCode: failed ? 'CARD_DECLINED' : null,
      metadata: { orderId: order.id },
    },
  };
}

export interface SendWebhookOptions {
  /** Default: the dev secret, which the API uses unless `PAYMENTS_WEBHOOK_SECRET` is set. */
  secret?: string;
  /** When the signature was made. Default: the real time. */
  signedAt?: Date;
  /** Replaces the signature headers (e.g. `{}` to send none). */
  headers?: Record<string, string>;
}

/** POSTs `body` (an event, or raw JSON text) to `/webhooks/payments`, signed like the provider. */
export function sendWebhook(
  app: NestFastifyApplication,
  body: PaymentWebhookEvent | string,
  options: SendWebhookOptions = {},
): request.Test {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const { timestamp, signature } = signWebhook(
    options.secret ?? DEV_PAYMENTS_WEBHOOK_SECRET,
    text,
    options.signedAt ?? new Date(),
  );
  const headers = options.headers ?? {
    [PAYMENT_TIMESTAMP_HEADER]: timestamp,
    [PAYMENT_SIGNATURE_HEADER]: signature,
  };
  return request(app.getHttpServer())
    .post('/webhooks/payments')
    .set('content-type', 'application/json')
    .set(headers)
    .send(text);
}
