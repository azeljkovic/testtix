import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { checkWebhookSignature, type SignedWebhook, signWebhook } from './webhook-signature.js';

const SECRET = 'whsec_unit_test_secret';
const NOW = new Date('2027-03-01T12:00:00.000Z');
const TOLERANCE_MS = 300_000;
const BODY = '{"id":"evt_1","type":"payment.succeeded"}';

/** The documented scheme, computed independently of the code under test. */
function documentedSignature(secret: string, timestamp: number, body: string): string {
  return `v1=${createHmac('sha256', secret)
    .update(`${String(timestamp)}.${body}`)
    .digest('hex')}`;
}

function webhook(overrides: Partial<SignedWebhook> = {}): SignedWebhook {
  const timestamp = Math.floor(NOW.getTime() / 1000);
  return {
    body: Buffer.from(BODY),
    timestamp: String(timestamp),
    signature: documentedSignature(SECRET, timestamp, BODY),
    ...overrides,
  };
}

const check = (input: SignedWebhook, now = NOW) =>
  checkWebhookSignature(input, SECRET, now, TOLERANCE_MS);

describe('checkWebhookSignature', () => {
  it('accepts a signature made with the documented scheme', () => {
    expect(check(webhook())).toEqual({ ok: true });
  });

  it('accepts what signWebhook() produces', () => {
    const signed = signWebhook(SECRET, BODY, NOW);
    expect(check(webhook(signed))).toEqual({ ok: true });
    expect(signed.signature).toBe(
      documentedSignature(SECRET, Math.floor(NOW.getTime() / 1000), BODY),
    );
  });

  it.each([
    ['timestamp', { timestamp: undefined }],
    ['signature', { signature: undefined }],
  ])('rejects a missing %s', (_, overrides) => {
    expect(check(webhook(overrides))).toEqual({ ok: false, reason: 'missing' });
  });

  it.each([
    ['a non-numeric timestamp', { timestamp: 'yesterday' }],
    ['a negative timestamp', { timestamp: '-5' }],
    ['a fractional timestamp', { timestamp: '1.5' }],
    ['an exponent timestamp', { timestamp: '1e9' }],
    ['another signature version', { signature: `v0=${'a'.repeat(64)}` }],
    ['a short signature', { signature: 'v1=abc' }],
    ['upper-case hex', { signature: `v1=${'A'.repeat(64)}` }],
  ])('rejects %s as malformed', (_, overrides) => {
    expect(check(webhook(overrides))).toEqual({ ok: false, reason: 'malformed' });
  });

  it.each([
    ['another secret', { signature: documentedSignature('whsec_someone_else', 1, BODY) }],
    ['a changed body', { body: Buffer.from(BODY.replace('succeeded', 'failed')) }],
    ['a changed timestamp', { timestamp: String(Math.floor(NOW.getTime() / 1000) - 1) }],
  ])('rejects %s as a mismatch', (_, overrides) => {
    expect(check(webhook(overrides))).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('accepts timestamps up to the tolerance away, in both directions', () => {
    const edge = TOLERANCE_MS;
    expect(check(webhook(), new Date(NOW.getTime() + edge))).toEqual({ ok: true });
    expect(check(webhook(), new Date(NOW.getTime() - edge))).toEqual({ ok: true });
  });

  it('rejects timestamps beyond the tolerance as stale, in both directions', () => {
    const beyond = TOLERANCE_MS + 1000;
    expect(check(webhook(), new Date(NOW.getTime() + beyond))).toEqual({
      ok: false,
      reason: 'stale',
    });
    expect(check(webhook(), new Date(NOW.getTime() - beyond))).toEqual({
      ok: false,
      reason: 'stale',
    });
  });

  it('checks the raw bytes, so re-serialised JSON does not verify', () => {
    const reformatted = JSON.stringify(JSON.parse(BODY), null, 2);
    expect(check(webhook({ body: Buffer.from(reformatted) }))).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });
});
