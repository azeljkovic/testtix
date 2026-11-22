import { Injectable, NotFoundException } from '@nestjs/common';

import { ClockService } from '../clock/clock.service.js';
import { findCatalogueEventById } from '../events/catalogue-query.js';
import { PrismaService } from '../infra/prisma.service.js';
import type { SeatMap, SeatMapSection } from './holds.schemas.js';
import { findGaPriceRows, findSeatRows, type GaPriceRow, type SeatRow } from './seat-map-query.js';

export function publishedEventNotFound(): NotFoundException {
  return new NotFoundException('No published event with this ID.');
}

/** The seat map of a published event (`GET /events/{eventId}/seats`), at the server clock. */
@Injectable()
export class SeatMapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  async get(eventId: string): Promise<SeatMap> {
    const now = await this.clock.now();
    // One snapshot, so the seats, GA counts and availability agree with each other.
    return this.prisma.$transaction(
      async (tx) => {
        const summary = await findCatalogueEventById(tx, eventId, now);
        if (summary === undefined) throw publishedEventNotFound();
        // Sequential: an interactive transaction runs one query at a time anyway.
        const event = await tx.event.findUniqueOrThrow({
          where: { id: eventId },
          select: { maxTicketsPerOrder: true, holdDurationSec: true },
        });
        const sections = await tx.section.findMany({
          where: { venueId: summary.venueId },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        });
        const seats = await findSeatRows(tx, eventId, summary.venueId, now);
        const gaPrices = await findGaPriceRows(tx, eventId, now);
        return {
          eventId,
          availability: summary.availability,
          maxTicketsPerOrder: event.maxTicketsPerOrder,
          holdDurationSec: event.holdDurationSec,
          sections: sections.map((section): SeatMapSection =>
            section.type === 'SEATED'
              ? seatedSection(section, seats)
              : {
                  id: section.id,
                  name: section.name,
                  type: 'GA',
                  capacity: section.capacity ?? 0,
                  ...gaAvailability(section.id, gaPrices),
                },
          ),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}

function seatedSection(
  section: { id: string; name: string },
  seats: readonly SeatRow[],
): SeatMapSection {
  const rows: Extract<SeatMapSection, { type: 'SEATED' }>['rows'] = [];
  let available = 0;
  // `seats` is sorted by section, row index and number.
  for (const seat of seats) {
    if (seat.sectionId !== section.id) continue;
    let row = rows.at(-1);
    if (row?.index !== seat.rowIndex) {
      row = { label: seat.row, index: seat.rowIndex, seats: [] };
      rows.push(row);
    }
    row.seats.push({
      id: seat.seatId,
      number: seat.number,
      status: seat.status,
      priceCents: seat.priceCents,
    });
    if (seat.status === 'AVAILABLE') available += 1;
  }
  return { id: section.id, name: section.name, type: 'SEATED', available, rows };
}

function gaAvailability(
  sectionId: string,
  rows: readonly GaPriceRow[],
): { available: number; prices: { priceCents: number; available: number }[] } {
  const prices = rows
    .filter((row) => row.sectionId === sectionId)
    .map(({ priceCents, available }) => ({ priceCents, available }));
  return { available: prices.reduce((sum, price) => sum + price.available, 0), prices };
}
