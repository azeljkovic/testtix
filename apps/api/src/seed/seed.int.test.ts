import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { PrismaService } from '../infra/prisma.service.js';
import { dataHash } from '../testing/integration/data-hash.js';
import { createIntegrationApp } from '../testing/integration/integration-app.js';
import { resetState } from '../testing/integration/reset.js';
import { SEED_FIXTURES } from './fixtures.js';
import { seedDatabase, SeedTargetNotEmptyError } from './seed.js';

const NOW = new Date('2026-11-21T10:15:00.000Z');

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

describe('seedDatabase', () => {
  it('produces an identical data hash every time it runs', async () => {
    const summary = await seedDatabase(prisma, NOW);
    const first = await dataHash(prisma);

    await resetState(inject('integration'));
    await seedDatabase(prisma, NOW);

    expect(await dataHash(prisma)).toEqual(first);
    expect(first).toMatchObject({
      venues: { rows: summary.venues },
      sections: { rows: summary.sections },
      seats: { rows: summary.seats },
      events: { rows: summary.events },
      ticket_batches: { rows: summary.ticketBatches },
      inventory_units: { rows: summary.inventoryUnits },
      users: { rows: 0 },
      orders: { rows: 0 },
    });
  });

  it('gives the same data at another time on the same UTC day', async () => {
    await seedDatabase(prisma, NOW);
    const morning = await dataHash(prisma);

    await resetState(inject('integration'));
    await seedDatabase(prisma, new Date('2026-11-21T23:59:59.000Z'));

    expect(await dataHash(prisma)).toEqual(morning);
  });

  it('stores the fixtures under their stable IDs and slugs', async () => {
    await seedDatabase(prisma, NOW);

    const event = await prisma.event.findUniqueOrThrow({
      where: { slug: 'warehouse-sessions-static-lights' },
      include: { venue: true, batches: { orderBy: { name: 'asc' } } },
    });
    expect(event.id).toBe(SEED_FIXTURES.events['warehouse-sessions-static-lights']);
    expect(event.venue.id).toBe(SEED_FIXTURES.venues['the-warehouse']);
    expect(event.startsAt).toEqual(new Date('2026-12-01T00:00:00.000Z'));
    expect(event.batches.map(({ name, priceCents }) => ({ name, priceCents }))).toEqual([
      { name: 'Mezzanine', priceCents: 7500 },
      { name: 'Standing', priceCents: 4500 },
    ]);
    const units = await prisma.inventoryUnit.groupBy({
      by: ['seatId'],
      where: { eventId: event.id, seatId: null },
      _count: true,
    });
    expect(units).toEqual([{ seatId: null, _count: 250 }]);
    expect(
      await prisma.inventoryUnit.count({ where: { eventId: event.id, seatId: { not: null } } }),
    ).toBe(36);
  });

  it('refuses to seed a database that already has catalogue data, and changes nothing', async () => {
    await seedDatabase(prisma, NOW);
    const before = await dataHash(prisma);

    await expect(seedDatabase(prisma, NOW)).rejects.toBeInstanceOf(SeedTargetNotEmptyError);

    expect(await dataHash(prisma)).toEqual(before);
  });

  it('serializes concurrent runs: exactly one succeeds', async () => {
    const results = await Promise.allSettled([
      seedDatabase(prisma, NOW),
      seedDatabase(prisma, NOW),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(SeedTargetNotEmptyError);
  });
});

describe('dataHash', () => {
  it('changes when one row changes', async () => {
    await seedDatabase(prisma, NOW);
    const before = await dataHash(prisma);

    await prisma.event.update({
      where: { id: SEED_FIXTURES.events['flaky-tests-clinic'] },
      data: { title: 'Flaky Tests Clinic (moved)' },
    });

    const after = await dataHash(prisma);
    expect(after.events).not.toEqual(before.events);
    expect({ ...after, events: before.events }).toEqual(before);
  });
});
