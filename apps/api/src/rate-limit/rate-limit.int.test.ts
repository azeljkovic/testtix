import { Logger } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { LOAD_TEST_KEY_HEADER, PROBLEM_TYPES, ProblemDetailsSchema } from '@testtix/shared';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TestApiAuditEntry } from '../test-api/test-api-audit.js';
import { createTestSession, sessionClient } from '../testing/auth.js';
import { createIntegrationApp } from '../testing/integration/integration-app.js';
import { RateLimitStore } from './rate-limit.store.js';

const LOAD_TEST_KEY = 'load-test-key-for-tests';
const TEST_API_KEY = 'test-api-key-for-tests';

let app: NestFastifyApplication | undefined;

/** Boots the app with rate limits on (and test mode, for the test API) and empty counters. */
async function boot(env: Record<string, string> = {}): Promise<NestFastifyApplication> {
  app = await createIntegrationApp({
    env: { RATE_LIMIT_ENABLED: 'true', TESTTIX_TEST_MODE: 'true', ...env },
  });
  await app.get(RateLimitStore).clear();
  return app;
}

function http() {
  if (app === undefined) throw new Error('boot() first');
  return request(app.getHttpServer());
}

/** Sends `count` requests one after another and returns their statuses. */
async function statuses(count: number, send: () => request.Test): Promise<number[]> {
  const result: number[] = [];
  for (let i = 0; i < count; i++) result.push((await send()).status);
  return result;
}

function expectRateLimited(res: request.Response, windowSec: number) {
  expect(res.status).toBe(429);
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  const problem = ProblemDetailsSchema.parse(res.body);
  expect(problem.type).toBe(PROBLEM_TYPES.RATE_LIMITED);
  expect(problem.title).toBe('Too many requests');
  const retryAfter = Number(res.headers['retry-after']);
  expect(Number.isInteger(retryAfter)).toBe(true);
  expect(retryAfter).toBeGreaterThanOrEqual(1);
  expect(retryAfter).toBeLessThanOrEqual(windowSec);
  return problem;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close();
  app = undefined;
});

