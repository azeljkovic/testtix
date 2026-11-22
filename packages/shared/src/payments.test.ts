import { describe, expect, it } from 'vitest';

import { CreatePaymentSessionRequestSchema, PaymentWebhookEventSchema } from './payments.js';

const VALID = {
  amountCents: 9000,
  currency: 'USD',
  description: '2 tickets for Jazz Night',
  returnUrl: 'http://localhost:5173/orders/1/return',
  webhookUrl: 'http://host.docker.internal:3000/webhooks/payments',
};

describe('CreatePaymentSessionRequestSchema', () => {
  it('accepts a valid request and defaults metadata to empty', () => {
    expect(CreatePaymentSessionRequestSchema.parse(VALID)).toEqual({ ...VALID, metadata: {} });
  });

  it.each([
    ['a zero amount', { amountCents: 0 }],
    ['a fractional amount', { amountCents: 10.5 }],
    ['another currency', { currency: 'EUR' }],
    ['a blank description', { description: '  ' }],
    ['a non-http return URL', { returnUrl: 'javascript:alert(1)' }],
    ['a non-http webhook URL', { webhookUrl: 'ftp://example.test/hook' }],
    ['a non-string metadata value', { metadata: { orderId: 1 } }],
    [
      'more than 20 metadata keys',
      { metadata: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 'v'])) },
    ],
  ])('rejects %s', (_, override) => {
    expect(CreatePaymentSessionRequestSchema.safeParse({ ...VALID, ...override }).success).toBe(
      false,
    );
  });
});

describe('PaymentWebhookEventSchema', () => {
  it('accepts a failed payment event', () => {
    const event = {
      id: 'evt_1',
      type: 'payment.failed',
      createdAt: '2026-11-22T10:00:00.000Z',
      data: {
        sessionId: 'ps_1',
        status: 'FAILED',
        amountCents: 9000,
        currency: 'USD',
        failureCode: 'CARD_DECLINED',
        metadata: { orderId: 'o1' },
      },
    };
    expect(PaymentWebhookEventSchema.parse(event)).toEqual(event);
  });
});
