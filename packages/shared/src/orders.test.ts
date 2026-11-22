import { describe, expect, it } from 'vitest';

import { CreateOrderRequestSchema, isFinalOrderStatus, ORDER_STATUSES } from './orders.js';

describe('isFinalOrderStatus', () => {
  it.each([
    ['PENDING_PAYMENT', false],
    ['PROCESSING', false],
    ['CONFIRMED', true],
    ['FAILED', true],
    ['EXPIRED', true],
  ] as const)('%s → %s', (status, final) => {
    expect(isFinalOrderStatus(status)).toBe(final);
  });

  it('covers every status', () => {
    expect(ORDER_STATUSES).toHaveLength(5);
  });
});

describe('CreateOrderRequestSchema', () => {
  const holdId = '01936f4e-8d2a-7c3b-9e4f-5a6b7c8d9e0f';

  it('accepts a hold ID', () => {
    expect(CreateOrderRequestSchema.parse({ holdId })).toEqual({ holdId });
  });

  it.each([{}, { holdId: 'nope' }, { holdId, extra: 1 }])('rejects %j', (body) => {
    expect(CreateOrderRequestSchema.safeParse(body).success).toBe(false);
  });
});