describe('rate limits', () => {
  it('answers 429 rate-limited with Retry-After once the default limit is used up', async () => {
    await boot({ RATE_LIMIT_DEFAULT: '3/1m' });

    expect(await statuses(3, () => http().get('/events'))).toEqual([200, 200, 200]);
    const limited = await http().get('/events');
    const problem = expectRateLimited(limited, 60);
    const retryAfter = Number(limited.headers['retry-after']);
    expect(problem.detail).toBe(
      `Too many requests for the API: the limit is 3 per minute. Try again in ${String(retryAfter)} s.`,
    );
    // One budget for every route in the group.
    expectRateLimited(await http().get('/events/some-slug'), 60);
  });

  it('counts requests before authentication, so failed ones are limited too', async () => {
    await boot({ RATE_LIMIT_DEFAULT: '2/1m' });

    expect(await statuses(3, () => http().get('/auth/me'))).toEqual([401, 401, 429]);
  });

  it('leaves health checks, metrics and webhooks out', async () => {
    await boot({ RATE_LIMIT_DEFAULT: '1/1m' });

    expect(await statuses(3, () => http().get('/health'))).toEqual([200, 200, 200]);
    expect(await statuses(3, () => http().get('/metrics'))).toEqual([200, 200, 200]);
    // An unsigned webhook is refused, but not rate limited.
    expect(await statuses(3, () => http().post('/webhooks/payments').send({}))).not.toContain(429);
    expect((await http().get('/events')).status).toBe(200);
  });

  it('starts a new window when the old one ends', async () => {
    await boot({ RATE_LIMIT_DEFAULT: '1/1s' });

    expect(await statuses(2, () => http().get('/events'))).toEqual([200, 429]);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await http().get('/events')).status).toBe(200);
  });

  it('counts each client address separately behind a trusted proxy', async () => {
    await boot({ RATE_LIMIT_DEFAULT: '1/1m', TRUST_PROXY: 'true' });
    const from = (ip: string) => http().get('/events').set('X-Forwarded-For', ip);

    expect((await from('203.0.113.1')).status).toBe(200);
    expect((await from('203.0.113.1')).status).toBe(429);
    expect((await from('203.0.113.2')).status).toBe(200);
  });

  it('ignores X-Forwarded-For when no proxy is trusted', async () => {
    await boot({ RATE_LIMIT_DEFAULT: '1/1m' });

    expect((await http().get('/events').set('X-Forwarded-For', '203.0.113.1')).status).toBe(200);
    expect((await http().get('/events').set('X-Forwarded-For', '203.0.113.2')).status).toBe(429);
  });

  it('shares one auth limit between login, register and verify-email, on top of the default', async () => {
    await boot({ RATE_LIMIT_AUTH: '2/5m' });
    const login = () =>
      http().post('/auth/login').send({ email: 'nobody@example.com', password: 'wrong password' });

    // Without a CSRF token both fail (403), but they count: the limit comes first.
    expect((await login()).status).toBe(403);
    expect((await http().post('/auth/register').send({})).status).toBe(403);
    const problem = expectRateLimited(await http().post('/auth/verify-email').send({}), 300);
    expect(problem.detail).toMatch(
      /^Too many requests for logging in, registering and verifying email addresses: the limit is 2 per 5 minutes\./,
    );
    expectRateLimited(await login(), 300);
    // Other routes still have their default budget.
    expect((await http().get('/events')).status).toBe(200);
  });

  it('gives the test API its own limit instead of the default one', async () => {
    await boot({ RATE_LIMIT_DEFAULT: '2/1m', RATE_LIMIT_TEST_API: '3/1m' });
    const clock = () => http().post('/__test/clock').send({ reset: true });

    expect(await statuses(3, clock)).toEqual([200, 200, 200]);
    const problem = expectRateLimited(await clock(), 60);
    expect(problem.detail).toMatch(
      /^Too many requests for the test API: the limit is 3 per minute/,
    );
    // The default budget is untouched by the test API calls.
    expect(await statuses(3, () => http().get('/events'))).toEqual([200, 200, 429]);
  });

  it('limits verification email resends per user', async () => {
    const booted = await boot({ RATE_LIMIT_VERIFICATION_RESEND: '2/15m' });
    const customer = async () =>
      sessionClient(
        booted,
        await createTestSession(booted, { role: 'CUSTOMER', emailVerified: false }),
      );
    const ada = await customer();
    const bob = await customer();
    const resend = (client: typeof ada) => client.post('/auth/verify-email/resend');

    expect(await statuses(2, () => resend(ada))).toEqual([204, 204]);
    const problem = expectRateLimited(await resend(ada), 900);
    expect(problem.detail).toMatch(
      /^Too many requests for sending verification emails to this account: the limit is 2 per 15 minutes\./,
    );
    // Same address, another account: its own budget.
    expect((await resend(bob)).status).toBe(204);
  });

  it('lets requests with the load test key skip every limit', async () => {
    await boot({
      LOAD_TEST_KEY,
      RATE_LIMIT_DEFAULT: '1/1m',
      RATE_LIMIT_AUTH: '1/1m',
      RATE_LIMIT_TEST_API: '1/1m',
    });
    const keyed = (test: request.Test) => test.set(LOAD_TEST_KEY_HEADER, LOAD_TEST_KEY);

    expect(await statuses(5, () => keyed(http().get('/events')))).toEqual([
      200, 200, 200, 200, 200,
    ]);
    expect(
      await statuses(3, () =>
        keyed(http().post('/auth/login').send({ email: 'x@example.com', password: 'nope nope' })),
      ),
    ).toEqual([403, 403, 403]);
    expect(
      await statuses(3, () => keyed(http().post('/__test/clock').send({ reset: true }))),
    ).toEqual([200, 200, 200]);

    // Keyed requests weren't counted; a wrong key is no key.
    expect(
      (await http().get('/events').set(LOAD_TEST_KEY_HEADER, 'wrong-key-wrong-key')).status,
    ).toBe(200);
    expect((await http().get('/events')).status).toBe(429);
  });

  it('ignores the load test key header when the server has no key', async () => {
    await boot({ RATE_LIMIT_DEFAULT: '1/1m' });

    expect(
      await statuses(2, () => http().get('/events').set(LOAD_TEST_KEY_HEADER, LOAD_TEST_KEY)),
    ).toEqual([200, 429]);
  });

  it('clears every counter on POST /__test/reset', async () => {
    await boot({ RATE_LIMIT_DEFAULT: '1/1m' });

    expect(await statuses(2, () => http().get('/events'))).toEqual([200, 429]);
    await http().post('/__test/reset').expect(200);
    expect((await http().get('/events')).status).toBe(200);
  });

  it('counts rejected requests per group on /metrics', async () => {
    await boot({ RATE_LIMIT_DEFAULT: '1/1m', RATE_LIMIT_TEST_API: '1/1m' });

    await statuses(3, () => http().get('/events'));
    await statuses(2, () => http().post('/__test/clock').send({ reset: true }));
    const { text } = await http().get('/metrics').expect(200);
    expect(text).toContain('testtix_rate_limited_requests_total{group="default"} 2');
    expect(text).toContain('testtix_rate_limited_requests_total{group="testApi"} 1');
  });

  it('lets requests through when Redis is down', async () => {
    app = await createIntegrationApp({
      env: {
        RATE_LIMIT_ENABLED: 'true',
        RATE_LIMIT_DEFAULT: '1/1m',
        REDIS_URL: 'redis://127.0.0.1:1',
      },
      waitForRedis: false,
    });

    expect(await statuses(3, () => http().get('/events'))).toEqual([200, 200, 200]);
  });

  it('is off with RATE_LIMIT_ENABLED=false', async () => {
    await boot({ RATE_LIMIT_ENABLED: 'false', RATE_LIMIT_DEFAULT: '1/1m' });

    expect(await statuses(3, () => http().get('/events'))).toEqual([200, 200, 200]);
  });
});

