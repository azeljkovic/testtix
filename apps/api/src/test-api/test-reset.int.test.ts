import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { ClockService } from '../clock/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { SEED_FIXTURES } from '../seed/fixtures.js';
import { seedDatabase } from '../seed/seed.js';
import { dataHash } from '../testing/integration/data-hash.js';
import { createIntegrationApp } from '../testing/integration/integration-app.js';
import { resetState } from '../testing/integration/reset.js';
import { ResetResponseSchema } from './reset.schemas.js';

const TEST_MODE = { TESTTIX_TEST_MODE: 'true' };
const KEY = 'integration-test-key-0123';
const FREEZE_AT = '2026-11-21T10:15:00.000Z';

let app: NestFastifyApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  app = await createIntegrationApp({ env: TEST_MODE });
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());
});

afterAll(async () => {
  await app.get(ClockService).reset();
  await app.close();
});

beforeEach(async () => {
  await resetState(inject('integration'));
});

async function reset(body?: object) {
  const req = http.post('/__test/reset');
  const res = await (body === undefined ? req : req.send(body));
  expect(res.status).toBe(200);
  return ResetResponseSchema.parse(res.body);
}

/** The data hash of a plain `pnpm db:seed` for `now`, on an empty database. */
async function baselineHash(now: Date) {
  await resetState(inject('integration'));
  await seedDatabase(prisma, now);
  const hash = await dataHash(prisma);
  await resetState(inject('integration'));
  return hash;
}

describe('POST /__test/reset', () => {
  it('seeds an empty database with exactly the baseline', async () => {
    const expected = await baselineHash(new Date(FREEZE_AT));

    const body = await reset({ freezeAt: FREEZE_AT });

    expect(await dataHash(prisma)).toEqual(expected);
    expect(body.seedDay).toBe('2026-11-21');
    expect(body.rows).toMatchObject({ users: 3, venues: 4, events: 44 });
    expect(body.rows.inventoryUnits).toBe(await prisma.inventoryUnit.count());
  });

  it('restores the baseline after the data was changed', async () => {
    const expected = await baselineHash(new Date(FREEZE_AT));
    await reset({ freezeAt: FREEZE_AT });

    // Change, add and delete data, as a test run would.
    await http.post('/__test/seed/sold-out-event').expect(201);
    await prisma.event.update({
      where: { id: SEED_FIXTURES.events['flaky-tests-clinic'] },
      data: { title: 'Changed' },
    });
    await prisma.inventoryUnit.deleteMany({
      where: { eventId: SEED_FIXTURES.events['testing-in-production-safely'] },
    });
    expect(await dataHash(prisma)).not.toEqual(expected);

    await reset({ freezeAt: FREEZE_AT });

    expect(await dataHash(prisma)).toEqual(expected);
  });

  it('resets the clock to the real time when called without a body', async () => {
    await app.get(ClockService).freezeAt(new Date('2030-01-01T00:00:00Z'));

    const body = await reset();

    expect(body.clock).toMatchObject({ mode: 'real', offsetMs: 0 });
    const today = new Date().toISOString().slice(0, 10);
    expect([today, new Date(Date.now() - 60_000).toISOString().slice(0, 10)]).toContain(
      body.seedDay,
    );
    expect((await http.get('/__test/clock')).body).toMatchObject({ mode: 'real' });
  });

  it('accepts an empty JSON object like no body', async () => {
    await app.get(ClockService).advanceBy(60_000);
    expect((await reset({})).clock.mode).toBe('real');
  });

  it('freezes the clock at freezeAt and dates the seed from that day', async () => {
    const body = await reset({ freezeAt: '2027-03-10T22:00:00-05:00' });

    expect(body.clock).toEqual({
      now: '2027-03-11T03:00:00.000Z',
      mode: 'frozen',
      offsetMs: expect.any(Number) as number,
    });
    expect(body.seedDay).toBe('2027-03-11');
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: SEED_FIXTURES.events['warehouse-sessions-static-lights'] },
    });
    expect(event.startsAt).toEqual(new Date('2027-03-21T00:00:00.000Z')); // D+10 00:00
  });

  it('serializes concurrent resets and ends with exactly one baseline', async () => {
    const expected = await baselineHash(new Date(FREEZE_AT));

    const results = await Promise.all(
      Array.from({ length: 3 }, () => http.post('/__test/reset').send({ freezeAt: FREEZE_AT })),
    );

    expect(results.map((res) => res.status)).toEqual([200, 200, 200]);
    expect(await dataHash(prisma)).toEqual(expected);
  });
});

describe('POST /__test/reset with TEST_API_KEY configured', () => {
  let keyed: NestFastifyApplication;

  beforeAll(async () => {
    keyed = await createIntegrationApp({ env: { ...TEST_MODE, TEST_API_KEY: KEY } });
  });

  afterAll(async () => {
    await keyed.close();
  });

  it('answers 401 without the key and changes nothing', async () => {
    await seedDatabase(prisma, new Date(FREEZE_AT));
    await prisma.event.update({
      where: { id: SEED_FIXTURES.events['flaky-tests-clinic'] },
      data: { title: 'Changed' },
    });
    const before = await dataHash(prisma);

    const res = await request(keyed.getHttpServer()).post('/__test/reset');

    expect(res.status).toBe(401);
    expect(await dataHash(prisma)).toEqual(before);
  });

  it('resets with the key', async () => {
    const res = await request(keyed.getHttpServer())
      .post('/__test/reset')
      .set('X-Test-Key', KEY)
      .send({ freezeAt: FREEZE_AT });

    expect(res.status).toBe(200);
    expect(await prisma.event.count()).toBe(44);
  });
});
