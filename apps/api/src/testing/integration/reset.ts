import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';

import { PrismaClient } from '../../generated/prisma/client.js';
import { truncateAllTables } from '../../seed/seed.js';
import type { IntegrationTargets } from './targets-context.js';

/**
 * Empties every table except Prisma's migration history, and the test Redis database.
 * The integration setup file runs this before each test file.
 */
export async function resetState(targets: IntegrationTargets): Promise<void> {
  await Promise.all([resetDatabase(targets.databaseUrl), resetRedis(targets.redisUrl)]);
}

async function resetDatabase(databaseUrl: string): Promise<void> {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    await truncateAllTables(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function resetRedis(redisUrl: string): Promise<void> {
  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}
