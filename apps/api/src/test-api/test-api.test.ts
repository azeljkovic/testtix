import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PROBLEM_TYPE_BLANK, PROBLEM_TYPES, ProblemDetailsSchema } from '@testtix/shared';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../testing/test-app.js';
import { MAX_ADVANCE_MS } from './clock.schemas.js';

// Requests rejected here never reach ClockService, so the faked Redis is never used.
// The clock's behaviour against real Redis is covered by `test-clock.int.test.ts`.

const KEY = 'unit-test-key-0123456789';

let app: NestFastifyApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(env: Record<string, string>) {
  app = await createTestApp({ env });
  return request(app.getHttpServer());
}

describe('test mode off', () => {
  it.each([
    ['GET', '/__test/clock'],
    ['POST', '/__test/clock'],
  ])('%s %s answers 404', async (method, path) => {
    const http = await start({});
    const res = await (method === 'GET' ? http.get(path) : http.post(path).send({ reset: true }));
    expect(res.status).toBe(404);
    expect(ProblemDetailsSchema.parse(res.body).type).toBe(PROBLEM_TYPE_BLANK);
  });

  it('stays off when only TEST_API_KEY is set', async () => {
    const http = await start({ TEST_API_KEY: KEY });
    expect((await http.get('/__test/clock').set('X-Test-Key', KEY)).status).toBe(404);
  });
});

describe('POST /__test/clock validation', () => {
  it.each([
    ['an empty body', {}],
    ['two commands', { reset: true, advanceBy: 1000 }],
    ['all three commands', { freezeAt: '2026-12-01T00:00:00Z', advanceBy: 1, reset: true }],
  ])('rejects %s', async (_label, body) => {
    const res = await (await start({ TESTTIX_TEST_MODE: 'true' })).post('/__test/clock').send(body);
    expect(res.status).toBe(400);
    const problem = ProblemDetailsSchema.parse(res.body);
    expect(problem.type).toBe(PROBLEM_TYPES.VALIDATION_ERROR);
    expect(problem.errors).toEqual([
      { path: '', code: 'custom', message: 'Send exactly one of freezeAt, advanceBy or reset' },
    ]);
  });

  it.each([
    ['freezeAt without a zone', { freezeAt: '2026-12-01T10:00:00' }, 'freezeAt'],
    ['freezeAt as a date only', { freezeAt: '2026-12-01' }, 'freezeAt'],
    ['freezeAt as a number', { freezeAt: 1_780_000_000_000 }, 'freezeAt'],
    ['advanceBy of 0', { advanceBy: 0 }, 'advanceBy'],
    ['a negative advanceBy', { advanceBy: -1000 }, 'advanceBy'],
    ['a fractional advanceBy', { advanceBy: 1.5 }, 'advanceBy'],
    ['advanceBy as a string', { advanceBy: '1000' }, 'advanceBy'],
    ['advanceBy above 366 days', { advanceBy: MAX_ADVANCE_MS + 1 }, 'advanceBy'],
    ['reset: false', { reset: false }, 'reset'],
  ])('rejects %s', async (_label, body, path) => {
    const res = await (await start({ TESTTIX_TEST_MODE: 'true' })).post('/__test/clock').send(body);
    expect(res.status).toBe(400);
    const problem = ProblemDetailsSchema.parse(res.body);
    expect(problem.type).toBe(PROBLEM_TYPES.VALIDATION_ERROR);
    expect(problem.errors.map((error) => error.path)).toEqual([path]);
  });

  it('rejects an unknown field, and says a command is missing', async () => {
    const res = await (
      await start({ TESTTIX_TEST_MODE: 'true' })
    )
      .post('/__test/clock')
      .send({ advance_by: 1000 });
    expect(res.status).toBe(400);
    expect(ProblemDetailsSchema.parse(res.body).errors.map((error) => error.code)).toEqual([
      'unrecognized_keys',
      'custom',
    ]);
  });
});

describe('X-Test-Key guard', () => {
  const env = { TESTTIX_TEST_MODE: 'true', TEST_API_KEY: KEY };

  it.each([
    ['no header', undefined],
    ['a wrong key', 'wrong-key-0123456789'],
    ['a prefix of the key', KEY.slice(0, -1)],
    ['the key in different case', KEY.toUpperCase()],
  ])('answers 401 to POST /__test/clock with %s', async (_label, key) => {
    const http = await start(env);
    const req = http.post('/__test/clock');
    if (key !== undefined) void req.set('X-Test-Key', key);
    const res = await req.send({ reset: true });

    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('TestKey realm="test-api"');
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    const problem = ProblemDetailsSchema.parse(res.body);
    expect(problem).toMatchObject({
      type: PROBLEM_TYPE_BLANK,
      title: 'Unauthorized',
      status: 401,
      detail: 'Missing or invalid X-Test-Key header.',
    });
  });

  it('checks the key before validating the body', async () => {
    const res = await (await start(env)).post('/__test/clock').send({});
    expect(res.status).toBe(401);
  });

  it('lets a request with the right key through to validation', async () => {
    const res = await (await start(env)).post('/__test/clock').set('X-Test-Key', KEY).send({});
    expect(res.status).toBe(400);
  });
});
