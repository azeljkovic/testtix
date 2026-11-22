import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  CSRF_HEADER,
  HOLD_MESSAGES,
  PROBLEM_TYPES,
  ProblemDetailsSchema,
  type TicketsUnavailableProblem,
  TicketsUnavailableProblemSchema,
} from '@testtix/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ClockService } from '../clock/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { uuidv7 } from '../infra/uuid.js';
import type { SectionSpec } from '../seed/fixtures.js';
import type { BatchSpec, DayTime } from '../seed/fixtures.js';
import { insertRows } from '../seed/seed.js';
import {
  buildScenarioCatalogue,
  newScenarioSuffix,
  newTicketCode,
  type ScenarioContext,
  type ScenarioRows,
  scenarioVenue,
} from '../test-api/scenarios/scenario-data.js';
import { OneSeatLeftResultSchema } from '../test-api/scenarios/scenario.schemas.js';
import { createTestSession, type SessionClient, sessionClient } from '../testing/auth.js';
import { createIntegrationApp } from '../testing/integration/integration-app.js';
import { type Hold, HoldSchema, type SeatMap, SeatMapSchema } from './holds.schemas.js';

/** The server clock while testing. Events are relative to the start of its UTC day (`D`). */
const NOW = new Date('2027-03-01T12:00:00.000Z');
const OPEN: DayTime = [-1, '10:00'];
const LATER: DayTime = [3, '10:00'];
const HOLD_SEC = 600;

let app: NestFastifyApplication;
let prisma: PrismaService;
let clock: ClockService;

beforeAll(async () => {
  app = await createIntegrationApp({ env: { TESTTIX_TEST_MODE: 'true' } });
  prisma = app.get(PrismaService);
  clock = app.get(ClockService);
  await clock.freezeAt(NOW);
});

afterAll(async () => {
  await clock.reset();
  await app.close();
});

interface TestEvent {
  id: string;
  rows: ScenarioRows;
  /** Seat ID by label, e.g. `Seats:A1`. */
  seat: (label: string) => string;
  section: (name: string) => string;
  /** Inventory unit of a seat label. */
  unit: (label: string) => string;
}

/** Inserts a venue with `sections` and one event selling `batches` (on sale unless overridden). */
async function insertEvent(options: {
  sections: SectionSpec[];
  batches: (Omit<BatchSpec, 'releases'> & { releases?: DayTime })[];
  salesOpen?: DayTime;
  starts?: DayTime;
  maxTicketsPerOrder?: number;
  status?: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
}): Promise<TestEvent> {
  const ctx: ScenarioContext = {
    now: NOW,
    suffix: newScenarioSuffix(),
    newId: () => uuidv7(NOW),
    newTicketCode,
  };
  const rows = buildScenarioCatalogue(ctx, scenarioVenue(ctx, options.sections), [
    {
      slug: `holds-test-${ctx.suffix}`,
      title: `Holds Test ${ctx.suffix}`,
      performer: 'Someone',
      description: 'Holds integration test.',
      category: 'CONCERT',
      status: options.status ?? 'PUBLISHED',
      venue: `scenario-venue-${ctx.suffix}`,
      starts: options.starts ?? [10, '20:00'],
      durationMin: 120,
      salesOpen: options.salesOpen ?? OPEN,
      batches: options.batches.map((batch) => ({ releases: OPEN, ...batch })),
    },
  ]);
  const [event] = rows.events;
  if (event?.id === undefined) throw new Error('no event');
  event.holdDurationSec = HOLD_SEC;
  if (options.maxTicketsPerOrder !== undefined) {
    event.maxTicketsPerOrder = options.maxTicketsPerOrder;
  }
  await prisma.$transaction(async (tx) => {
    await insertRows(tx, rows);
  });
  const sectionId = (name: string) => {
    const id = rows.sections.find((s) => s.name === name)?.id;
    if (id === undefined) throw new Error(`no section ${name}`);
    return id;
  };
  const seatId = (label: string) => {
    const [name = '', place = ''] = label.split(':');
    const match = /^([A-Z]+)(\d+)$/.exec(place);
    const seat = rows.seats.find(
      (s) =>
        s.sectionId === sectionId(name) && s.row === match?.[1] && s.number === Number(match[2]),
    );
    if (seat?.id === undefined) throw new Error(`no seat ${label}`);
    return seat.id;
  };
  return {
    id: event.id,
    rows,
    seat: seatId,
    section: sectionId,
    unit: (label) => {
      const id = rows.inventoryUnits.find((u) => u.seatId === seatId(label))?.id;
      if (id === undefined) throw new Error(`no unit for ${label}`);
      return id;
    },
  };
}

