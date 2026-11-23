import { createHmac } from 'node:crypto';

import { PAYMENT_SIGNATURE_VERSION } from '@testtix/shared';

import { safeEqual } from '../infra/safe-equal.js';

export interface SignedWebhook {
  /** The raw request body, exactly as received. */
  body: Buffer;
  /** `X-Payments-Timestamp`: Unix seconds. */
  timestamp: string | undefined;
  /** `X-Payments-Signature`: `v1=<hex HMAC-SHA256 of "<timestamp>.<body>">`. */
  signature: string | undefined;
}

export type SignatureCheck =
  { ok: true } | { ok: false; reason: 'missing' | 'malformed' | 'stale' | 'mismatch' };

/** Unix seconds: digits only, so `1e9`, `-5` or `12.5` are malformed, not "close enough". */
const TIMESTAMP = /^\d{1,12}$/;
const SIGNATURE = new RegExp(`^${PAYMENT_SIGNATURE_VERSION}=([0-9a-f]{64})$`);

/**
 * Checks a webhook's signature (scheme in `packages/shared/src/payments.ts`): the HMAC-SHA256 of
 * `<timestamp>.<raw body>` keyed with `secret`, compared in constant time, and a timestamp no
 * further than `toleranceMs` from `now` in either direction (replay window). `now` is the real
 * time: the provider stamps its own real clock.
 */
export function checkWebhookSignature(
  webhook: SignedWebhook,
  secret: string,
  now: Date,
  toleranceMs: number,
): SignatureCheck {
  const { timestamp, signature, body } = webhook;
  if (timestamp === undefined || signature === undefined) return { ok: false, reason: 'missing' };
  const provided = SIGNATURE.exec(signature.trim())?.[1];
  if (!TIMESTAMP.test(timestamp) || provided === undefined) {
    return { ok: false, reason: 'malformed' };
  }
  if (Math.abs(now.getTime() - Number(timestamp) * 1000) > toleranceMs) {
    return { ok: false, reason: 'stale' };
  }
  return safeEqual(provided, signatureHex(secret, timestamp, body))
    ? { ok: true }
    : { ok: false, reason: 'mismatch' };
}

function signatureHex(secret: string, timestamp: string, body: Buffer): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
}

/** Signs `body` the way the provider does. For tests and local tools that send webhooks. */
export function signWebhook(
  secret: string,
  body: string,
  at: Date,
): { timestamp: string; signature: string } {
  const timestamp = String(Math.floor(at.getTime() / 1000));
  return {
    timestamp,
    signature: `${PAYMENT_SIGNATURE_VERSION}=${signatureHex(secret, timestamp, Buffer.from(body))}`,
  };
}
