import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { createIntegrationApp } from '../testing/integration/integration-app.js';
import { resetState } from '../testing/integration/reset.js';
import { PrismaService } from './prisma.service.js';

// The database rejects invalid domain rows on its own: CHECK constraints (hand-written in the
// C1.2 migration), unique indexes and foreign keys. These tests prove the migration applies them.

const AT = new Date('2026-11-21T12:00:00.000Z');
const LATER = new Date('2026-11-21T14:00:00.000Z');

let app: NestFastifyApplication;
let prisma: PrismaService;

beforeAll(async () => {
  app = await createIntegrationApp();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetState(inject('integration'));
});

/** A venue with a seated and a GA section, an event there with one batch, and a user. */
async function createWorld() {
  const venue = await prisma.venue.create({
    data: {
      slug: 'v',
      name: 'Venue',
      address: '1 Street',
      city: 'Port Ellis',
      timezone: 'America/New_York',
      createdAt: AT,
    },
  });
  const seated = await prisma.section.create({
    data: { venueId: venue.id, name: 'Stalls', type: 'SEATED', sortOrder: 0 },
  });
  const ga = await prisma.section.create({
    data: { venueId: venue.id, name: 'Floor', type: 'GA', capacity: 10, sortOrder: 1 },
  });
  const seat = await prisma.seat.create({
    data: { sectionId: seated.id, row: 'A', rowIndex: 0, number: 1 },
  });
  const event = await prisma.event.create({
    data: {
      slug: 'e',
      title: 'Event',
      performer: 'Someone',
      description: '',
      category: 'CONCERT',
      venueId: venue.id,
      startsAt: AT,
      endsAt: LATER,
      salesOpenAt: AT,
      createdAt: AT,
      updatedAt: AT,
    },
  });
  const batch = await prisma.ticketBatch.create({
    data: { eventId: event.id, name: 'B', priceCents: 1000, releasesAt: AT, createdAt: AT },
  });
  const user = await prisma.user.create({
    data: { email: 'u@example.test', passwordHash: 'x', name: 'U', createdAt: AT, updatedAt: AT },
  });
  const unit = { eventId: event.id, batchId: batch.id, priceCents: 1000 };
  return { venue, seated, ga, seat, event, batch, user, unit };
}

