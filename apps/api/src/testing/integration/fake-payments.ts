import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import {
  DEV_PAYMENTS_API_KEY,
  DEV_PAYMENTS_WEBHOOK_SECRET,
  type PaymentSession,
  PaymentSessionSchema,
} from '@testtix/shared';
import { GenericContainer, Wait } from 'testcontainers';
import { inject } from 'vitest';

import './targets-context.js';

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const PORT = 4000;
const IMAGE = 'testtix/fake-payments:integration-test';

export interface FakePayments {
  /** The provider's API and payment pages, as the tests reach them. */
  url: string;
  stop: () => Promise<void>;
}

/**
 * The real fake payment provider (`apps/fake-payments`) for end-to-end tests: the compose service
 * at `TEST_PAYMENTS_URL` when set (`pnpm infra:up`; its API key and webhook secret must be the
 * dev defaults), otherwise a container built from `apps/fake-payments/Dockerfile`. Its webhooks
 * reach the API under test at `http://host.docker.internal:<port>`.
 */
export async function startFakePayments(): Promise<FakePayments> {
  const { paymentsUrl } = inject('integration');
  if (paymentsUrl !== undefined) return { url: paymentsUrl, stop: () => Promise.resolve() };
  const image = await GenericContainer.fromDockerfile(repoRoot, 'apps/fake-payments/Dockerfile')
    .withCache(true)
    .build(IMAGE, { deleteOnExit: false });
  const container = await image
    .withEnvironment({
      LOG_LEVEL: 'warn',
      // The image runs with NODE_ENV=production, which requires both; the API under test uses the
      // same dev defaults.
      PAYMENTS_API_KEY: DEV_PAYMENTS_API_KEY,
      PAYMENTS_WEBHOOK_SECRET: DEV_PAYMENTS_WEBHOOK_SECRET,
      // Payment page links are not followed: tests post the form to `url` themselves.
      PUBLIC_BASE_URL: `http://localhost:${String(PORT)}`,
      DELAYED_WEBHOOK_MS: '1000',
      WEBHOOK_RETRY_BASE_MS: '200',
    })
    .withExposedPorts(PORT)
    // Docker Desktop provides the name; on Linux this maps it to the host.
    .withExtraHosts([{ host: 'host.docker.internal', ipAddress: 'host-gateway' }])
    .withWaitStrategy(Wait.forHttp('/health', PORT))
    .withStartupTimeout(30_000)
    .start();
  return {
    url: `http://${container.getHost()}:${String(container.getMappedPort(PORT))}`,
    stop: async () => {
      await container.stop();
    },
  };
}

/** Pays a session on its payment page with `cardNumber` (a test card), like a customer would. */
export async function payWithCard(
  providerUrl: string,
  sessionId: string,
  cardNumber: string,
): Promise<void> {
  const res = await fetch(`${providerUrl}/pay/${sessionId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ cardNumber, expiry: '12/39', cvc: '123', name: 'Test Buyer' }),
    redirect: 'manual',
  });
  await res.body?.cancel();
  // 303 back to the shop's return page means the card was accepted (paid or declined).
  if (res.status !== 303) throw new Error(`Paying ${sessionId} answered ${String(res.status)}`);
}

/** `GET /sessions/:id`: the session with its webhook delivery attempts. */
export async function getPaymentSession(
  providerUrl: string,
  sessionId: string,
): Promise<PaymentSession> {
  const res = await fetch(`${providerUrl}/sessions/${sessionId}`, {
    headers: { authorization: `Bearer ${DEV_PAYMENTS_API_KEY}` },
  });
  if (!res.ok) throw new Error(`GET /sessions/${sessionId} answered ${String(res.status)}`);
  return PaymentSessionSchema.parse(await res.json());
}

/** A free TCP port on this machine, for an app that must be reachable from a container. */
export async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '0.0.0.0');
  await once(server, 'listening');
  const address = server.address();
  server.close();
  await once(server, 'close');
  if (address === null || typeof address === 'string') throw new Error('No port');
  return address.port;
}