async function customer(): Promise<SessionClient> {
  return sessionClient(app, await createTestSession(app, { role: 'CUSTOMER' }));
}

function hold(client: SessionClient, eventId: string, body: object) {
  return client.post(`/events/${eventId}/holds`, body);
}

async function seatMap(eventId: string): Promise<SeatMap> {
  const res = await request(app.getHttpServer()).get(`/events/${eventId}/seats`);
  expect(res.status).toBe(200);
  return SeatMapSchema.parse(res.body);
}

/** Seat statuses of a seat map, e.g. `{ 'Seats:A1': 'AVAILABLE' }`. */
function seatStatuses(map: SeatMap): Record<string, string> {
  const statuses: Record<string, string> = {};
  for (const section of map.sections) {
    if (section.type !== 'SEATED') continue;
    for (const row of section.rows) {
      for (const seat of row.seats) {
        statuses[`${section.name}:${row.label}${String(seat.number)}`] = seat.status;
      }
    }
  }
  return statuses;
}

function expectConflict(res: request.Response): TicketsUnavailableProblem {
  expect(res.status).toBe(409);
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  const problem = TicketsUnavailableProblemSchema.parse(res.body);
  expect(problem.type).toBe(PROBLEM_TYPES.TICKETS_UNAVAILABLE);
  return problem;
}

async function unitStates(eventId: string) {
  const units = await prisma.inventoryUnit.findMany({ where: { eventId }, orderBy: { id: 'asc' } });
  return units.map(({ id, status, holdId, heldUntil }) => ({ id, status, holdId, heldUntil }));
}

const SEATS_2x3: SectionSpec = { name: 'Seats', type: 'SEATED', rows: 2, seatsPerRow: 3 };

