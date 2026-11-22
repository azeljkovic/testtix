import { DEV_PAYMENTS_API_KEY } from '@testtix/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { parseConfig } from '../config/config.schema.js';
import {
  type PaymentProviderStub,
  startPaymentProviderStub,
} from '../testing/payment-provider-stub.js';
import { PaymentProviderError, PaymentsClient } from './payments.client.js';

let stub: PaymentProviderStub;
let client: PaymentsClient;

const REQUEST = {
  amountCents: 8900,
  currency: 'USD',
  description: '1 ticket for Jazz Night',
  returnUrl: 'http://localhost:5173/orders/abc',
  webhookUrl: 'http://localhost:3000/webhooks/payments',
  metadata: { orderId: 'abc' },
} as const;

beforeAll(async () => {
  stub = await startPaymentProviderStub();
  client = new PaymentsClient(
    parseConfig({ PAYMENTS_BASE_URL: `${stub.url}/`, PAYMENTS_TIMEOUT_MS: '200' }),
  );
});

afterAll(async () => {
  await stub.close();
});

beforeEach(() => {
  stub.behaviour = 'ok';
  stub.requests.length = 0;
});

describe('PaymentsClient.createSession', () => {
  it('posts the request with the API key and returns the session', async () => {
    const session = await client.createSession(REQUEST);

    expect(session).toMatchObject({ status: 'OPEN', amountCents: 8900 });
    expect(session.url).toBe(`${stub.url}/pay/${session.id}`);
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]).toMatchObject({
      method: 'POST',
      path: '/sessions',
      headers: {
        authorization: `Bearer ${DEV_PAYMENTS_API_KEY}`,
        'content-type': 'application/json',
      },
      body: REQUEST,
    });
  });

  it.each([
    ['an error status', 'error', /answered 503/],
    ['a body that is not a session', 'garbage', /unexpected body/],
    ['no answer in time', 'hang', /POST \/sessions failed/],
  ] as const)('throws PaymentProviderError for %s', async (_, behaviour, message) => {
    stub.behaviour = behaviour;
    const error = await client.createSession(REQUEST).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(PaymentProviderError);
    expect((error as Error).message).toMatch(message);
  });

  it('throws PaymentProviderError when the provider is unreachable', async () => {
    const offline = new PaymentsClient(parseConfig({ PAYMENTS_BASE_URL: 'http://127.0.0.1:1' }));
    await expect(offline.createSession(REQUEST)).rejects.toBeInstanceOf(PaymentProviderError);
  });
});
