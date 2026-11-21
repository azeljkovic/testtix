import type { Prisma } from '../generated/prisma/client.js';
import {
  type DayTime,
  EVENT_SPECS,
  type EventSpec,
  eventId,
  SEED_CITY,
  SEED_TIMEZONE,
  type SectionSpec,
  VENUE_SPECS,
  venueId,
} from './fixtures.js';
import { generateEventSpecs } from './generated-events.js';
import { seedId } from './seed-id.js';

/** Every row the baseline seed inserts, table by table, in insertion order. */
export interface SeedData {
  venues: Prisma.VenueCreateManyInput[];
  sections: Prisma.SectionCreateManyInput[];
  seats: Prisma.SeatCreateManyInput[];
  events: Prisma.EventCreateManyInput[];
  ticketBatches: Prisma.TicketBatchCreateManyInput[];
  inventoryUnits: Prisma.InventoryUnitCreateManyInput[];
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * Builds the baseline data set: the named fixtures (`fixtures.ts`) plus Faker-generated filler
 * events (`generated-events.ts`). It is a pure function of the seed **day**: dates are relative to
 * the start of `now`'s UTC day, so seeding at any time on the same day gives identical rows, and
 * upcoming events stay upcoming whenever the seed runs. IDs never depend on the date.
 *
 * Every released batch puts all seats (or all GA places) of its sections on sale, so the baseline
 * has no holds, orders or tickets: everything is `AVAILABLE`.
 */
export function buildSeedData(now: Date): SeedData {
  const dayStart = now.getTime() - (((now.getTime() % DAY_MS) + DAY_MS) % DAY_MS);
  const at = ([days, time]: DayTime): Date => {
    const [hours = 0, minutes = 0] = time.split(':').map(Number);
    return new Date(dayStart + days * DAY_MS + (hours * 60 + minutes) * MINUTE_MS);
  };
  const createdAt = at([-90, '12:00']);

  const data: SeedData = {
    venues: [],
    sections: [],
    seats: [],
    events: [],
    ticketBatches: [],
    inventoryUnits: [],
  };

  /** Per venue and section name: the section's ID and what its inventory units point at. */
  const layouts = new Map<string, Map<string, { id: string; units: (string | null)[] }>>();

  for (const venue of VENUE_SPECS) {
    const id = venueId(venue.slug);
    data.venues.push({
      id,
      slug: venue.slug,
      name: venue.name,
      address: venue.address,
      city: SEED_CITY,
      timezone: SEED_TIMEZONE,
      createdAt,
    });
    const sections = new Map<string, { id: string; units: (string | null)[] }>();
    venue.sections.forEach((section: SectionSpec, sortOrder) => {
      const sectionId = seedId(`section:${venue.slug}:${section.name}`);
      data.sections.push({
        id: sectionId,
        venueId: id,
        name: section.name,
        type: section.type,
        capacity: section.type === 'GA' ? section.capacity : null,
        sortOrder,
      });
      if (section.type === 'GA') {
        sections.set(section.name, {
          id: sectionId,
          units: Array.from({ length: section.capacity }, () => null),
        });
        return;
      }
      const seatIds: string[] = [];
      for (let rowIndex = 0; rowIndex < section.rows; rowIndex++) {
        const row = rowLabel(rowIndex);
        for (let number = 1; number <= section.seatsPerRow; number++) {
          const seatId = seedId(`seat:${venue.slug}:${section.name}:${row}${number}`);
          data.seats.push({ id: seatId, sectionId, row, rowIndex, number });
          seatIds.push(seatId);
        }
      }
      sections.set(section.name, { id: sectionId, units: seatIds });
    });
    layouts.set(venue.slug, sections);
  }

  const events: readonly EventSpec[] = [...EVENT_SPECS, ...generateEventSpecs()];
  for (const event of events) {
    const id = eventId(event.slug);
    const startsAt = at(event.starts);
    data.events.push({
      id,
      slug: event.slug,
      title: event.title,
      performer: event.performer,
      description: event.description,
      category: event.category,
      status: event.status,
      venueId: venueId(event.venue),
      startsAt,
      endsAt: new Date(startsAt.getTime() + event.durationMin * MINUTE_MS),
      salesOpenAt: at(event.salesOpen),
      createdAt,
      updatedAt: createdAt,
    });

    const layout = layouts.get(event.venue);
    const released = new Set<string>();
    for (const batch of event.batches) {
      const batchId = seedId(`batch:${event.slug}:${batch.name}`);
      data.ticketBatches.push({
        id: batchId,
        eventId: id,
        name: batch.name,
        priceCents: batch.priceCents,
        releasesAt: at(batch.releases),
        createdAt,
      });
      for (const sectionName of batch.sections) {
        const section = layout?.get(sectionName);
        if (section === undefined) {
          throw new Error(
            `Seed event ${event.slug}: no section "${sectionName}" at ${event.venue}`,
          );
        }
        if (released.has(sectionName)) {
          throw new Error(`Seed event ${event.slug}: section "${sectionName}" is in two batches`);
        }
        released.add(sectionName);
        section.units.forEach((seatId, index) => {
          data.inventoryUnits.push({
            id: seedId(`unit:${event.slug}:${seatId ?? `${section.id}:${index + 1}`}`),
            eventId: id,
            sectionId: section.id,
            seatId,
            batchId,
            status: 'AVAILABLE',
            priceCents: batch.priceCents,
          });
        });
      }
    }
  }

  return data;
}

/** 0 → "A", 25 → "Z", 26 → "AA", 27 → "AB". */
export function rowLabel(index: number): string {
  let label = '';
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    label = String.fromCharCode(65 + (n % 26)) + label;
  }
  return label;
}