describe('database constraints', () => {
  it('applies the column defaults for new events and units', async () => {
    const { event, ga, unit } = await createWorld();
    expect(event).toMatchObject({
      status: 'DRAFT',
      holdDurationSec: 600,
      maxTicketsPerOrder: 6,
      waitingRoomEnabled: false,
    });
    const created = await prisma.inventoryUnit.create({ data: { ...unit, sectionId: ga.id } });
    expect(created).toMatchObject({ status: 'AVAILABLE', seatId: null, holdId: null });
  });

  it('requires a capacity for GA sections and forbids one for seated sections', async () => {
    const { venue } = await createWorld();
    await expect(
      prisma.section.create({ data: { venueId: venue.id, name: 'X', type: 'GA', sortOrder: 5 } }),
    ).rejects.toThrow(/sections_capacity_check/);
    await expect(
      prisma.section.create({
        data: { venueId: venue.id, name: 'Y', type: 'SEATED', capacity: 5, sortOrder: 6 },
      }),
    ).rejects.toThrow(/sections_capacity_check/);
    await expect(
      prisma.section.create({
        data: { venueId: venue.id, name: 'Z', type: 'GA', capacity: 0, sortOrder: 7 },
      }),
    ).rejects.toThrow(/sections_capacity_check/);
  });

  it('rejects an event that ends before it starts, and non-positive limits', async () => {
    const { event } = await createWorld();
    await expect(
      prisma.event.update({ where: { id: event.id }, data: { endsAt: AT } }),
    ).rejects.toThrow(/events_ends_after_start_check/);
    await expect(
      prisma.event.update({ where: { id: event.id }, data: { maxTicketsPerOrder: 0 } }),
    ).rejects.toThrow(/events_max_tickets_per_order_check/);
    await expect(
      prisma.event.update({ where: { id: event.id }, data: { holdDurationSec: 0 } }),
    ).rejects.toThrow(/events_hold_duration_sec_check/);
  });

  it('rejects negative prices', async () => {
    const { event, ga, unit } = await createWorld();
    await expect(
      prisma.ticketBatch.create({
        data: { eventId: event.id, name: 'N', priceCents: -1, releasesAt: AT, createdAt: AT },
      }),
    ).rejects.toThrow(/ticket_batches_price_cents_check/);
    await expect(
      prisma.inventoryUnit.create({ data: { ...unit, sectionId: ga.id, priceCents: -1 } }),
    ).rejects.toThrow(/inventory_units_price_cents_check/);
  });

  it('keeps a unit HELD exactly while it has a hold with an expiry', async () => {
    const { event, ga, user, unit } = await createWorld();
    const hold = await prisma.hold.create({
      data: { eventId: event.id, userId: user.id, expiresAt: LATER, createdAt: AT },
    });
    const cases = [
      { status: 'HELD' as const },
      { status: 'HELD' as const, holdId: hold.id },
      { status: 'AVAILABLE' as const, holdId: hold.id, heldUntil: LATER },
      { status: 'SOLD' as const, holdId: hold.id, heldUntil: LATER },
    ];
    for (const fields of cases) {
      await expect(
        prisma.inventoryUnit.create({ data: { ...unit, sectionId: ga.id, ...fields } }),
      ).rejects.toThrow(/inventory_units_hold_check/);
    }
    await expect(
      prisma.inventoryUnit.create({
        data: { ...unit, sectionId: ga.id, status: 'HELD', holdId: hold.id, heldUntil: LATER },
      }),
    ).resolves.toMatchObject({ status: 'HELD' });
  });

  it('sells a seat at most once per event, while GA units never conflict', async () => {
    const { seated, ga, seat, unit } = await createWorld();
    await prisma.inventoryUnit.create({ data: { ...unit, sectionId: seated.id, seatId: seat.id } });
    await expect(
      prisma.inventoryUnit.create({ data: { ...unit, sectionId: seated.id, seatId: seat.id } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await prisma.inventoryUnit.createMany({
      data: [
        { ...unit, sectionId: ga.id },
        { ...unit, sectionId: ga.id },
      ],
    });
    expect(await prisma.inventoryUnit.count({ where: { seatId: null } })).toBe(2);
  });

  it('allows one hold per user and event', async () => {
    const { event, user } = await createWorld();
    const hold = { eventId: event.id, userId: user.id, expiresAt: LATER, createdAt: AT };
    await prisma.hold.create({ data: hold });
    await expect(prisma.hold.create({ data: hold })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('stores emails lower-cased only', async () => {
    await expect(
      prisma.user.create({
        data: {
          email: 'Mixed@Example.test',
          passwordHash: 'x',
          name: 'M',
          createdAt: AT,
          updatedAt: AT,
        },
      }),
    ).rejects.toThrow(/users_email_lower_check/);
  });

  it('keeps sold inventory: an event with ordered units cannot be deleted', async () => {
    const { event, ga, user, unit } = await createWorld();
    const created = await prisma.inventoryUnit.create({ data: { ...unit, sectionId: ga.id } });
    await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        totalCents: 1000,
        expiresAt: LATER,
        createdAt: AT,
        updatedAt: AT,
        items: { create: { inventoryUnitId: created.id, priceCents: 1000 } },
      },
    });
    await expect(prisma.event.delete({ where: { id: event.id } })).rejects.toThrow();
    expect(await prisma.event.count()).toBe(1);
  });

  it('stores a payment session with its URL, and one order per hold that outlives the hold', async () => {
    const { event, user } = await createWorld();
    const hold = await prisma.hold.create({
      data: { eventId: event.id, userId: user.id, expiresAt: LATER, createdAt: AT },
    });
    const order = {
      userId: user.id,
      eventId: event.id,
      totalCents: 0,
      expiresAt: LATER,
      createdAt: AT,
      updatedAt: AT,
    };
    await expect(
      prisma.order.create({ data: { ...order, paymentSessionId: 'ps_1' } }),
    ).rejects.toThrow(/orders_payment_session_check/);
    await expect(
      prisma.order.create({ data: { ...order, paymentUrl: 'http://pay.test/ps_1' } }),
    ).rejects.toThrow(/orders_payment_session_check/);

    const created = await prisma.order.create({ data: { ...order, holdId: hold.id } });
    await expect(prisma.order.create({ data: { ...order, holdId: hold.id } })).rejects.toThrow();

    await prisma.hold.delete({ where: { id: hold.id } });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      holdId: null,
    });
  });

  it('deletes a venue layout with the venue, but not a venue that has events', async () => {
    const { venue, event } = await createWorld();
    await expect(prisma.venue.delete({ where: { id: venue.id } })).rejects.toThrow();
    await prisma.event.delete({ where: { id: event.id } });
    await prisma.venue.delete({ where: { id: venue.id } });
    expect(await prisma.section.count()).toBe(0);
    expect(await prisma.seat.count()).toBe(0);
  });
});
