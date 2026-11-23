import type { Prisma } from '../generated/prisma/client.js';
import { deleteHold } from '../holds/hold-locks.js';

type Db = Prisma.TransactionClient;

/**
 * Moves an unpaid order to `PROCESSING` once its payment result is known (C4.3), or straight
 * away for a free order. The caller holds the holds locks of the order's hold (event `FOR SHARE`,
 * the user's advisory lock, the hold's units) and has checked that the order is
 * `PENDING_PAYMENT` and not expired.
 *
 * The order stops depending on its hold: its units leave the hold as `SOLD` (off sale, like any
 * sold ticket) and the hold is deleted. From now on nothing that releases, replaces or sweeps
 * holds can reach these tickets; only the processing job decides them: `CONFIRMED` keeps them
 * sold, `FAILED` makes them available again (`OrderProcessingService.finalize()`).
 */
export async function startProcessing(
  tx: Db,
  orderId: string,
  holdId: string,
  now: Date,
): Promise<void> {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: { inventoryUnitId: true },
  });
  const unitIds = items.map((item) => item.inventoryUnitId);
  const moved = await tx.$executeRaw`
    UPDATE inventory_units SET status = 'SOLD', hold_id = NULL, held_until = NULL
    WHERE hold_id = ${holdId}::uuid AND id = ANY(${unitIds}::uuid[])`;
  // An unexpired hold keeps its units: nobody else can have claimed them.
  if (moved !== unitIds.length) {
    throw new Error(
      `Order ${orderId}: only ${String(moved)} of its ${String(unitIds.length)} tickets were still on its hold`,
    );
  }
  // Before the hold goes: `deleteHold()` expires the hold's order while it is still unpaid.
  await tx.order.update({ where: { id: orderId }, data: { status: 'PROCESSING', updatedAt: now } });
  await deleteHold(tx, holdId, now);
}