describe('GET /events/:eventId/seats', () => {
  it('shows every seat’s status, GA places by price, and treats expired holds as available', async () => {
    const event = await insertEvent({
      sections: [
        SEATS_2x3,
        { name: 'Box', type: 'SEATED', rows: 1, seatsPerRow: 2 },
        { name: 'Floor', type: 'GA', capacity: 5 },
        { name: 'Unused', type: 'GA', capacity: 3 },
      ],
      batches: [
        { name: 'Seats', priceCents: 4000, sections: ['Seats'] },
        { name: 'Box', priceCents: 9000, sections: ['Box'], releases: LATER },
        { name: 'Floor', priceCents: 2500, sections: ['Floor'] },
      ],
    });
    // B3 is sold; A2 is held (unexpired), A3 was held but the hold expired.
    await prisma.inventoryUnit.update({
      where: { id: event.unit('Seats:B3') },
      data: { status: 'SOLD' },
    });
    const holder = await customer();
    expect((await hold(holder, event.id, { seats: [event.seat('Seats:A3')] })).status).toBe(201);
    await clock.advanceBy(HOLD_SEC * 1000);
    expect(
      (
        await hold(await customer(), event.id, {
          seats: [event.seat('Seats:A2')],
          ga: [{ sectionId: event.section('Floor'), quantity: 2 }],
        })
      ).status,
    ).toBe(201);

    const map = await seatMap(event.id);
    await clock.freezeAt(NOW);

    expect(map).toMatchObject({
      eventId: event.id,
      availability: 'ON_SALE',
      maxTicketsPerOrder: 6,
      holdDurationSec: HOLD_SEC,
    });
    expect(map.sections.map((s) => [s.name, s.type, s.available])).toEqual([
      ['Seats', 'SEATED', 4],
      ['Box', 'SEATED', 0],
      ['Floor', 'GA', 3],
      ['Unused', 'GA', 0],
    ]);
    expect(seatStatuses(map)).toEqual({
      'Seats:A1': 'AVAILABLE',
      'Seats:A2': 'HELD',
      'Seats:A3': 'AVAILABLE',
      'Seats:B1': 'AVAILABLE',
      'Seats:B2': 'AVAILABLE',
      'Seats:B3': 'SOLD',
      'Box:A1': 'NOT_ON_SALE',
      'Box:A2': 'NOT_ON_SALE',
    });
    const [seats, box, floor, unused] = map.sections;
    expect(seats?.type === 'SEATED' && seats.rows.map((row) => [row.label, row.index])).toEqual([
      ['A', 0],
      ['B', 1],
    ]);
    expect(box?.type === 'SEATED' && box.rows[0]?.seats[0]?.priceCents).toBe(9000);
    expect(floor).toMatchObject({ capacity: 5, prices: [{ priceCents: 2500, available: 3 }] });
    expect(unused).toMatchObject({ capacity: 3, available: 0, prices: [] });
  });

  it('is public, and 404 for drafts, cancelled events and unknown IDs', async () => {
    const draft = await insertEvent({
      sections: [SEATS_2x3],
      batches: [{ name: 'All', priceCents: 1000, sections: ['Seats'] }],
      status: 'DRAFT',
    });
    const cancelled = await insertEvent({
      sections: [SEATS_2x3],
      batches: [{ name: 'All', priceCents: 1000, sections: ['Seats'] }],
      status: 'CANCELLED',
    });
    for (const id of [draft.id, cancelled.id, uuidv7(NOW)]) {
      const res = await request(app.getHttpServer()).get(`/events/${id}/seats`);
      expect(res.status).toBe(404);
      expect(ProblemDetailsSchema.parse(res.body).detail).toBe('No published event with this ID.');
    }
    expect((await request(app.getHttpServer()).get('/events/not-a-uuid/seats')).status).toBe(400);
  });

  it('reports when sales have not opened', async () => {
    const event = await insertEvent({
      sections: [SEATS_2x3],
      batches: [{ name: 'All', priceCents: 1000, sections: ['Seats'] }],
      salesOpen: LATER,
    });
    expect((await seatMap(event.id)).availability).toBe('SALES_NOT_OPEN');
  });
});

