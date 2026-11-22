import type { OutgoingHttpHeaders } from 'node:http';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { CreatePaymentSessionRequest, PaymentSession } from '@testtix/shared';

import { AppModule } from '../app.module.js';
import { configureApp, createHttpAdapter } from '../app.setup.js';
import { DEV_API_KEY, parseConfig } from '../config/config.schema.js';
import { type Clock, CLOCK } from '../infra/clock.js';

/** A clock tests move by hand. Starts at the real time unless given a start. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date = new Date()) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export interface TestAppOptions {
  env?: Record<string, string>;
  /** Defaults to the real clock. */
  clock?: Clock;
}

/** Boots the real app (same modules and `configureApp` as `main.ts`) without listening on a port. */
export async function createTestApp(options: TestAppOptions = {}): Promise<NestFastifyApplication> {
  const config = parseConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    PUBLIC_BASE_URL: 'http://pay.test',
    ...options.env,
  });
  let builder = Test.createTestingModule({ imports: [AppModule.forRoot(config)] });
  if (options.clock) builder = builder.overrideProvider(CLOCK).useValue(options.clock);
  const app = (await builder.compile()).createNestApplication<NestFastifyApplication>(
    createHttpAdapter(),
  );
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

export const AUTH = { authorization: `Bearer ${DEV_API_KEY}` };

export const SESSION_REQUEST = {
  amountCents: 9000,
  currency: 'USD',
  description: '2 tickets for Jazz Night',
  returnUrl: 'http://shop.test/orders/o1/return?from=pay',
  webhookUrl: 'http://127.0.0.1:9/never-called',
  metadata: { orderId: 'o1' },
} satisfies CreatePaymentSessionRequest;

export async function createSession(
  app: NestFastifyApplication,
  overrides: Partial<CreatePaymentSessionRequest> = {},
): Promise<PaymentSession> {
  const response = await app.inject({
    method: 'POST',
    url: '/sessions',
    headers: AUTH,
    payload: { ...SESSION_REQUEST, ...overrides },
  });
  if (response.statusCode !== 201) {
    throw new Error(`POST /sessions answered ${response.statusCode}: ${response.body}`);
  }
  return response.json<PaymentSession>();
}

export async function getSession(app: NestFastifyApplication, id: string): Promise<PaymentSession> {
  const response = await app.inject({ method: 'GET', url: `/sessions/${id}`, headers: AUTH });
  return response.json<PaymentSession>();
}

export interface CardInput {
  cardNumber: string;
  expiry?: string;
  cvc?: string;
  name?: string;
}

/** What tests read from an injected response (`app.inject()` names a type we can't import). */
export interface PageResponse {
  statusCode: number;
  headers: OutgoingHttpHeaders;
  body: string;
}

/** Submits the payment page form, as a browser does. */
export function submitCard(
  app: NestFastifyApplication,
  sessionId: string,
  card: CardInput,
): Promise<PageResponse> {
  const form = new URLSearchParams({
    expiry: '12/99',
    cvc: '123',
    name: 'Ada Lovelace',
    ...card,
  });
  return app.inject({
    method: 'POST',
    url: `/pay/${sessionId}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: form.toString(),
  });
}
