import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ADMISSION_TOKEN_HEADER, PROBLEM_TYPES, ProblemDetailsSchema } from '@testtix/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ClockService } from '../../clock/clock.service.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { SeatMapSchema } from '../../holds/holds.schemas.js';
import { createTestSession, type SessionClient, sessionClient } from '../../testing/auth.js';
import { createIntegrationApp } from '../../testing/integration/integration-app.js';
import { QueueAdmissionService } from '../../waiting-room/queue-admission.service.js';
import { QueueStore } from '../../waiting-room/queue-store.js';
import { type QueueEntry, QueueEntrySchema } from '../../waiting-room/waiting-room.schemas.js';
import { type DropResult, DropResultSchema } from './scenario.schemas.js';

/** Not on a whole second, to check the scenarios round the opening down. */
const FROZEN = '2026-11-21T10:15:00.250Z';

let app: NestFastifyApplication;
let prisma: PrismaService;
let clock: ClockService;
let admission: QueueAdmissionService;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  app = await createIntegrationApp({ env: { TESTTIX_TEST_MODE: 'true' } });
  prisma = app.get(PrismaService);
  clock = app.get(ClockService);
  http = request(app.getHttpServer());
  // The worker is off, so the admission job runs only when a test calls it.
  admission = new QueueAdmissionService(prisma, clock, app.get(QueueStore, { strict: false }));
});

afterAll(async () => {
  await clock.reset();
  await app.close();
});

// Every test starts from a clean reset through the test API, as a tester's run would.
beforeEach(async () => {
  await http.post('/__test/reset').send({ freezeAt: FROZEN }).expect(200);
});

async function seed(scenario: string, body?: object): Promise<DropResult> {
  const res = await http.post(`/__test/seed/${scenario}`).send(body).expect(201);
  return DropResultSchema.parse(res.body);
}

async function customer(): Promise<SessionClient> {
  return sessionClient(app, await createTestSession(app, { role: 'CUSTOMER' }));
}

async function join(client: SessionClient, eventId: string): Promise<QueueEntry> {
  const res = await client.post(`/events/${eventId}/queue`).expect(201);
  return QueueEntrySchema.parse(res.body);
}

async function poll(client: SessionClient, token: string): Promise<QueueEntry> {
  const res = await client.get(`/queue/${token}`).expect(200);
  return QueueEntrySchema.parse(res.body);
}

async function admit(eventId: string): Promise<number> {
  const results = await admission.admit();
  return results.find((result) => result.eventId === eventId)?.admitted ?? 0;
}

function seatMap(eventId: string, token?: string) {
  const req = http.get(`/events/${eventId}/seats`);
  return token === undefined ? req : req.set(ADMISSION_TOKEN_HEADER, token);
}

/** The first seat and the GA section of a drop's seat map, read with an admission token. */
async function pickTickets(eventId: string, token: string) {
  const map = SeatMapSchema.parse((await seatMap(eventId, token).expect(200)).body);
  const seated = map.sections.find((section) => section.type === 'SEATED');
  const ga = map.sections.find((section) => section.type === 'GA');
  const seat = seated?.rows[0]?.seats[0];
  if (seat === undefined || ga === undefined) throw new Error('drop without a seat or GA section');
  return { map, seatId: seat.id, gaSectionId: ga.id };
}

/** Holds a seat and a GA place with the customer's admission token. */
async function holdWith(client: SessionClient, eventId: string, token: string) {
  const { seatId, gaSectionId } = await pickTickets(eventId, token);
  return client
    .post(`/events/${eventId}/holds`, {
      seats: [seatId],
      ga: [{ sectionId: gaSectionId, quantity: 1 }],
    })
    .set(ADMISSION_TOKEN_HEADER, token);
}

async function expectStoredDrop(event: DropResult['event']) {
  expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({
    salesOpenAt: new Date(event.salesOpenAt),
    waitingRoomEnabled: true,
    admissionRatePerSec: event.admissionRatePerSec,
    admissionTokenTtlSec: event.admissionTokenTtlSec,
  });
  expect(await prisma.inventoryUnit.count({ where: { eventId: event.id } })).toBe(
    event.tickets.total,
  );
}

describe('POST /__test/seed/drop-in-5-min', () => {
  it('queues customers before the opening and lets them in once sales open', async () => {
    const { event } = await seed('drop-in-5-min');
    expect(event).toMatchObject({
      salesOpenAt: '2026-11-21T10:20:00.000Z',
      waitingRoomEnabled: true,
      admissionRatePerSec: 5,
      tickets: { total: 100, available: 100 },
    });
    await expectStoredDrop(event);

    // Listed with its waiting room; nothing released before the opening.
    const detail = await http.get(`/events/${event.slug}`).expect(200);
    expect(detail.body).toMatchObject({ waitingRoomEnabled: true });

    const clients = await Promise.all(Array.from({ length: 7 }, () => customer()));
    const entries = await Promise.all(clients.map((client) => join(client, event.id)));
    for (const entry of entries)
      expect(entry).toMatchObject({ status: 'PRE_SALE', position: null });
    expect(await admit(event.id)).toBe(0);
    expect(problem(await seatMap(event.id).expect(403))).toBe(PROBLEM_TYPES.QUEUE_REQUIRED);

    // At the opening the first batch of five goes in; a second later, the other two.
    await clock.advanceBy(5 * 60_000 - 250);
    expect(await admit(event.id)).toBe(5);
    await clock.advanceBy(1000);
    expect(await admit(event.id)).toBe(2);

    const [first, firstClient] = [entries[0], clients[0]];
    if (first === undefined || firstClient === undefined) throw new Error('no customer');
    const admitted = await poll(firstClient, first.token);
    expect(admitted).toMatchObject({ status: 'ADMITTED', retryAfterMs: null });
    const token = admitted.admission?.token ?? '';
    const res = await holdWith(firstClient, event.id, token);
    expect(res.status).toBe(201);
  });
});

