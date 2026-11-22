import { describe, expect, it } from 'vitest';

import { effectiveStatus, retryAfterMs } from './order-views.js';

const NOW = new Date('2027-03-01T12:00:00.000Z');
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

describe('effectiveStatus', () => {
  it('expires an unpaid order at its expiresAt', () => {
    expect(effectiveStatus({ status: 'PENDING_PAYMENT', expiresAt: at(1) }, NOW)).toBe(
      'PENDING_PAYMENT',
    );
    expect(effectiveStatus({ status: 'PENDING_PAYMENT', expiresAt: at(0) }, NOW)).toBe('EXPIRED');
    expect(effectiveStatus({ status: 'PENDING_PAYMENT', expiresAt: at(-1) }, NOW)).toBe('EXPIRED');
  });

  it.each(['PROCESSING', 'CONFIRMED', 'FAILED', 'EXPIRED'] as const)(
    'keeps %s past expiresAt',
    (status) => {
      expect(effectiveStatus({ status, expiresAt: at(-60_000) }, NOW)).toBe(status);
    },
  );
});

describe('retryAfterMs', () => {
  it('is the poll interval while unpaid, but never past expiresAt', () => {
    expect(retryAfterMs('PENDING_PAYMENT', at(600_000), NOW, 2000)).toBe(2000);
    expect(retryAfterMs('PENDING_PAYMENT', at(500), NOW, 2000)).toBe(500);
    expect(retryAfterMs('PENDING_PAYMENT', at(0), NOW, 2000)).toBe(1);
  });

  it('is the poll interval while processing', () => {
    expect(retryAfterMs('PROCESSING', at(-1000), NOW, 2000)).toBe(2000);
  });

  it.each(['CONFIRMED', 'FAILED', 'EXPIRED'] as const)('is null once %s', (status) => {
    expect(retryAfterMs(status, at(600_000), NOW, 2000)).toBeNull();
  });
});
