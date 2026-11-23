import type { OrderStatus } from '@testtix/shared';

import type { Prisma } from '../generated/prisma/client.js';
import type { Order, OrderSummary } from './orders.schemas.js';

type Db = Prisma.TransactionClient;

/**
 * The status customers see at `now`: an unpaid order past its `expiresAt` is `EXPIRED` whether or
 * not a sweep has stored that yet (lazy expiry, like holds).
 */
export function effectiveStatus(
  order: { status: OrderStatus; expiresAt: Date },
  now: Date,
): OrderStatus {
  return order.status === 'PENDING_PAYMENT' && order.expiresAt.getTime() <= now.getTime()
    ? 'EXPIRED'
    : order.status;
}

/**
 * How long a client should wait before polling an order again: the poll interval while the order
 * can still change, but never past the moment an unpaid order expires. Null once it is final.
 */
export function retryAfterMs(
  status: OrderStatus,
  expiresAt: Date,
  now: Date,
  pollIntervalMs: number,
): number | null {
  if (status === 'PROCESSING') return pollIntervalMs;
  if (status !== 'PENDING_PAYMENT') return null;
  return Math.max(1, Math.min(pollIntervalMs, expiresAt.getTime() - now.getTime()));
}

/**
 * How an order's items are listed everywhere (the order, its tickets PDF, the e-ticket email):
 * the venue's section order, then row and seat; GA places by price, then by inventory unit.
 */
export const ORDER_ITEM_ORDER = [
  { inventoryUnit: { section: { sortOrder: 'asc' } } },
  { inventoryUnit: { seat: { rowIndex: 'asc' } } },
  { inventoryUnit: { seat: { number: 'asc' } } },
  { priceCents: 'asc' },
  { inventoryUnitId: 'asc' },
] as const satisfies Prisma.OrderItemOrderByWithRelationInput[];

const eventSelect = {
  id: true,
  slug: true,
  title: true,
  startsAt: true,
  venue: { select: { name: true, timezone: true } },
} as const satisfies Prisma.EventSelect;

const summarySelect = {
  id: true,
  status: true,
  totalCents: true,
  expiresAt: true,
  createdAt: true,
  event: { select: eventSelect },
  _count: { select: { items: true } },
} as const satisfies Prisma.OrderSelect;

type SummaryRow = Prisma.OrderGetPayload<{ select: typeof summarySelect }>;

function toSummary(row: SummaryRow, now: Date): OrderSummary {
  return {
    id: row.id,
    status: effectiveStatus(row, now),
    event: {
      id: row.event.id,
      slug: row.event.slug,
      title: row.event.title,
      startsAt: row.event.startsAt.toISOString(),
      venue: row.event.venue,
    },
    totalCents: row.totalCents,
    ticketCount: row._count.items,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** One page of a user's orders, newest first (`id` breaks ties). */
export async function listOrderSummaries(
  db: Db,
  userId: string,
  window: { skip: number; take: number },
  now: Date,
): Promise<{ items: OrderSummary[]; total: number }> {
  const [rows, total] = await Promise.all([
    db.order.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...window,
      select: summarySelect,
    }),
    db.order.count({ where: { userId } }),
  ]);
  return { items: rows.map((row) => toSummary(row, now)), total };
}

/** The order `orderId` of `userId`, or null when there is none (or it is someone else's). */
export async function loadOrder(
  db: Db,
  userId: string,
  orderId: string,
  now: Date,
  pollIntervalMs: number,
): Promise<Order | null> {
  const row = await db.order.findFirst({
    where: { id: orderId, userId },
    select: {
      ...summarySelect,
      paymentUrl: true,
      updatedAt: true,
      _count: {
        select: { items: true, paymentEvents: { where: { outcome: 'REFUND_DUE' } } },
      },
      items: {
        select: {
          priceCents: true,
          ticket: { select: { id: true, code: true } },
          inventoryUnit: {
            select: {
              id: true,
              section: { select: { id: true, name: true, type: true } },
              seat: { select: { id: true, row: true, number: true } },
            },
          },
        },
        orderBy: [...ORDER_ITEM_ORDER],
      },
    },
  });
  if (row === null) return null;
  const summary = toSummary(row, now);
  return {
    ...summary,
    items: row.items.map((item) => ({
      inventoryUnitId: item.inventoryUnit.id,
      section: item.inventoryUnit.section,
      seat: item.inventoryUnit.seat,
      priceCents: item.priceCents,
      ticket: item.ticket,
    })),
    paymentUrl: summary.status === 'PENDING_PAYMENT' ? row.paymentUrl : null,
    updatedAt: row.updatedAt.toISOString(),
    retryAfterMs: retryAfterMs(summary.status, row.expiresAt, now, pollIntervalMs),
    refundDue: row._count.paymentEvents > 0,
  };
}
