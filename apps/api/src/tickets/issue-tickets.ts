import type { Prisma } from '../generated/prisma/client.js';
import { newTicketCode } from './ticket-code.js';

/**
 * Issues one ticket per item of `orderId` that has none yet, with a new code each, and returns
 * how many it issued. Call it in the transaction that confirms the order, so a `CONFIRMED` order
 * always has its tickets. Running it again issues nothing (`order_item_id` is unique).
 */
export async function issueTickets(
  tx: Prisma.TransactionClient,
  orderId: string,
  now: Date,
): Promise<number> {
  const items = await tx.orderItem.findMany({
    where: { orderId, ticket: null },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  if (items.length === 0) return 0;
  const { count } = await tx.ticket.createMany({
    data: items.map((item) => ({ orderItemId: item.id, code: newTicketCode(), issuedAt: now })),
  });
  return count;
}
