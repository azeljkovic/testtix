import { describe, expect, it } from 'vitest';

import { signatureHeaders, webhookSignature } from './signature.js';

const SECRET = 'whsec_testtix_local_only';
const BODY = '{"id":"evt_1"}';

describe('webhookSignature', () => {
  it('matches a vector computed with openssl (documented in docs/testing-guide.md)', () => {
    // printf '%s' '1795000000.{"id":"evt_1"}' | openssl dgst -sha256 -hmac 'whsec_testtix_local_only'
    expect(webhookSignature(SECRET, 1_795_000_000, BODY)).toBe(
      'v1=4e45a225d44ef0629890f9f07196d76d0d3199c5e0f4ee719ee5cf966c250460',
    );
  });

  it('changes with the secret, the timestamp and the body', () => {
    const base = webhookSignature(SECRET, 1_795_000_000, BODY);
    expect(webhookSignature('another_secret_value', 1_795_000_000, BODY)).not.toBe(base);
    expect(webhookSignature(SECRET, 1_795_000_001, BODY)).not.toBe(base);
    expect(webhookSignature(SECRET, 1_795_000_000, '{"id":"evt_2"}')).not.toBe(base);
  });
});

describe('signatureHeaders', () => {
  it('uses whole Unix seconds for the timestamp header and signs with it', () => {
    const headers = signatureHeaders(SECRET, BODY, new Date(1_795_000_000_999));
    expect(headers).toEqual({
      'X-Payments-Timestamp': '1795000000',
      'X-Payments-Signature': webhookSignature(SECRET, 1_795_000_000, BODY),
    });
  });
});
