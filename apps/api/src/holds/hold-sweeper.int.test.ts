import { setTimeout as sleep } from 'node:timers/promises';

import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';

import { ClockService } from '../clock/clock.service.js';
import { parseConfig } from '../config/config.schema.js';
import { PrismaService } from '../infra/prisma.service.js';
import { QUEUE_PREFIX } from '../jobs/jobs.module.js';
import {
  type HoldAboutToExpireResult,
  HoldAboutToExpireResultSchema,
} from '../test-api/scenarios/scenario.schemas.js';
import { createTestSession, sessionClient } from '../testing/auth.js';
import { createIntegrationApp } from '../testing/integration/integration-app.js';
import { WorkerAppModule } from '../worker-app.module.js';
import { HOLD_SWEEPER_QUEUE } from './hold-sweeper.processor.js';
import { HOLD_SWEEPER_SCHEDULER_ID } from './hold-sweeper.schedule.js';
import { HoldSweeperService } from './hold-sweeper.service.js';
import { SeatMapSchema } from './holds.schemas.js';

const INTERVAL_MS = 200;
const TEST_MODE = { TESTTIX_TEST_MODE: 'true' };
const FAST_SWEEPER = {
  HOLD_SWEEPER_ENABLED: 'true',
  HOLD_SWEEPER_INTERVAL_MS: String(INTERVAL_MS),
};

let queue: Queue;

beforeAll(() => {
  queue = new Queue(HOLD_SWEEPER_QUEUE, {
    prefix: QUEUE_PREFIX,
    connection: { url: inject('integration').redisUrl },
  });
});

afterAll(async () => {
  await queue.close();
});

/** Removes schedules and jobs left by earlier tests. Call it before booting an app. */
async function emptyQueue(): Promise<void> {
  await queue.obliterate({ force: true });
}

/** The `hold-about-to-expire` scenario: a holder with seats A1 and A2, expiring in `expiresInSec`. */
async function seedHold(
  app: NestFastifyApplication,
  expiresInSec: number,
): Promise<HoldAboutToExpireResult> {
  const res = await request(app.getHttpServer())
    .post('/__test/seed/hold-about-to-expire')
    .send({ expiresInSec })
    .expect(201);
  return HoldAboutToExpireResultSchema.parse(res.body);
}

async function holdRow(prisma: PrismaService, holdId: string) {
  return prisma.hold.findUnique({ where: { id: holdId }, select: { id: true } });
}

async function units(prisma: PrismaService, ids: string[]) {
  return prisma.inventoryUnit.findMany({
    where: { id: { in: ids } },
    orderBy: { id: 'asc' },
    select: { id: true, status: true, holdId: true },
  });
}

async function seatStatuses(app: NestFastifyApplication, eventId: string): Promise<string[]> {
  const res = await request(app.getHttpServer()).get(`/events/${eventId}/seats`).expect(200);
  const map = SeatMapSchema.parse(res.body);
  return map.sections.flatMap((section) =>
    section.type === 'SEATED'
      ? section.rows.flatMap((row) =>
          row.seats.map((seat) => `${row.label}${String(seat.number)}:${seat.status}`),
        )
      : [],
  );
}

/** Polls until `check` passes: the sweeper runs in the background, on its own schedule. */
async function eventually(check: () => Promise<void>): Promise<void> {
  await vi.waitFor(check, { timeout: 10_000, interval: 50 });
}

