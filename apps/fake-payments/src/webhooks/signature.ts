import { createHmac } from 'node:crypto';

import {
  PAYMENT_SIGNATURE_HEADER,
  PAYMENT_SIGNATURE_VERSION,
  PAYMENT_TIMESTAMP_HEADER,
} from '@testtix/shared';

/**
 * `v1=<hex HMAC-SHA256 of "<timestamp>.<body>">`. The scheme is described in
 * `packages/shared/src/payments.ts` and `docs/testing-guide.md`.
 */
export function webhookSignature(secret: string, timestamp: number, body: string): string {
  const hmac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `${PAYMENT_SIGNATURE_VERSION}=${hmac}`;
}

/** The signature headers of one delivery attempt sent at `now`. */
export function signatureHeaders(secret: string, body: string, now: Date): Record<string, string> {
  const timestamp = Math.floor(now.getTime() / 1000);
  return {
    [PAYMENT_TIMESTAMP_HEADER]: String(timestamp),
    [PAYMENT_SIGNATURE_HEADER]: webhookSignature(secret, timestamp, body),
  };
}