describe('test API audit log', () => {
  /** The audit entries among the arguments of `Logger#log` calls. */
  function auditEntries(calls: readonly (readonly unknown[])[]): TestApiAuditEntry[] {
    return calls.flatMap(([message]) => {
      const { msg, testApi } = (message ?? {}) as { msg?: string; testApi?: TestApiAuditEntry };
      return msg === 'Test API call' && testApi !== undefined ? [testApi] : [];
    });
  }

  it('writes one line per test API call, rejected ones included', async () => {
    await boot({ TEST_API_KEY, RATE_LIMIT_TEST_API: '3/1m' });
    const log = vi.spyOn(Logger.prototype, 'log');

    const ok = await http()
      .post('/__test/clock?source=audit')
      .set('X-Test-Key', TEST_API_KEY)
      .send({ reset: true })
      .expect(200);
    await http().post('/__test/clock').send({ reset: true }).expect(401);
    await http().post('/__test/seed/basic-catalogue').expect(201);
    await http().post('/__test/seed/basic-catalogue').expect(429);
    await http().get('/events').expect(200);

    const entries = auditEntries(log.mock.calls);
    expect(
      entries.map(({ method, path, status, testKeySent }) => ({
        method,
        path,
        status,
        testKeySent,
      })),
    ).toEqual([
      { method: 'POST', path: '/__test/clock', status: 200, testKeySent: true },
      { method: 'POST', path: '/__test/clock', status: 401, testKeySent: false },
      { method: 'POST', path: '/__test/seed/basic-catalogue', status: 201, testKeySent: false },
      { method: 'POST', path: '/__test/seed/basic-catalogue', status: 429, testKeySent: false },
    ]);
    expect(entries[0]?.requestId).toBe(ok.headers['x-request-id']);
    expect(entries[0]?.ip).toMatch(/127\.0\.0\.1|::1/);
    expect(entries[0]?.durationMs).toBeGreaterThanOrEqual(0);
    // The key itself is never logged.
    expect(JSON.stringify(log.mock.calls)).not.toContain(TEST_API_KEY);
  });
});