describe('POST /events/:eventId/holds', () => {
  it('holds seats and GA places together, cheapest GA places first', async () => {
    const event = await insertEvent({
      sections: [SEATS_2x3, { name: 'Floor', type: 'GA', capacity: 4 }],
      batches: [
        { name: 'Seats', priceCents: 4000, sections: ['Seats'] },
        { name: 'Floor', priceCents: 2500, sections: ['Floor'] },
      ],
    });
    // Make one Floor place cheaper: the hold must take it first.
    const floorUnits = event.rows.inventoryUnits.filter((u) => u.seatId === null);
    const cheap = floorUnits.at(-1)?.id ?? '';
    await prisma.inventoryUnit.update({ where: { id: cheap }, data: { priceCents: 1500 } });
    const client = await customer();

    const res = await hold(client, event.id, {
      seats: [event.seat('Seats:B2'), event.seat('Seats:A1')],
      ga: [{ sectionId: event.section('Floor'), quantity: 2 }],
    });

    expect(res.status).toBe(201);
    const body: Hold = HoldSchema.parse(res.body);
    const expiresAt = new Date(NOW.getTime() + HOLD_SEC * 1000).toISOString();
    expect(body).toMatchObject({
      eventId: event.id,
      createdAt: NOW.toISOString(),
      expiresAt,
      totalCents: 4000 + 4000 + 1500 + 2500,
    });
    expect(
      body.items.map((item) => [
        item.section.name,
        item.seat?.row,
        item.seat?.number,
        item.priceCents,
      ]),
    ).toEqual([
      ['Seats', 'A', 1, 4000],
      ['Seats', 'B', 2, 4000],
      ['Floor', undefined, undefined, 1500],
      ['Floor', undefined, undefined, 2500],
    ]);
    expect(body.items.map((item) => item.inventoryUnitId)).toContain(cheap);

    const held = (await unitStates(event.id)).filter((u) => u.status === 'HELD');
    expect(held).toHaveLength(4);
    for (const unit of held) {
      expect(unit).toMatchObject({ holdId: body.id, heldUntil: new Date(expiresAt) });
    }
    expect(seatStatuses(await seatMap(event.id))).toMatchObject({
      'Seats:A1': 'HELD',
      'Seats:B2': 'HELD',
    });
  });

  it('gives the last seat to one customer; the next gets 409 with the seat ID', async () => {
    const scenario = OneSeatLeftResultSchema.parse(
      (await request(app.getHttpServer()).post('/__test/seed/one-seat-left').expect(201)).body,
    );
    expect(
      (await hold(await customer(), scenario.event.id, { seats: [scenario.seat.id] })).status,
    ).toBe(201);

    const problem = expectConflict(
      await hold(await customer(), scenario.event.id, { seats: [scenario.seat.id] }),
    );
    expect(problem).toMatchObject({
      status: 409,
      title: 'Tickets unavailable',
      detail: 'A seat is no longer available. Nothing was held.',
      unavailableSeatIds: [scenario.seat.id],
      gaShortfalls: [],
    });
  });

  it('refuses sold seats and seats that are not on sale, listing each', async () => {
    const scenario = OneSeatLeftResultSchema.parse(
      (await request(app.getHttpServer()).post('/__test/seed/one-seat-left').expect(201)).body,
    );
    const [soldA, soldB] = scenario.soldSeats;
    const problem = expectConflict(
      await hold(await customer(), scenario.event.id, {
        seats: [soldB?.id, scenario.seat.id, soldA?.id],
      }),
    );
    expect(problem.unavailableSeatIds).toEqual([soldB?.id, soldA?.id]);
    expect(problem.detail).toBe('2 seats are no longer available. Nothing was held.');
    // The available seat in the same request was not held either.
    expect(await prisma.hold.count({ where: { eventId: scenario.event.id } })).toBe(0);

    const event = await insertEvent({
      sections: [SEATS_2x3, { name: 'Box', type: 'SEATED', rows: 1, seatsPerRow: 2 }],
      batches: [
        { name: 'Seats', priceCents: 4000, sections: ['Seats'] },
        { name: 'Box', priceCents: 9000, sections: ['Box'], releases: LATER },
      ],
    });
    const unreleased = event.seat('Box:A1');
    expect(
      expectConflict(await hold(await customer(), event.id, { seats: [unreleased] }))
        .unavailableSeatIds,
    ).toEqual([unreleased]);
  });

  it('rolls a mixed seated + GA hold back fully when one part fails', async () => {
    const event = await insertEvent({
      sections: [SEATS_2x3, { name: 'Floor', type: 'GA', capacity: 3 }],
      batches: [
        { name: 'Seats', priceCents: 4000, sections: ['Seats'] },
        { name: 'Floor', priceCents: 2500, sections: ['Floor'] },
      ],
    });
    const before = await unitStates(event.id);

    const problem = expectConflict(
      await hold(await customer(), event.id, {
        seats: [event.seat('Seats:A1'), event.seat('Seats:A2')],
        ga: [{ sectionId: event.section('Floor'), quantity: 4 }],
      }),
    );

    expect(problem).toMatchObject({
      unavailableSeatIds: [],
      gaShortfalls: [{ sectionId: event.section('Floor'), requested: 4, available: 3 }],
      detail: 'A general-admission section has only 3 places left. Nothing was held.',
    });
    expect(await unitStates(event.id)).toEqual(before);
    expect(await prisma.hold.count({ where: { eventId: event.id } })).toBe(0);
  });

  it('reports a sold-out GA section with 0 places', async () => {
    const event = await insertEvent({
      sections: [{ name: 'Floor', type: 'GA', capacity: 2 }],
      batches: [{ name: 'Floor', priceCents: 2500, sections: ['Floor'] }],
    });
    const floor = event.section('Floor');
    expect(
      (await hold(await customer(), event.id, { ga: [{ sectionId: floor, quantity: 2 }] })).status,
    ).toBe(201);
    expect(
      expectConflict(
        await hold(await customer(), event.id, { ga: [{ sectionId: floor, quantity: 1 }] }),
      ),
    ).toMatchObject({
      gaShortfalls: [{ sectionId: floor, requested: 1, available: 0 }],
      detail: 'A general-admission section has no places left. Nothing was held.',
    });
  });

  it('enforces the event’s ticket limit across seats and GA places', async () => {
    const event = await insertEvent({
      sections: [SEATS_2x3, { name: 'Floor', type: 'GA', capacity: 5 }],
      batches: [
        { name: 'Seats', priceCents: 4000, sections: ['Seats'] },
        { name: 'Floor', priceCents: 2500, sections: ['Floor'] },
      ],
      maxTicketsPerOrder: 3,
    });
    const floor = event.section('Floor');
    const client = await customer();

    const res = await hold(client, event.id, {
      seats: [event.seat('Seats:A1'), event.seat('Seats:A2')],
      ga: [{ sectionId: floor, quantity: 2 }],
    });
    expect(res.status).toBe(400);
    expect(ProblemDetailsSchema.parse(res.body)).toMatchObject({
      type: PROBLEM_TYPES.VALIDATION_ERROR,
      errors: [{ path: '', code: 'too_big', message: HOLD_MESSAGES.tooMany(3) }],
    });

    const exact = await hold(client, event.id, {
      seats: [event.seat('Seats:A1')],
      ga: [{ sectionId: floor, quantity: 2 }],
    });
    expect(exact.status).toBe(201);
  });

  it('answers 400 for seats and sections that are not at the event’s venue', async () => {
    const event = await insertEvent({
      sections: [SEATS_2x3, { name: 'Floor', type: 'GA', capacity: 5 }],
      batches: [{ name: 'All', priceCents: 1000, sections: ['Seats', 'Floor'] }],
    });
    const other = await insertEvent({
      sections: [SEATS_2x3],
      batches: [{ name: 'All', priceCents: 1000, sections: ['Seats'] }],
    });

    const res = await hold(await customer(), event.id, {
      seats: [event.seat('Seats:A1'), other.seat('Seats:A1')],
      ga: [
        { sectionId: event.section('Seats'), quantity: 1 },
        { sectionId: event.section('Floor'), quantity: 1 },
      ],
    });

    expect(res.status).toBe(400);
    expect(ProblemDetailsSchema.parse(res.body).errors).toEqual([
      { path: 'seats.1', code: 'not_found', message: 'No seat with this ID at the event’s venue' },
      {
        path: 'ga.0.sectionId',
        code: 'not_found',
        message: 'No general-admission section with this ID at the event’s venue',
      },
    ]);
    expect(await prisma.hold.count({ where: { eventId: event.id } })).toBe(0);
  });

  it('answers 400 for an invalid body, before looking at the event', async () => {
    const client = await customer();
    for (const body of [
      {},
      { seats: ['nope'] },
      { ga: [{ sectionId: uuidv7(NOW), quantity: 0 }] },
    ]) {
      const res = await hold(client, uuidv7(NOW), body);
      expect(res.status).toBe(400);
      expect(ProblemDetailsSchema.parse(res.body).type).toBe(PROBLEM_TYPES.VALIDATION_ERROR);
    }
  });

  it('answers 404 unless the event is published, and 409 outside the sales window', async () => {
    const client = await customer();
    const draft = await insertEvent({
      sections: [SEATS_2x3],
      batches: [{ name: 'All', priceCents: 1000, sections: ['Seats'] }],
      status: 'DRAFT',
    });
    expect((await hold(client, draft.id, { seats: [draft.seat('Seats:A1')] })).status).toBe(404);

    const notOpen = await insertEvent({
      sections: [SEATS_2x3],
      batches: [{ name: 'All', priceCents: 1000, sections: ['Seats'] }],
      salesOpen: LATER,
    });
    const early = await hold(client, notOpen.id, { seats: [notOpen.seat('Seats:A1')] });
    expect(early.status).toBe(409);
    expect(ProblemDetailsSchema.parse(early.body)).toMatchObject({
      type: PROBLEM_TYPES.EVENT_NOT_ON_SALE,
      detail: 'Sales for this event have not opened yet.',
    });

    const started = await insertEvent({
      sections: [SEATS_2x3],
      batches: [{ name: 'All', priceCents: 1000, sections: ['Seats'] }],
      starts: [3, '20:00'],
    });
    await clock.freezeAt(new Date(Date.UTC(2027, 2, 4, 20, 0)));
    const late = await hold(client, started.id, { seats: [started.seat('Seats:A1')] });
    await clock.freezeAt(NOW);
    expect(late.status).toBe(409);
    expect(ProblemDetailsSchema.parse(late.body)).toMatchObject({
      type: PROBLEM_TYPES.EVENT_NOT_ON_SALE,
      detail: 'The event has started: sales have ended.',
    });
  });

  it('needs a session (401) and a CSRF token (403)', async () => {
    const event = await insertEvent({
      sections: [SEATS_2x3],
      batches: [{ name: 'All', priceCents: 1000, sections: ['Seats'] }],
    });
    const body = { seats: [event.seat('Seats:A1')] };
    const server = app.getHttpServer();
    expect((await request(server).post(`/events/${event.id}/holds`).send(body)).status).toBe(401);
    const session = await createTestSession(app, { role: 'CUSTOMER' });
    const noCsrf = await request(server)
      .post(`/events/${event.id}/holds`)
      .set('Cookie', session.cookie)
      .send(body);
    expect(noCsrf.status).toBe(403);
    const wrongCsrf = await request(server)
      .post(`/events/${event.id}/holds`)
      .set('Cookie', session.cookie)
      .set(CSRF_HEADER, 'wrong')
      .send(body);
    expect(wrongCsrf.status).toBe(403);
  });

  it('replaces the customer’s previous hold for the event; a failed request keeps it', async () => {
    const event = await insertEvent({
      sections: [SEATS_2x3],
      batches: [{ name: 'All', priceCents: 1000, sections: ['Seats'] }],
    });
    const client = await customer();
    const first = HoldSchema.parse(
      (await hold(client, event.id, { seats: [event.seat('Seats:A1'), event.seat('Seats:A2')] }))
        .body,
    );

    await clock.advanceBy(60_000);
    const second = await hold(client, event.id, {
      seats: [event.seat('Seats:A2'), event.seat('Seats:A3')],
    });
    expect(second.status).toBe(201);
    const replacement = HoldSchema.parse(second.body);
    expect(replacement.id).not.toBe(first.id);
    expect(replacement.expiresAt).toBe(
      new Date(NOW.getTime() + 60_000 + HOLD_SEC * 1000).toISOString(),
    );
    expect(seatStatuses(await seatMap(event.id))).toMatchObject({
      'Seats:A1': 'AVAILABLE',
      'Seats:A2': 'HELD',
      'Seats:A3': 'HELD',
    });
    expect(await prisma.hold.findMany({ where: { eventId: event.id } })).toEqual([
      expect.objectContaining({ id: replacement.id }),
    ]);

    // Someone else takes B1; asking for B1 now fails and leaves the A2 + A3 hold in place.
    expect(
      (await hold(await customer(), event.id, { seats: [event.seat('Seats:B1')] })).status,
    ).toBe(201);
    const before = await unitStates(event.id);
    expectConflict(await hold(client, event.id, { seats: [event.seat('Seats:B1')] }));
    expect(await unitStates(event.id)).toEqual(before);
    const current = await client.get(`/holds/current?eventId=${event.id}`);
    expect(HoldSchema.parse(current.body).id).toBe(replacement.id);
    await clock.freezeAt(NOW);
  });

  it('lets a hold expire through advanceBy: the seats are claimable again', async () => {
    const event = await insertEvent({
      sections: [SEATS_2x3],
      batches: [{ name: 'All', priceCents: 1000, sections: ['Seats'] }],
    });
    const first = await customer();
    const second = await customer();
    const seats = [event.seat('Seats:A1')];
    const firstHold = HoldSchema.parse((await hold(first, event.id, { seats })).body);

    // One millisecond before expiry the seat is still taken.
    const http = request(app.getHttpServer());
    await http
      .post('/__test/clock')
      .send({ advanceBy: HOLD_SEC * 1000 - 1 })
      .expect(200);
    expectConflict(await hold(second, event.id, { seats }));

    await http.post('/__test/clock').send({ advanceBy: 1 }).expect(200);
    expect(seatStatuses(await seatMap(event.id))['Seats:A1']).toBe('AVAILABLE');
    expect((await first.get('/holds/current')).status).toBe(404);
    const secondHold = HoldSchema.parse((await hold(second, event.id, { seats })).body);

    // Releasing the expired hold leaves the seat with its new holder.
    expect((await first.delete(`/holds/${firstHold.id}`)).status).toBe(204);
    expect(
      await prisma.inventoryUnit.findUniqueOrThrow({ where: { id: event.unit('Seats:A1') } }),
    ).toMatchObject({ status: 'HELD', holdId: secondHold.id });
    await clock.freezeAt(NOW);
  });
});