describe('with the hold sweeper disabled', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let clock: ClockService;

  const disabled = { ...TEST_MODE, WORKER_IN_PROCESS: 'true', HOLD_SWEEPER_ENABLED: 'false' };

  beforeAll(async () => {
    await emptyQueue();
    app = await createIntegrationApp({ env: disabled });
    prisma = app.get(PrismaService);
    clock = app.get(ClockService);
  });

  afterEach(async () => {
    await clock.reset();
  });

  afterAll(async () => {
    await app.close();
  });

  it('removes a schedule an earlier deployment left behind', async () => {
    // A cron pattern, so it doesn't enqueue a sweep right away.
    await queue.upsertJobScheduler(HOLD_SWEEPER_SCHEDULER_ID, { pattern: '0 0 1 1 *' });
    const restarted = await createIntegrationApp({ env: disabled });
    try {
      await eventually(async () => {
        expect(await queue.getJobScheduler(HOLD_SWEEPER_SCHEDULER_ID)).toBeUndefined();
      });
    } finally {
      await restarted.close();
    }
  });

  it('leaves expired holds in the database, and their seats are available anyway', async () => {
    const seeded = await seedHold(app, 60);
    const unitIds = seeded.hold.seats.map((seat) => seat.inventoryUnitId);
    const [a1] = seeded.hold.seats;
    if (a1 === undefined) throw new Error('no seat');
    expect(await seatStatuses(app, seeded.event.id)).toEqual(
      expect.arrayContaining(['A1:HELD', 'A2:HELD', 'A3:AVAILABLE']),
    );

    await clock.advanceBy(60_000);
    await sleep(INTERVAL_MS * 3);

    // Nothing cleaned the rows up...
    expect(await holdRow(prisma, seeded.hold.id)).not.toBeNull();
    expect((await units(prisma, unitIds)).map((unit) => unit.status)).toEqual(['HELD', 'HELD']);
    // ...yet the seat map and new holds treat the expired hold as gone.
    expect(await seatStatuses(app, seeded.event.id)).toEqual(
      expect.arrayContaining(['A1:AVAILABLE', 'A2:AVAILABLE']),
    );
    const other = sessionClient(app, await createTestSession(app, { role: 'CUSTOMER' }));
    const res = await other.post(`/events/${seeded.event.id}/holds`, { seats: [a1.id] });
    expect(res.status).toBe(201);
    const otherHoldId = (res.body as { id: string }).id;

    // A sweep frees only what the expired hold still has: A1 stays with its new holder.
    const result = await app.get(HoldSweeperService).sweep();
    expect(result.holds).toBeGreaterThanOrEqual(1);
    expect(await holdRow(prisma, seeded.hold.id)).toBeNull();
    expect(await holdRow(prisma, otherHoldId)).not.toBeNull();
    expect(await units(prisma, unitIds)).toEqual(
      expect.arrayContaining([
        { id: a1.inventoryUnitId, status: 'HELD', holdId: otherHoldId },
        { id: seeded.hold.seats[1]?.inventoryUnitId, status: 'AVAILABLE', holdId: null },
      ]),
    );
  });

  it('leaves unexpired holds alone', async () => {
    await clock.freezeAt(await clock.now());
    const seeded = await seedHold(app, 60);
    await clock.advanceBy(59_999);
    await app.get(HoldSweeperService).sweep();
    expect(await holdRow(prisma, seeded.hold.id)).not.toBeNull();
    expect(
      (
        await units(
          prisma,
          seeded.hold.seats.map((s) => s.inventoryUnitId),
        )
      ).map((u) => u.holdId),
    ).toEqual([seeded.hold.id, seeded.hold.id]);
  });

  it('races safely with the holder replacing an expired hold', async () => {
    for (let run = 0; run < 10; run++) {
      const seeded = await seedHold(app, 1);
      await clock.advanceBy(1000);
      const holder = sessionClient(app, seeded.holder);
      const [result, res] = await Promise.all([
        app.get(HoldSweeperService).sweep(),
        holder.post(`/events/${seeded.event.id}/holds`, {
          seats: seeded.hold.seats.map((seat) => seat.id),
        }),
      ]);
      expect(res.status).toBe(201);
      expect(result.units).toBeGreaterThanOrEqual(0);
      const replacementId = (res.body as { id: string }).id;
      expect(await holdRow(prisma, seeded.hold.id)).toBeNull();
      expect(
        await units(
          prisma,
          seeded.hold.seats.map((s) => s.inventoryUnitId),
        ),
      ).toEqual(
        seeded.hold.seats
          .map((seat) => ({ id: seat.inventoryUnitId, status: 'HELD', holdId: replacementId }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      );
    }
  });
});

describe('with the hold sweeper enabled', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    await emptyQueue();
    app = await createIntegrationApp({
      env: { ...TEST_MODE, ...FAST_SWEEPER, WORKER_IN_PROCESS: 'true' },
    });
  });

  afterAll(async () => {
    await app.get(ClockService).reset();
    await app.close();
  });

  it('schedules a sweep every HOLD_SWEEPER_INTERVAL_MS', async () => {
    await eventually(async () => {
      expect(await queue.getJobScheduler(HOLD_SWEEPER_SCHEDULER_ID)).toMatchObject({
        every: INTERVAL_MS,
      });
    });
  });

  it('cleans up a hold once it has expired (after advanceBy)', async () => {
    const prisma = app.get(PrismaService);
    const seeded = await seedHold(app, 60);
    const unitIds = seeded.hold.seats.map((seat) => seat.inventoryUnitId);
    await eventually(async () => {
      expect(await queue.getJobScheduler(HOLD_SWEEPER_SCHEDULER_ID)).toBeDefined();
    });

    // Several sweeps run; the hold hasn't expired yet.
    await sleep(INTERVAL_MS * 4);
    expect(await holdRow(prisma, seeded.hold.id)).not.toBeNull();

    await app.get(ClockService).advanceBy(60_000);
    await eventually(async () => {
      expect(await holdRow(prisma, seeded.hold.id)).toBeNull();
    });
    expect(await units(prisma, unitIds)).toEqual(
      unitIds
        .map((id) => ({ id, status: 'AVAILABLE', holdId: null }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(await seatStatuses(app, seeded.event.id)).toEqual(
      expect.arrayContaining(['A1:AVAILABLE', 'A2:AVAILABLE']),
    );
    // The one visible effect: a swept hold can no longer be released.
    await sessionClient(app, seeded.holder).delete(`/holds/${seeded.hold.id}`).expect(404);
  });
});

describe('the standalone worker (src/worker.ts)', () => {
  it('sweeps while the API runs without an in-process worker', async () => {
    const { databaseUrl, redisUrl, smtpUrl } = inject('integration');
    await emptyQueue();
    const app = await createIntegrationApp({ env: TEST_MODE });
    const worker = await NestFactory.createApplicationContext(
      WorkerAppModule.forRoot(
        parseConfig({
          NODE_ENV: 'test',
          LOG_LEVEL: 'silent',
          DATABASE_URL: databaseUrl,
          REDIS_URL: redisUrl,
          SMTP_URL: smtpUrl,
          // Ignored by the worker entrypoint: it always runs the jobs.
          WORKER_IN_PROCESS: 'false',
          ...TEST_MODE,
          ...FAST_SWEEPER,
        }),
      ),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment -- Nest declares its options type as a class; a literal is the documented usage.
      { logger: false },
    );
    try {
      const prisma = app.get(PrismaService);
      const seeded = await seedHold(app, 60);
      await app.get(ClockService).advanceBy(60_000);
      await eventually(async () => {
        expect(await holdRow(prisma, seeded.hold.id)).toBeNull();
      });
    } finally {
      await app.get(ClockService).reset();
      await worker.close();
      await app.close();
    }
  });
});