describe('POST /__test/seed/drop-open-now', () => {
  it('is open at once and lets customers in in join order', async () => {
    const { event } = await seed('drop-open-now');
    expect(event).toMatchObject({
      salesOpenAt: '2026-11-21T10:15:00.000Z',
      admissionRatePerSec: 5,
      tickets: { total: 100, available: 100 },
    });
    await expectStoredDrop(event);

    const clients = await Promise.all(Array.from({ length: 6 }, () => customer()));
    const entries: QueueEntry[] = [];
    for (const client of clients) entries.push(await join(client, event.id));
    expect(entries.map((entry) => entry.status)).toEqual(Array(6).fill('WAITING'));
    expect(entries.map((entry) => entry.position)).toEqual([1, 2, 3, 4, 5, 6]);

    expect(await admit(event.id)).toBe(5);
    const statuses = await Promise.all(
      clients.map(async (client, i) => (await poll(client, entries[i]?.token ?? '')).status),
    );
    expect(statuses).toEqual([
      'ADMITTED',
      'ADMITTED',
      'ADMITTED',
      'ADMITTED',
      'ADMITTED',
      'WAITING',
    ]);

    const last = entries[5];
    const lastClient = clients[5];
    if (last === undefined || lastClient === undefined) throw new Error('no customer');
    expect(await poll(lastClient, last.token)).toMatchObject({ position: 1 });
  });

  it('takes the admission settings from the body', async () => {
    const { event } = await seed('drop-open-now', {
      admissionRatePerSec: 1,
      admissionTokenTtlSec: 60,
    });
    await expectStoredDrop(event);
    const client = await customer();
    const entry = await join(client, event.id);
    expect(await admit(event.id)).toBe(1);
    const admitted = await poll(client, entry.token);
    expect(admitted.admission?.expiresAt).toBe('2026-11-21T10:16:00.250Z');
  });
});

describe('POST /__test/seed/large-venue-drop', () => {
  it('creates 10 000 tickets that open in five minutes by default', async () => {
    const { event } = await seed('large-venue-drop');
    expect(event).toMatchObject({
      salesOpenAt: '2026-11-21T10:20:00.000Z',
      admissionRatePerSec: 100,
      admissionTokenTtlSec: 600,
      tickets: { total: 10_000, available: 10_000, held: 0, sold: 0 },
    });
    await expectStoredDrop(event);
  });

  it('opens when asked and serves the full seat map to admitted customers', async () => {
    const { event, venue } = await seed('large-venue-drop', {
      salesOpenInSec: 0,
      admissionRatePerSec: 1000,
    });
    const clients = await Promise.all(Array.from({ length: 3 }, () => customer()));
    const entries = await Promise.all(clients.map((client) => join(client, event.id)));
    expect(await admit(event.id)).toBe(3);

    const [client] = clients;
    const [entry] = entries;
    if (client === undefined || entry === undefined) throw new Error('no customer');
    const token = (await poll(client, entry.token)).admission?.token ?? '';
    const { map } = await pickTickets(event.id, token);
    expect(map.sections.map((section) => section.id)).toEqual(venue.sections.map((s) => s.id));
    const stalls = map.sections.find((section) => section.type === 'SEATED');
    expect(stalls?.rows).toHaveLength(40);
    expect(stalls?.available).toBe(2000);
    expect(map.sections.find((section) => section.type === 'GA')?.available).toBe(8000);
    expect((await holdWith(client, event.id, token)).status).toBe(201);
  });
});

describe('drop scenario bodies', () => {
  it.each([
    ['drop-in-5-min', { admissionRatePerSec: 0 }],
    ['drop-open-now', { admissionTokenTtlSec: 59 }],
    ['drop-open-now', { salesOpenInSec: 0 }],
    ['large-venue-drop', { salesOpenInSec: 86_401 }],
    ['large-venue-drop', { admissionRatePerSec: 1001 }],
  ])('%s rejects %j', async (scenario, body) => {
    const res = await http.post(`/__test/seed/${scenario}`).send(body).expect(400);
    expect(problem(res)).toBe(PROBLEM_TYPES.VALIDATION_ERROR);
  });
});

function problem(res: request.Response): string {
  return ProblemDetailsSchema.parse(res.body).type;
}
