import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PaymentSessionSchema, PROBLEM_TYPES } from '@testtix/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AUTH,
  createSession,
  createTestApp,
  FakeClock,
  getSession,
  SESSION_REQUEST,
} from '../testing/test-app.js';

const START = new Date('2026-11-22T12:00:00.000Z');

describe('/sessions', () => {
  let app: NestFastifyApplication;
  const clock = new FakeClock(START);

  beforeAll(async () => {
    app = await createTestApp({ clock, env: { SESSION_TTL_MINUTES: '10' } });
  });
  afterAll(() => app.close());

  it('creates an open session with a payment page URL', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: AUTH,
      payload: SESSION_REQUEST,
    });

    expect(response.statusCode).toBe(201);
    const session = PaymentSessionSchema.parse(response.json());
    expect(session).toEqual({
      id: expect.stringMatching(/^ps_[\w-]{24}$/) as string,
      status: 'OPEN',
      amountCents: 9000,
      currency: 'USD',
      description: '2 tickets for Jazz Night',
      url: `http://pay.test/pay/${session.id}`,
      returnUrl: SESSION_REQUEST.returnUrl,
      webhookUrl: SESSION_REQUEST.webhookUrl,
      metadata: { orderId: 'o1' },
      failureCode: null,
      createdAt: '2026-11-22T12:00:00.000Z',
      expiresAt: '2026-11-22T12:10:00.000Z',
      completedAt: null,
      webhookDeliveries: [],
    });
  });

  it('gives every session its own ID', async () => {
    const [a, b] = await Promise.all([createSession(app), createSession(app)]);
    expect(a.id).not.toBe(b.id);
  });

  it.each([
    ['no Authorization header', {}],
    ['a wrong key', { authorization: 'Bearer sk_test_wrong_key_123' }],
    ['another scheme', { authorization: `Basic ${AUTH.authorization.slice(7)}` }],
  ])('answers 401 with %s', async (_, headers) => {
    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers,
      payload: SESSION_REQUEST,
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.headers['content-type']).toBe('application/problem+json; charset=utf-8');
  });

  it('answers 401 on GET without the key too', async () => {
    const session = await createSession(app);
    const response = await app.inject({ method: 'GET', url: `/sessions/${session.id}` });
    expect(response.statusCode).toBe(401);
  });

  it('answers 400 with field errors for an invalid body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: AUTH,
      payload: { ...SESSION_REQUEST, amountCents: 0, returnUrl: 'javascript:alert(1)' },
    });
    expect(response.statusCode).toBe(400);
    const problem = response.json<{ type: string; errors: { path: string }[] }>();
    expect(problem.type).toBe(PROBLEM_TYPES.VALIDATION_ERROR);
    expect(problem.errors.map((error) => error.path)).toEqual(['amountCents', 'returnUrl']);
  });

  it('reads a session back', async () => {
    const created = await createSession(app);
    expect(await getSession(app, created.id)).toEqual(created);
  });

  it('answers 404 for an unknown session', async () => {
    const response = await app.inject({ method: 'GET', url: '/sessions/ps_nope', headers: AUTH });
    expect(response.statusCode).toBe(404);
  });

  it('expires an unpaid session at expiresAt', async () => {
    const session = await createSession(app);
    clock.advance(10 * 60 * 1000 - 1);
    expect((await getSession(app, session.id)).status).toBe('OPEN');
    clock.advance(1);
    expect((await getSession(app, session.id)).status).toBe('EXPIRED');
  });

  it('forgets sessions a day after they expire', async () => {
    const session = await createSession(app);
    clock.advance(10 * 60 * 1000 + 24 * 60 * 60 * 1000 + 1);
    await createSession(app); // Pruning runs when a session is created.
    const response = await app.inject({
      method: 'GET',
      url: `/sessions/${session.id}`,
      headers: AUTH,
    });
    expect(response.statusCode).toBe(404);
  });
});
