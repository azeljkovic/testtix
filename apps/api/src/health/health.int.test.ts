import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { createIntegrationApp } from '../testing/integration/integration-app.js';

// Nothing listens on port 1, so connections are refused straight away.
const UNREACHABLE = {
  DATABASE_URL: 'postgresql://testtix:testtix@127.0.0.1:1/testtix_test',
  REDIS_URL: 'redis://127.0.0.1:1',
};

let app: NestFastifyApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /health/ready (real Postgres and Redis)', () => {
  it('returns 200 when both are reachable', async () => {
    app = await createIntegrationApp();
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { database: { status: 'up' }, redis: { status: 'up' } },
    });
  });

  it.each([
    [
      'Postgres',
      { env: { DATABASE_URL: UNREACHABLE.DATABASE_URL } },
      { database: 'down', redis: 'up' },
    ],
    [
      'Redis',
      { env: { REDIS_URL: UNREACHABLE.REDIS_URL }, waitForRedis: false },
      { database: 'up', redis: 'down' },
    ],
  ])('returns 503 when %s is unreachable', async (_label, options, expected) => {
    app = await createIntegrationApp(options);
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: 'error',
      checks: { database: { status: expected.database }, redis: { status: expected.redis } },
    });
  });
});
