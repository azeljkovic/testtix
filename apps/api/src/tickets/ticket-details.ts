import { LOCALE, type SectionType } from '@testtix/shared';

import type { Prisma } from '../generated/prisma/client.js';

type Db = Prisma.TransactionClient;

/** What a ticket's PDF page and email entry show. */
export interface TicketDetails {
  id: string;
  code: string;
  orderId: string;
  priceCents: number;
  event: {
    title: string;
    performer: string;
    startsAt: Date;
    venue: { name: string; address: string; city: string; timezone: string };
  };
  section: { name: string; type: SectionType };
  /** Null for a GA place. */
  seat: { row: string; number: number } | null;
}

const ticketSelect = {
  id: true,
  code: true,
  orderItem: {
    select: {
      orderId: true,
      priceCents: true,
      inventoryUnit: {
        select: {
          section: { select: { name: true, type: true } },
          seat: { select: { row: true, number: true } },
          event: {
            select: {
              title: true,
              performer: true,
              startsAt: true,
              venue: { select: { name: true, address: true, city: true, timezone: true } },
            },
          },
        },
      },
    },
  },
} as const satisfies Prisma.TicketSelect;

/** The order's section order, then row and seat (GA places by ID), as order items are listed. */
const ticketOrder = [
  { orderItem: { inventoryUnit: { section: { sortOrder: 'asc' } } } },
  { orderItem: { inventoryUnit: { seat: { rowIndex: 'asc' } } } },
  { orderItem: { inventoryUnit: { seat: { number: 'asc' } } } },
  { id: 'asc' },
] as const satisfies Prisma.TicketOrderByWithRelationInput[];

/** The tickets matching `where`, in the order's section, row and seat order. */
export async function loadTicketDetails(
  db: Db,
  where: Prisma.TicketWhereInput,
): Promise<TicketDetails[]> {
  const rows = await db.ticket.findMany({ where, orderBy: [...ticketOrder], select: ticketSelect });
  return rows.map(({ id, code, orderItem }) => ({
    id,
    code,
    orderId: orderItem.orderId,
    priceCents: orderItem.priceCents,
    event: orderItem.inventoryUnit.event,
    section: orderItem.inventoryUnit.section,
    seat: orderItem.inventoryUnit.seat,
  }));
}

/** Where the ticket gets you in: "Seats · Row A · Seat 1", or "General admission – Floor". */
export function placeLabel(ticket: Pick<TicketDetails, 'section' | 'seat'>): string {
  const { section, seat } = ticket;
  if (seat === null) return `General admission – ${section.name}`;
  return `${section.name} · Row ${seat.row} · Seat ${String(seat.number)}`;
}

/** The event's start in the venue's time zone, e.g. "Wednesday, March 10, 2027 at 8:00 PM EST". */
export function eventTimeLabel(startsAt: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(startsAt);
}
