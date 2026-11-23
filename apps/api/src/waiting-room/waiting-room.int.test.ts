import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ADMISSION_TOKEN_HEADER, PROBLEM_TYPES, ProblemDetailsSchema } from '@testtix/shared';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from 'vitest';

import { ClockService } from '../clock/clock.service.js';
import { HoldSchema } from '../holds/holds.schemas.js';
import { PrismaService } from '../infra/prisma.service.js';
import { REDIS } from '../infra/redis.module.js';
import { uuidv7 } from '../infra/uuid.js';
import { QUEUE_PREFIX } from '../jobs/jobs.module.js';
import type { DayTime } from '../seed/fixtures.js';
import { insertRows } from '../seed/seed.js';
import {
  buildScenarioCatalogue,
  newScenarioSuffix,
  newTicketCode,
  type ScenarioContext,
  scenarioVenue,
} from '../test-api/scenarios/scenario-data.js';
import { createTestSession, type SessionClient, sessionClient } from '../testing/auth.js';
import { createIntegrationApp } from '../testing/integration/integration-app.js';
import { WAITING_ROOM_QUEUE } from './queue-admission.processor.js';
import { QueueAdmissionService } from './queue-admission.service.js';
import { QUEUE_KEY_PREFIX, QueueStore } from './queue-store.js';
import { type QueueEntry, QueueEntrySchema } from './waiting-room.schemas.js';

/** Sales open at noon UTC on this day; the event is ten days later. */
const OPEN = new Date('2027-03-01T12:00:00.000Z');
const SALES_OPEN: DayTime = [0, '12:00'];
const TTL_SEC = 600;

let app: NestFastifyApplication;
let prisma: PrismaService;
let clock: ClockService;
let admission: QueueAdmissionService;

beforeAll(async () => {
  app = await createIntegrationApp({ env: { TESTTIX_TEST_MODE: 'true' } });
  prisma = app.get(PrismaService);
  clock = app.get(ClockService);
  // The worker is off, so the admission job runs only when a test calls it.
  admission = new QueueAdmissionService(prisma, clock, app.get(QueueStore, { strict: false }));
});

afterEach(async () => {
  await clock.reset();
});

afterAll(async () => {
  await app.close();
});

interface DropEvent {
  id: string;
  seatId: string;
}

/** Inserts a published event with a waiting room (unless turned off) and one released seated row. */
async function insertDropEvent(
  options: { rate?: number; waitingRoom?: boolean; status?: 'PUBLISHED' | 'DRAFT' } = {},
): Promise<DropEvent> {
  const ctx: ScenarioContext = {
    now: OPEN,
    suffix: newScenarioSuffix(),
    newId: () => uuidv7(OPEN),
    newTicketCode,
  };
  const rows = buildScenarioCatalogue(
    ctx,
    scenarioVenue(ctx, [{ name: 'Seats', type: 'SEATED', rows: 1, seatsPerRow: 4 }]),
    [
      {
        slug: `drop-test-${ctx.suffix}`,
        title: `Drop Test ${ctx.suffix}`,
        performer: 'Someone',
        description: 'Waiting room integration test.',
        category: 'CONCERT',
        status: options.status ?? 'PUBLISHED',
        venue: `scenario-venue-${ctx.suffix}`,
        starts: [10, '20:00'],
        durationMin: 120,
        salesOpen: SALES_OPEN,
        batches: [{ name: 'All', priceCents: 5000, sections: ['Seats'], releases: [-1, '10:00'] }],
      },
    ],
  );
  const [event] = rows.events;
  const [seat] = rows.seats;
  if (event?.id === undefined || seat?.id === undefined) throw new Error('no event');
  event.waitingRoomEnabled = options.waitingRoom ?? true;
  event.admissionRatePerSec = options.rate ?? 10;
  event.admissionTokenTtlSec = TTL_SEC;
  await prisma.$transaction(async (tx) => {
    await insertRows(tx, rows);
  });
  return { id: event.id, seatId: seat.id };
}

async function customer(): Promise<SessionClient> {
  return sessionClient(app, await createTestSession(app, { role: 'CUSTOMER' }));
}

async function customers(count: number): Promise<SessionClient[]> {
  return Promise.all(Array.from({ length: count }, () => customer()));
}

async function join(client: SessionClient, eventId: string, status = 201): Promise<QueueEntry> {
  const res = await client.post(`/events/${eventId}/queue`).expect(status);
  return QueueEntrySchema.parse(res.body);
}

async function poll(client: SessionClient, token: string): Promise<QueueEntry> {
  const res = await client.get(`/queue/${token}`).expect(200);
  return QueueEntrySchema.parse(res.body);
}

async function advance(ms: number): Promise<void> {
  await clock.advanceBy(ms);
}