describe('GET /holds/current and DELETE /holds/:holdId', () => {
  it('returns the active hold for an event, or the most recent one', async () => {
    const one = await insertEvent({
      sections: [SEATS_2x3],
      batches: [{ name: 'All', priceCents: 1000, sections: ['Seats'] }],
    });
    const two = await insertEvent({
      sections: [{ name: 'Floor', type: 'GA', capacity: 5 }],
      batches: [{ name: 'All', priceCents: 700, sections: ['Floor'] }],
    });
    const client = await customer();
    expect((await client.get('/holds/current')).status).toBe(404);

    const first = HoldSchema.parse(
      (await hold(client, one.id, { seats: [one.seat('Seats:B1')] })).body,
    );
    await clock.advanceBy(1000);
    const second = HoldSchema.parse(
      (await hold(client, two.id, { ga: [{ sectionId: two.section('Floor'), quantity: 3 }] })).body,
    );

    expect((await client.get('/holds/current')).body).toEqual(second);
    expect((await client.get(`/holds/current?eventId=${one.id}`)).body).toEqual(first);
    expect(second).toMatchObject({ totalCents: 2100 });
    // Another customer sees none of these.
    const other = await customer();
    expect((await other.get(`/holds/current?eventId=${one.id}`)).status).toBe(404);
    expect((await client.get('/holds/current?eventId=nope')).status).toBe(400);
    await clock.freezeAt(NOW);
  });

  it('releases a hold at once; other customers’ holds are 404', async () => {
    const event = await insertEvent({
      sections: [SEATS_2x3, { name: 'Floor', type: 'GA', capacity: 2 }],
      batches: [{ name: 'All', priceCents: 1000, sections: ['Seats', 'Floor'] }],
    });
    const before = await unitStates(event.id);
    const owner = await customer();
    const held = HoldSchema.parse(
      (
        await hold(owner, event.id, {
          seats: [event.seat('Seats:A1')],
          ga: [{ sectionId: event.section('Floor'), quantity: 2 }],
        })
      ).body,
    );

    expect((await (await customer()).delete(`/holds/${held.id}`)).status).toBe(404);
    expect((await owner.delete(`/holds/${uuidv7(NOW)}`)).status).toBe(404);
    expect((await owner.delete(`/holds/${held.id}`)).status).toBe(204);
    expect(await unitStates(event.id)).toEqual(before);
    expect((await owner.delete(`/holds/${held.id}`)).status).toBe(404);
    expect((await owner.get('/holds/current')).status).toBe(404);
  });
});

