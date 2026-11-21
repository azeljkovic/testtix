import type { Prisma } from '../generated/prisma/client.js';
import {
  type DayTime,
  EVENT_SPECS,
  type EventSpec,
  SEED_CITY,
  SEED_TIMEZONE,
  type SectionSpec,
  USER_SPECS,
  userId,
  VENUE_SPECS,
  type VenueSpec,
} from './fixtures.js';
import { generateEventSpecs } from './generated-events.js';
import { seedId } from './seed-id.js';

/** Every row the baseline seed inserts, table by table, in insertion order. */
export interface SeedData {
  users: Prisma.UserCreateManyInput[];
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
  const createdAt: DayTime = [-90, '12:00'];
  const catalogue = buildCatalogue(now, {
    venues: VENUE_SPECS,
    events: [...EVENT_SPECS, ...generateEventSpecs()],
    id: seedId,
    createdAt,
  });
  const userCreatedAt = dayAt(now, createdAt);
  catalogue.users = USER_SPECS.map((user) => ({
    id: userId(user.email),
    email: user.email,
    passwordHash: user.passwordHash,
    name: user.name,
    role: user.role,
    emailVerifiedAt: user.emailVerified ? userCreatedAt : null,
    createdAt: userCreatedAt,
    updatedAt: userCreatedAt,
  }));
  return catalogue;
}

/** An event to build. Like `EventSpec`, but at any venue, not only a seeded one. */
export type CatalogueEventSpec = Omit<EventSpec, 'venue'> & { readonly venue: string };

export interface CatalogueSpec {
  readonly venues: readonly VenueSpec[];
  /** Each event's `venue` is the slug of one of `venues`. */
  readonly events: readonly CatalogueEventSpec[];
  /**
   * The ID of the row with this key, e.g. `venue:<slug>` or `unit:<event slug>:<seat ID>`. The
   * baseline uses `seedId` (stable IDs); test scenarios use random ones.
   */
  readonly id: (key: string) => string;
  /** `createdAt` (and `updatedAt`) of every row: a time relative to the seed day, or exact. */
  readonly createdAt: DayTime | Date;
}

/**
 * Builds venues (with their sections and seats) and events (with their batches and one
 * `AVAILABLE` inventory unit per seat or GA place of every released section). Dates in the specs
 * are relative to the start of `now`'s UTC day. Shared by the baseline seed and the test API's
 * scenarios (`src/test-api/scenarios/`).
 */
export function buildCatalogue(now: Date, spec: CatalogueSpec): SeedData {
  const at = (dayTime: DayTime): Date => dayAt(now, dayTime);
  const { id: rowId } = spec;
  const createdAt = spec.createdAt instanceof Date ? spec.createdAt : at(spec.createdAt);

  const data: SeedData = {
    users: [],
    venues: [],
    sections: [],
    seats: [],
    events: [],
    ticketBatches: [],
    inventoryUnits: [],
  };

  /** Per venue and section name: the section's ID and what its inventory units point at. */
  const layouts = new Map<string, Map<string, { id: string; units: (string | null)[] }>>();

  for (const venue of spec.venues) {
    const id = rowId(`venue:${venue.slug}`);
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
      const sectionId = rowId(`section:${venue.slug}:${section.name}`);
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
          const seatId = rowId(`seat:${venue.slug}:${section.name}:${row}${number}`);
          data.seats.push({ id: seatId, sectionId, row, rowIndex, number });
          seatIds.push(seatId);
        }
      }
      sections.set(section.name, { id: sectionId, units: seatIds });
    });
    layouts.set(venue.slug, sections);
  }

  for (const event of spec.events) {
    const id = rowId(`event:${event.slug}`);
    const startsAt = at(event.starts);
    data.events.push({
      id,
      slug: event.slug,
      title: event.title,
      performer: event.performer,
      description: event.description,
      category: event.category,
      status: event.status,
      venueId: rowId(`venue:${event.venue}`),
      startsAt,
      endsAt: new Date(startsAt.getTime() + event.durationMin * MINUTE_MS),
      salesOpenAt: at(event.salesOpen),
      createdAt,
      updatedAt: createdAt,
    });

    const layout = layouts.get(event.venue);
    const released = new Set<string>();
    for (const batch of event.batches) {
      const batchId = rowId(`batch:${event.slug}:${batch.name}`);
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
            id: rowId(`unit:${event.slug}:${seatId ?? `${section.id}:${index + 1}`}`),
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

/** `dayTime` (days and `HH:MM` UTC) after the start of `now`'s UTC day. */
export function dayAt(now: Date, [days, time]: DayTime): Date {
  const dayStart = now.getTime() - (((now.getTime() % DAY_MS) + DAY_MS) % DAY_MS);
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return new Date(dayStart + days * DAY_MS + (hours * 60 + minutes) * MINUTE_MS);
}

/** 0 → "A", 25 → "Z", 26 → "AA", 27 → "AB". */
export function rowLabel(index: number): string {
  let label = '';
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    label = String.fromCharCode(65 + (n % 26)) + label;
  }
  return label;
}
