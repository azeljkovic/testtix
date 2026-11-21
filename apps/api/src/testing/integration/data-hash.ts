import type { PrismaClient } from '../../generated/prisma/client.js';

/** Row count and an MD5 of every row (ordered by `id`), per table. */
export type DataHash = Record<string, { rows: number; md5: string }>;

/**
 * Fingerprints the whole database (except Prisma's migration history), table by table, so two
 * states can be compared with `toEqual` and a mismatch names the table that differs.
 * Runs in one transaction with a fixed time zone and date style, so the text form of every row
 * is the same on every connection.
 */
export async function dataHash(prisma: PrismaClient): Promise<DataHash> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL TimeZone = 'UTC'`;
    await tx.$executeRaw`SET LOCAL DateStyle = 'ISO, YMD'`;
    const tables = await tx.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
      ORDER BY tablename`;
    const hash: DataHash = {};
    for (const { tablename } of tables) {
      const table = `"public"."${tablename.replaceAll('"', '""')}"`;
      const [result] = await tx.$queryRawUnsafe<{ rows: number; md5: string }[]>(
        `SELECT count(*)::int AS rows, md5(coalesce(string_agg(t::text, E'\\n' ORDER BY t.id), ''))
         AS md5 FROM ${table} t`,
      );
      if (result) hash[tablename] = result;
    }
    return hash;
  });
}
