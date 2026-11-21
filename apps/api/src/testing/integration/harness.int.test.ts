import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { PrismaService } from '../../infra/prisma.service.js';
import { REDIS } from '../../infra/redis.module.js';
import { createIntegrationApp } from './integration-app.js';
import { resetState } from './reset.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function user(email: string) {
  const at = new Date('2026-01-01T00:00:00.000Z');
  return { email, passwordHash: 'not-a-real-hash', name: 'Harness', createdAt: at, updatedAt: at };
}

let app: NestFastifyApplication;
let prisma: PrismaService;
let redis: Redis;

beforeAll(async () => {
  app = await createIntegrationApp();
  prisma = app.get(PrismaService);
  redis = app.get<Redis>(REDIS);
});

afterAll(async () => {
  await app.close();
});

// Tests in a file run in order; the first two rely on that.
describe('integration harness', () => {
  it('starts the file with empty tables and an empty Redis database', async () => {
    expect(await prisma.user.count()).toBe(0);
    expect(await redis.dbsize()).toBe(0);
  });

  it('applies the migrations, so the app can read and write the schema', async () => {
    const created = await prisma.user.create({ data: user('harness@example.test') });
    expect(created.id).toMatch(UUID_V7);
    await expect(
      prisma.user.findUniqueOrThrow({ where: { email: 'harness@example.test' } }),
    ).resolves.toEqual(created);
    await expect(prisma.user.create({ data: user(created.email) })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('resetState empties every table and Redis', async () => {
    await prisma.user.create({ data: user('reset@example.test') });
    await redis.set('testtix:harness', '1');

    await resetState(inject('integration'));

    expect(await prisma.user.count()).toBe(0);
    expect(await redis.dbsize()).toBe(0);
    const [{ count } = { count: -1n }] = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM _prisma_migrations`;
    expect(count).toBeGreaterThan(0n);
  });
});
