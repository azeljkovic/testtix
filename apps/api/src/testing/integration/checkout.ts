import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ProblemDetailsSchema } from '@testtix/shared';
import type request from 'supertest';
import { expect } from 'vitest';

import { type Hold, HoldSchema } from '../../holds/holds.schemas.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { uuidv7 } from '../../infra/uuid.js';
import { type Order, OrderSchema } from '../../orders/orders.schemas.js';
import type { BatchSpec, DayTime, SectionSpec } from '../../seed/fixtures.js';
import { insertRows } from '../../seed/seed.js';
import {
  buildScenarioCatalogue,
  newScenarioSuffix,
  newTicketCode,
  type ScenarioContext,
  scenarioVenue,
} from '../../test-api/scenarios/scenario-data.js';
import { createTestSession, type SessionClient, sessionClient, type TestSession } from '../auth.js';

/** An event inserted by `insertCheckoutEvent()`, with lookups for its seats and sections. */
export interface CheckoutEvent {
  id: string;
  title: string;
  /** A seat of section `Seats` by label, e.g. `A1`. */
  seat: (label: string) => string;
  section: (name: string) => string;
}

/** Sales open the day before the server clock's UTC day. */
export const CHECKOUT_SALES_OPEN: DayTime = [-1, '10:00'];

export const CHECKOUT_SECTIONS: SectionSpec[] = [
  { name: 'Seats', type: 'SEATED', rows: 2, seatsPerRow: 3 },
  { name: 'Floor', type: 'GA', capacity: 5 },
];

export const CHECKOUT_BATCHES: BatchSpec[] = [
  { name: 'Seats', priceCents: 4000, sections: ['Seats'], releases: CHECKOUT_SALES_OPEN },
  { name: 'Floor', priceCents: 2500, sections: ['Floor'], releases: CHECKOUT_SALES_OPEN },
];

export interface CheckoutEventOptions {
  /** Server "now": the event's dates are relative to its UTC day. */
  now: Date;
  holdDurationSec: number;
  batches?: BatchSpec[];
}

/**
 * Inserts a venue (2×3 seats in `Seats`, GA `Floor` of 5) and one published event on sale in 10
 * days, for checkout tests.
 */
export async function insertCheckoutEvent(
  app: NestFastifyApplication,
  { now, holdDurationSec, batches = CHECKOUT_BATCHES }: CheckoutEventOptions,
): Promise<CheckoutEvent> {
  const ctx: ScenarioContext = {
    now,
    suffix: newScenarioSuffix(),
    newId: () => uuidv7(now),
    newTicketCode,
  };
  const title = `Checkout Test ${ctx.suffix}`;
  const rows = buildScenarioCatalogue(ctx, scenarioVenue(ctx, CHECKOUT_SECTIONS), [
    {
      slug: `checkout-test-${ctx.suffix}`,
      title,
      performer: 'Someone',
      description: 'Checkout integration test.',
      category: 'CONCERT',
      status: 'PUBLISHED',
      venue: `scenario-venue-${ctx.suffix}`,
      starts: [10, '20:00'],
      durationMin: 120,
      salesOpen: CHECKOUT_SALES_OPEN,
      batches,
    },
  ]);
  const [event] = rows.events;
  if (event?.id === undefined) throw new Error('no event');
  event.holdDurationSec = holdDurationSec;
  await app.get(PrismaService).$transaction(async (tx) => {
    await insertRows(tx, rows);
  });
  const section = (name: string) => {
    const id = rows.sections.find((s) => s.name === name)?.id;
    if (id === undefined) throw new Error(`no section ${name}`);
    return id;
  };
  return {
    id: event.id,
    title,
    section,
    seat: (label) => {
      const match = /^([A-Z]+)(\d+)$/.exec(label);
      const seat = rows.seats.find(
        (s) =>
          s.sectionId === section('Seats') && s.row === match?.[1] && s.number === Number(match[2]),
      );
      if (seat?.id === undefined) throw new Error(`no seat ${label}`);
      return seat.id;
    },
  };
}

/** A logged-in customer (email verified unless told otherwise), with their `user`. */
export async function checkoutCustomer(
  app: NestFastifyApplication,
  options: { emailVerified?: boolean } = {},
): Promise<SessionClient & Pick<TestSession, 'user'>> {
  const session = await createTestSession(app, { role: 'CUSTOMER', ...options });
  return { ...sessionClient(app, session), user: session.user };
}

export async function holdTickets(
  client: SessionClient,
  eventId: string,
  body: object,
): Promise<Hold> {
  const res = await client.post(`/events/${eventId}/holds`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return HoldSchema.parse(res.body);
}

export function checkout(client: SessionClient, holdId: string) {
  return client.post('/orders', { holdId });
}

export function parseOrder(res: request.Response, status: number): Order {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return OrderSchema.parse(res.body);
}

export function expectProblem(res: request.Response, status: number, type: string): void {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  expect(ProblemDetailsSchema.parse(res.body).type).toBe(type);
}