/** One run of the admission job; returns how many it let in for `eventId`. */
async function admit(eventId: string): Promise<number> {
  const results = await admission.admit();
  return results.find((result) => result.eventId === eventId)?.admitted ?? 0;
}

function problemType(res: request.Response): string {
  return ProblemDetailsSchema.parse(res.body).type;
}

describe('POST /events/{eventId}/queue', () => {
  beforeEach(async () => {
    await clock.freezeAt(new Date(OPEN.getTime() - 60_000));
  });

  it('returns the same entry when the customer joins twice', async () => {
    const event = await insertDropEvent();
    const client = await customer();
    const first = await join(client, event.id, 201);
    const second = await join(client, event.id, 200);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      eventId: event.id,
      status: 'PRE_SALE',
      position: null,
      queueLength: 1,
      salesOpenAt: OPEN.toISOString(),
      joinedAt: new Date(OPEN.getTime() - 60_000).toISOString(),
      admission: null,
    });
    expect(await poll(client, first.token)).toEqual(first);
  });

  it('gives concurrent joins of one customer a single entry', async () => {
    const event = await insertDropEvent();
    const client = await customer();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => client.post(`/events/${event.id}/queue`)),
    );
    expect(responses.map((res) => res.status).sort()).toEqual([
      200, 200, 200, 200, 200, 200, 200, 200, 200, 201,
    ]);
    const tokens = new Set(responses.map((res) => QueueEntrySchema.parse(res.body).token));
    expect(tokens.size).toBe(1);
    expect((await poll(client, [...tokens][0] ?? '')).queueLength).toBe(1);
  });

  it('refuses events without a waiting room, unpublished and started events', async () => {
    const client = await customer();
    const open = await insertDropEvent({ waitingRoom: false });
    const res = await client.post(`/events/${open.id}/queue`).expect(409);
    expect(problemType(res)).toBe(PROBLEM_TYPES.NO_WAITING_ROOM);

    const draft = await insertDropEvent({ status: 'DRAFT' });
    await client.post(`/events/${draft.id}/queue`).expect(404);
    await client.post(`/events/${uuidv7(OPEN)}/queue`).expect(404);

    const started = await insertDropEvent();
    await advance(11 * 24 * 60 * 60 * 1000);
    // A new session: the first one has expired by then.
    const late = await (await customer()).post(`/events/${started.id}/queue`).expect(409);
    expect(problemType(late)).toBe(PROBLEM_TYPES.EVENT_NOT_ON_SALE);
  });

  it('needs a session', async () => {
    const event = await insertDropEvent();
    await request(app.getHttpServer()).post(`/events/${event.id}/queue`).expect(401);
    await request(app.getHttpServer()).get('/queue/anything').expect(401);
  });
});

describe('GET /queue/{token}', () => {
  it('answers 404 for unknown tokens and other customers’ tokens', async () => {
    await clock.freezeAt(OPEN);
    const event = await insertDropEvent();
    const [owner, other] = await customers(2);
    if (owner === undefined || other === undefined) throw new Error('no customers');
    const entry = await join(owner, event.id);
    await other.get(`/queue/${entry.token}`).expect(404);
    await owner.get('/queue/not-a-token').expect(404);
  });
});

