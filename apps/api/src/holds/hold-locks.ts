import type { Prisma } from '../generated/prisma/client.js';

type Db = Prisma.TransactionClient;

/*
 * Row locks shared by everything that changes holds (`HoldsService`, `HoldSweeperService`). Take
 * them in this order, after the event lock: per-user advisory lock, then units by ID.
 */

/** Serializes one user's hold changes for one event until the transaction ends. */
export async function lockUserEvent(tx: Db, userId: string, eventId: string): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${`hold:${userId}:${eventId}`}, 0))`;
}

/** Locks a hold's inventory units in ID order until the transaction ends. */
export async function lockHoldUnits(tx: Db, holdId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM inventory_units WHERE hold_id = ${holdId}::uuid ORDER BY id FOR UPDATE`;
}

/**
 * Releases a hold's units and deletes it. Returns how many units were released and how many
 * holds were deleted (0 or 1).
 */
export async function deleteHold(
  tx: Db,
  holdId: string,
): Promise<{ units: number; holds: number }> {
  const units = await tx.$executeRaw`
    UPDATE inventory_units SET status = 'AVAILABLE', hold_id = NULL, held_until = NULL
    WHERE hold_id = ${holdId}::uuid`;
  const { count } = await tx.hold.deleteMany({ where: { id: holdId } });
  return { units, holds: count };
}
