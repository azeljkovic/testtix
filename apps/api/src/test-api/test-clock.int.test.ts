import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ClockService } from '../clock/clock.service.js';
import { createIntegrationApp } from '../testing/integration/integration-app.js';
import { ClockStateSchema } from './clock.schemas.js';

const TEST_MODE = { TESTTIX_TEST_MODE: 'true' };
const KEY = 'integration-test-key-0123';
const MINUTE = 60_000;
/** Allowed drift between the server's real time and the test's, for a running clock. */
const TOLERANCE_MS = 5_000;

const apps: NestFastifyApplication[] = [];

async function start(env: Record<string, string> = TEST_MODE) {
  const app = await createIntegrationApp({ env });
  apps.push(app);
  return app;
}

async function getClock(app: NestFastifyApplication) {
  const res = await request(app.getHttpServer()).get('/__test/clock');
  expect(res.status).toBe(200);
  return ClockStateSchema.parse(res.body);
}

async function setClock(app: NestFastifyApplication, body: object) {
  const res = await request(app.getHttpServer()).post('/__test/clock').send(body);
  expect(res.status).toBe(200);
  return ClockStateSchema.parse(res.body);
}

function expectNear(actualIso: string, expectedMs: number) {
  expect(Math.abs(Date.parse(actualIso) - expectedMs)).toBeLessThan(TOLERANCE_MS);
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('/__test/clock (real Redis)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await start();
    await setClock(app, { reset: true });
  });

  it('starts at the real time', async () => {
    const clock = await getClock(app);
    expect(clock).toMatchObject({ mode: 'real', offsetMs: 0 });
    expectNear(clock.now, Date.now());
  });

  it('freezes the clock, and ClockService returns the frozen time', async () => {
    const frozen = await setClock(app, { freezeAt: '2026-12-01T19:30:00+01:00' });
    expect(frozen).toMatchObject({ mode: 'frozen', now: '2026-12-01T18:30:00.000Z' });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await getClock(app)).now).toBe('2026-12-01T18:30:00.000Z');
    expect(await app.get(ClockService).now()).toEqual(new Date('2026-12-01T18:30:00.000Z'));
  });

  it('can freeze in the past', async () => {
    const clock = await setClock(app, { freezeAt: '2020-02-29T00:00:00Z' });
    expect(clock.now).toBe('2020-02-29T00:00:00.000Z');
    expect(clock.offsetMs).toBeLessThan(0);
  });

  it('advances a frozen clock, which stays frozen', async () => {
    await setClock(app, { freezeAt: '2026-12-01T10:00:00Z' });
    await setClock(app, { advanceBy: 10 * MINUTE });
    const clock = await setClock(app, { advanceBy: 1 });
    expect(clock).toMatchObject({ mode: 'frozen', now: '2026-12-01T10:10:00.001Z' });
  });

  it('advances a running clock, which keeps running', async () => {
    const before = Date.now();
    const clock = await setClock(app, { advanceBy: 15 * MINUTE });
    expect(clock).toMatchObject({ mode: 'offset', offsetMs: 15 * MINUTE });
    expectNear(clock.now, before + 15 * MINUTE);

    const again = await setClock(app, { advanceBy: 5 * MINUTE });
    expect(again.offsetMs).toBe(20 * MINUTE);
  });

  it('replaces an offset when freezing', async () => {
    await setClock(app, { advanceBy: 15 * MINUTE });
    const clock = await setClock(app, { freezeAt: '2026-12-01T10:00:00Z' });
    expect(clock).toMatchObject({ mode: 'frozen', now: '2026-12-01T10:00:00.000Z' });
  });

  it.each([
    ['a frozen', { freezeAt: '2030-01-01T00:00:00Z' }],
    ['an advanced', { advanceBy: 60 * MINUTE }],
  ])('resets %s clock to the real time', async (_label, change) => {
    await setClock(app, change);
    const clock = await setClock(app, { reset: true });
    expect(clock).toMatchObject({ mode: 'real', offsetMs: 0 });
    expectNear(clock.now, Date.now());
  });

  it('is shared by every API instance through Redis', async () => {
    const replica = await start();
    await setClock(app, { freezeAt: '2026-12-01T10:00:00Z' });
    expect((await getClock(replica)).now).toBe('2026-12-01T10:00:00.000Z');

    await setClock(replica, { advanceBy: MINUTE });
    expect((await getClock(app)).now).toBe('2026-12-01T10:01:00.000Z');
  });

  it('counts every one of many concurrent advances', async () => {
    const replica = await start();
    await setClock(app, { freezeAt: '2026-12-01T10:00:00Z' });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        setClock(i % 2 === 0 ? app : replica, { advanceBy: 1000 }),
      ),
    );
    expect((await getClock(app)).now).toBe('2026-12-01T10:00:20.000Z');
  });
});

describe('test mode off', () => {
  it('answers 404 for /__test/* and ignores clock state left in Redis', async () => {
    const testApp = await start();
    await setClock(testApp, { freezeAt: '2000-01-01T00:00:00Z' });

    const app = await start({});
    const http = request(app.getHttpServer());
    expect((await http.get('/__test/clock')).status).toBe(404);
    expect((await http.post('/__test/clock').send({ reset: true })).status).toBe(404);
    expect(Math.abs((await app.get(ClockService).now()).getTime() - Date.now())).toBeLessThan(
      TOLERANCE_MS,
    );

    await setClock(testApp, { reset: true });
  });
});

describe('with TEST_API_KEY configured', () => {
  let http: ReturnType<typeof request>;

  beforeEach(async () => {
    http = request((await start({ ...TEST_MODE, TEST_API_KEY: KEY })).getHttpServer());
  });

  it('answers 401 to POST without the key', async () => {
    const res = await http.post('/__test/clock').send({ advanceBy: MINUTE });
    expect(res.status).toBe(401);
    expect((await http.get('/__test/clock')).body).toMatchObject({ mode: 'real' });
  });

  it('answers 401 to POST with a wrong key', async () => {
    const res = await http
      .post('/__test/clock')
      .set('X-Test-Key', 'not-the-right-key-012345')
      .send({ advanceBy: MINUTE });
    expect(res.status).toBe(401);
  });

  it('accepts POST with the key', async () => {
    const res = await http.post('/__test/clock').set('X-Test-Key', KEY).send({ advanceBy: MINUTE });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mode: 'offset', offsetMs: MINUTE });
    await http.post('/__test/clock').set('X-Test-Key', KEY).send({ reset: true });
  });

  it('keeps GET open, since reading the clock affects no one', async () => {
    expect((await http.get('/__test/clock')).status).toBe(200);
  });
});