describe('admission', () => {
  it('lets customers in N per second of server time, pre-sale joiners first in a random order', async () => {
    await clock.freezeAt(new Date(OPEN.getTime() - 60_000));
    const event = await insertDropEvent({ rate: 5 });
    const early = await customers(12);
    const earlyEntries: QueueEntry[] = [];
    for (const client of early) earlyEntries.push(await join(client, event.id));
    expect(earlyEntries.map((entry) => entry.status)).toEqual(Array(12).fill('PRE_SALE'));
    expect(earlyEntries.map((entry) => entry.retryAfterMs)).toEqual(Array(12).fill(2000));

    // Before sales open nobody goes in.
    expect(await admit(event.id)).toBe(0);

    await advance(60_000); // Sales open.
    const pending = await Promise.all(
      early.map((client, index) => poll(client, earlyEntries[index]?.token ?? '')),
    );
    const positions = pending.map((entry) => entry.position);
    expect([...positions].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    // Random, not join order (fails by chance once in 12! ≈ 479 million runs).
    expect(positions).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    // Joined after the opening: behind everyone who joined before, in join order.
    const [late1, late2] = await customers(2);
    if (late1 === undefined || late2 === undefined) throw new Error('no customers');
    const late1Entry = await join(late1, event.id);
    await advance(1);
    const late2Entry = await join(late2, event.id);
    expect(late1Entry).toMatchObject({ status: 'WAITING', position: 13, queueLength: 13 });
    expect(late2Entry).toMatchObject({ status: 'WAITING', position: 14, queueLength: 14 });

    // The first batch is due at the opening.
    expect(await admit(event.id)).toBe(5);
    expect(await admit(event.id)).toBe(0); // Same second: nothing more.
    const afterFirst = await poll(late2, late2Entry.token);
    expect(afterFirst).toMatchObject({ status: 'WAITING', position: 9, queueLength: 9 });
    // Position 9 at 5 per second: the batch after next, due at the opening + 2 s.
    expect(afterFirst.estimatedWaitMs).toBe(1999);

    await advance(998);
    expect(await admit(event.id)).toBe(0);
    await advance(1); // Opening + 1 s.
    expect(await admit(event.id)).toBe(5);
    await advance(1000);
    expect(await admit(event.id)).toBe(4);

    const finals = await Promise.all([
      ...early.map((client, index) => poll(client, earlyEntries[index]?.token ?? '')),
      poll(late1, late1Entry.token),
      poll(late2, late2Entry.token),
    ]);
    expect(finals.map((entry) => entry.status)).toEqual(Array(14).fill('ADMITTED'));
    // The ones who waited longest went in last, at opening + 2 s.
    const expiry = new Date(OPEN.getTime() + 2000 + TTL_SEC * 1000).toISOString();
    expect(finals.at(-1)).toMatchObject({
      queueLength: 0,
      position: null,
      retryAfterMs: null,
      admission: { expiresAt: expiry },
    });
  });

  it('keeps join order for joins in the same millisecond after the opening', async () => {
    await clock.freezeAt(new Date(OPEN.getTime() + 5000));
    const event = await insertDropEvent({ rate: 1 });
    const clients = await customers(8);
    const entries: QueueEntry[] = [];
    for (const client of clients) entries.push(await join(client, event.id));
    expect(entries.map((entry) => entry.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(entries.map((entry) => entry.joinedAt)).toEqual(
      Array(8).fill(new Date(OPEN.getTime() + 5000).toISOString()),
    );

    // One per second, first come first served.
    for (const [index, client] of clients.entries()) {
      expect(await admit(event.id)).toBe(1);
      expect(await poll(client, entries[index]?.token ?? '')).toMatchObject({ status: 'ADMITTED' });
      await advance(1000);
    }
  });

  it('lets in every batch that fell due when the clock jumps', async () => {
    await clock.freezeAt(OPEN);
    const event = await insertDropEvent({ rate: 3 });
    for (const client of await customers(20)) await join(client, event.id);
    await advance(4000); // Batches at +0, +1, +2, +3 and +4 s.
    expect(await admit(event.id)).toBe(15);
    expect(await admit(event.id)).toBe(0);
  });

  it('lets one batch in when several workers run at the same moment', async () => {
    await clock.freezeAt(OPEN);
    const event = await insertDropEvent({ rate: 3 });
    for (const client of await customers(10)) await join(client, event.id);
    const runs = await Promise.all(Array.from({ length: 5 }, () => admit(event.id)));
    expect(runs.reduce((sum, admitted) => sum + admitted, 0)).toBe(3);
  });

  it('saves up no batches while the queue is empty', async () => {
    await clock.freezeAt(OPEN);
    const event = await insertDropEvent({ rate: 2 });
    const [first, ...rest] = await customers(6);
    if (first === undefined) throw new Error('no customers');
    await join(first, event.id);
    expect(await admit(event.id)).toBe(1); // Now empty.

    await advance(60_000);
    for (const client of rest) await join(client, event.id);
    // One batch: the minute nobody waited doesn't count.
    expect(await admit(event.id)).toBe(2);
  });

  it('lets everyone in at once when the waiting room is turned off', async () => {
    await clock.freezeAt(OPEN);
    const event = await insertDropEvent({ rate: 1 });
    for (const client of await customers(4)) await join(client, event.id);
    await prisma.event.update({ where: { id: event.id }, data: { waitingRoomEnabled: false } });
    expect(await admit(event.id)).toBe(4);
  });

  it('runs on its own in the worker', async () => {
    const queue = new Queue(WAITING_ROOM_QUEUE, {
      prefix: QUEUE_PREFIX,
      connection: { url: inject('integration').redisUrl },
    });
    await queue.obliterate({ force: true });
    const worker = await createIntegrationApp({
      env: {
        TESTTIX_TEST_MODE: 'true',
        WORKER_IN_PROCESS: 'true',
        HOLD_SWEEPER_ENABLED: 'false',
        QUEUE_ADMISSION_INTERVAL_MS: '100',
      },
    });
    try {
      await clock.freezeAt(OPEN);
      const event = await insertDropEvent();
      const client = await customer();
      const entry = await join(client, event.id);
      await vi.waitFor(
        async () => {
          expect((await poll(client, entry.token)).status).toBe('ADMITTED');
        },
        { timeout: 10_000, interval: 100 },
      );
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });
});

describe('admission tokens', () => {
  /** A customer let in to a fresh drop event, at the opening. */
  async function admitted(): Promise<{
    event: DropEvent;
    client: SessionClient;
    entry: QueueEntry;
    token: string;
  }> {
    await clock.freezeAt(OPEN);
    const event = await insertDropEvent();
    const client = await customer();
    const joined = await join(client, event.id);
    expect(await admit(event.id)).toBe(1);
    const entry = await poll(client, joined.token);
    if (entry.admission === null) throw new Error('not admitted');
    return { event, client, entry, token: entry.admission.token };
  }

  function seatMap(eventId: string, token?: string) {
    const req = request(app.getHttpServer()).get(`/events/${eventId}/seats`);
    return token === undefined ? req : req.set(ADMISSION_TOKEN_HEADER, token);
  }

  function hold(client: SessionClient, event: DropEvent, token?: string) {
    const req = client.post(`/events/${event.id}/holds`, { seats: [event.seatId], ga: [] });
    return token === undefined ? req : req.set(ADMISSION_TOKEN_HEADER, token);
  }

  it('open the seat map and holds of a drop event', async () => {
    const { event, client, token } = await admitted();

    const noToken = await seatMap(event.id).expect(403);
    expect(problemType(noToken)).toBe(PROBLEM_TYPES.QUEUE_REQUIRED);
    expect(ProblemDetailsSchema.parse(noToken.body).detail).toContain(ADMISSION_TOKEN_HEADER);
    expect(problemType(await seatMap(event.id, 'made-up').expect(403))).toBe(
      PROBLEM_TYPES.QUEUE_REQUIRED,
    );
    await seatMap(event.id, token).expect(200);

    expect(problemType(await hold(client, event).expect(403))).toBe(PROBLEM_TYPES.QUEUE_REQUIRED);
    const res = await hold(client, event, token).expect(201);
    expect(HoldSchema.parse(res.body).items).toHaveLength(1);
  });

  it('are not valid for other events, nor for holds by other customers', async () => {
    const { event, token } = await admitted();
    const other = await insertDropEvent();
    await seatMap(other.id, token).expect(403);
    const stranger = await customer();
    const res = await hold(stranger, event, token).expect(403);
    expect(problemType(res)).toBe(PROBLEM_TYPES.QUEUE_REQUIRED);
  });

  it('expire after the event’s admission time; joining again starts over at the back', async () => {
    const { event, client, entry, token } = await admitted();
    await advance(TTL_SEC * 1000 - 1);
    await seatMap(event.id, token).expect(200);
    await advance(1);

    const expired = await seatMap(event.id, token).expect(403);
    expect(ProblemDetailsSchema.parse(expired.body).detail).toBe(
      'Your admission has expired. Join the queue again.',
    );
    expect(problemType(await hold(client, event, token).expect(403))).toBe(
      PROBLEM_TYPES.QUEUE_REQUIRED,
    );
    expect(await poll(client, entry.token)).toMatchObject({ status: 'EXPIRED', admission: null });

    const again = await join(client, event.id, 201);
    expect(again.token).not.toBe(entry.token);
    expect(again).toMatchObject({ status: 'WAITING', position: 1 });
    await client.get(`/queue/${entry.token}`).expect(404);
    expect(await admit(event.id)).toBe(1);
    const readmitted = await poll(client, again.token);
    expect(readmitted.admission?.token).not.toBe(token);
    await seatMap(event.id, readmitted.admission?.token).expect(200);
  });

  it('are not needed for events without a waiting room', async () => {
    await clock.freezeAt(OPEN);
    const event = await insertDropEvent({ waitingRoom: false });
    await seatMap(event.id).expect(200);
    await hold(await customer(), event).expect(201);
  });
});

describe('metrics and reset', () => {
  it('exports queue length, admissions and rate on /metrics', async () => {
    await clock.freezeAt(OPEN);
    const event = await insertDropEvent({ rate: 2 });
    for (const client of await customers(5)) await join(client, event.id);
    expect(await admit(event.id)).toBe(2);

    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    const label = `{event_id="${event.id}"}`;
    expect(res.text).toContain(`testtix_waiting_room_queue_length${label} 3`);
    expect(res.text).toContain(`testtix_waiting_room_admitted_total${label} 2`);
    expect(res.text).toContain(`testtix_waiting_room_admission_rate${label} 2`);
  });

  it('empties every waiting room on POST /__test/reset', async () => {
    await clock.freezeAt(OPEN);
    const event = await insertDropEvent();
    await join(await customer(), event.id);
    const redis = app.get<Redis>(REDIS);
    expect(await redis.keys(`${QUEUE_KEY_PREFIX}:*`)).not.toEqual([]);
    await request(app.getHttpServer()).post('/__test/reset').expect(200);
    expect(await redis.keys(`${QUEUE_KEY_PREFIX}:*`)).toEqual([]);
  });
});