describe('concurrency', () => {
  const RUNS = 10;
  const PARALLEL = 20;

  async function customers(count: number): Promise<SessionClient[]> {
    return Promise.all(Array.from({ length: count }, () => customer()));
  }

  it(`gives the last seat to exactly one of ${String(PARALLEL)} parallel requests (${String(RUNS)} runs)`, async () => {
    for (let run = 0; run < RUNS; run += 1) {
      const scenario = OneSeatLeftResultSchema.parse(
        (await request(app.getHttpServer()).post('/__test/seed/one-seat-left').expect(201)).body,
      );
      const clients = await customers(PARALLEL);

      const results = await Promise.all(
        clients.map((client) => hold(client, scenario.event.id, { seats: [scenario.seat.id] })),
      );

      const statuses = results.map((res) => res.status).sort();
      expect(statuses).toEqual([201, ...Array<number>(PARALLEL - 1).fill(409)]);
      for (const res of results.filter((r) => r.status === 409)) {
        expect(expectConflict(res).unavailableSeatIds).toEqual([scenario.seat.id]);
      }
      const winner = HoldSchema.parse(results.find((res) => res.status === 201)?.body);
      expect(
        await prisma.inventoryUnit.findUniqueOrThrow({
          where: { id: scenario.seat.inventoryUnitId },
        }),
      ).toMatchObject({ status: 'HELD', holdId: winner.id });
      expect(await prisma.hold.count({ where: { eventId: scenario.event.id } })).toBe(1);
    }
  }, 120_000);

  it(`gives the last 3 GA places to exactly 3 of ${String(PARALLEL)} parallel requests (${String(RUNS)} runs)`, async () => {
    for (let run = 0; run < RUNS; run += 1) {
      const event = await insertEvent({
        sections: [{ name: 'Floor', type: 'GA', capacity: 3 }],
        batches: [{ name: 'Floor', priceCents: 2500, sections: ['Floor'] }],
      });
      const floor = event.section('Floor');
      const clients = await customers(PARALLEL);

      const results = await Promise.all(
        clients.map((client) =>
          hold(client, event.id, { ga: [{ sectionId: floor, quantity: 1 }] }),
        ),
      );

      const statuses = results.map((res) => res.status).sort();
      expect(statuses).toEqual([201, 201, 201, ...Array<number>(PARALLEL - 3).fill(409)]);
      const winners = results
        .filter((res) => res.status === 201)
        .map((res) => HoldSchema.parse(res.body));
      const unitIds = winners.flatMap((w) => w.items.map((item) => item.inventoryUnitId));
      expect(new Set(unitIds).size).toBe(3);
      const units = await prisma.inventoryUnit.findMany({ where: { eventId: event.id } });
      expect(units.every((unit) => unit.status === 'HELD')).toBe(true);
      expect(await prisma.hold.count({ where: { eventId: event.id } })).toBe(3);
    }
  }, 120_000);

  it('never deadlocks when customers ask for overlapping seats in different orders', async () => {
    const event = await insertEvent({
      sections: [{ name: 'Seats', type: 'SEATED', rows: 1, seatsPerRow: 4 }],
      batches: [{ name: 'All', priceCents: 1000, sections: ['Seats'] }],
    });
    const labels = ['Seats:A1', 'Seats:A2', 'Seats:A3', 'Seats:A4'];
    const clients = await customers(PARALLEL);

    const results = await Promise.all(
      clients.map((client, index) => {
        const seats = labels.map(event.seat);
        const ordered = index % 2 === 0 ? seats : [...seats].reverse();
        return hold(client, event.id, { seats: ordered.slice(index % 3, (index % 3) + 2) });
      }),
    );

    // Every request finished with a definite answer, and no seat is in two holds.
    expect(results.every((res) => res.status === 201 || res.status === 409)).toBe(true);
    const held = (await unitStates(event.id)).filter((unit) => unit.status === 'HELD');
    const winners = results
      .filter((res) => res.status === 201)
      .map((res) => HoldSchema.parse(res.body));
    expect(winners.flatMap((w) => w.items)).toHaveLength(held.length);
  });
});
