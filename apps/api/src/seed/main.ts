/**
 * Seeds an empty database with the baseline data: `pnpm db:seed` at the repo root (which builds
 * the API first and runs `prisma db seed`). To start over: `pnpm db:reset && pnpm db:seed`.
 *
 * Reads the same environment as the API. "Now" comes from `ClockService`, so with test mode on
 * the data is relative to the test clock, like `POST /__test/reset` (C1.3).
 *
 * `--if-empty` skips a database that already has data instead of failing (exit code 0), so a
 * container can run it on every start (the `migrate` service in docker/compose.yml).
 */
import 'reflect-metadata';

import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';

import { ClockService } from '../clock/clock.service.js';
import { ConfigValidationError, parseConfig } from '../config/config.schema.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { seedDatabase, SeedTargetNotEmptyError } from './seed.js';

const ifEmpty = process.argv.slice(2).includes('--if-empty');

try {
  const config = parseConfig(process.env);
  // Only used, and only connected, when test mode is on.
  const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.databaseUrl }),
  });
  try {
    const now = await new ClockService(config, redis).now();
    const summary = await seedDatabase(prisma, now);
    const counts = Object.entries(summary).map(([table, rows]) => `${table}: ${rows}`);
    process.stdout.write(`Seeded for ${now.toISOString().slice(0, 10)}. ${counts.join(', ')}\n`);
  } finally {
    redis.disconnect();
    await prisma.$disconnect();
  }
} catch (err) {
  if (ifEmpty && err instanceof SeedTargetNotEmptyError) {
    process.stdout.write('The database already has data; seed skipped.\n');
  } else {
    const message =
      err instanceof SeedTargetNotEmptyError || err instanceof ConfigValidationError
        ? err.message
        : err instanceof Error
          ? (err.stack ?? err.message)
          : String(err);
    process.stderr.write(`Seed failed: ${message}\n`);
    process.exitCode = 1;
  }
}
