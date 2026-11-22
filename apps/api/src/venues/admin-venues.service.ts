import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreateVenueRequest,
  type Page,
  type PageQuery,
  pageWindow,
  type SectionInput,
  slugify,
  toPage,
  type UpdateVenueRequest,
} from '@testtix/shared';

import { ClockService } from '../clock/clock.service.js';
import { ProblemException } from '../errors/problem.exception.js';
import type { Prisma } from '../generated/prisma/client.js';
import { chunks } from '../infra/chunks.js';
import { isUniqueViolation } from '../infra/prisma-errors.js';
import { PrismaService } from '../infra/prisma.service.js';
import { insertWithSlug, slugTaken } from '../infra/slugs.js';
import { uuidv7 } from '../infra/uuid.js';
import { buildVenueLayout } from './venue-layout.js';
import type { AdminVenue, AdminVenueSummary } from './venue.schemas.js';

type Db = Prisma.TransactionClient;

const SUMMARY_INCLUDE = {
  sections: { orderBy: { sortOrder: 'asc' }, include: { _count: { select: { seats: true } } } },
} as const satisfies Prisma.VenueInclude;

const DETAIL_INCLUDE = {
  sections: {
    orderBy: { sortOrder: 'asc' },
    include: {
      seats: {
        orderBy: [{ rowIndex: 'asc' }, { number: 'asc' }],
        select: { id: true, row: true, number: true },
      },
    },
  },
} as const satisfies Prisma.VenueInclude;

type VenueWithCounts = Prisma.VenueGetPayload<{ include: typeof SUMMARY_INCLUDE }>;
type VenueWithSeats = Prisma.VenueGetPayload<{ include: typeof DETAIL_INCLUDE }>;

/** Transactions that write a whole layout (up to `VENUE_LIMITS.totalCapacity` seats). */
const LAYOUT_TRANSACTION_TIMEOUT_MS = 30_000;

/** Admin CRUD for venues and their layouts (sections and seats). */
@Injectable()
export class AdminVenuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  /** Venues by name (then ID). */
  async list(query: PageQuery): Promise<Page<AdminVenueSummary>> {
    const [venues, total] = await this.prisma.$transaction([
      this.prisma.venue.findMany({
        include: SUMMARY_INCLUDE,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...pageWindow(query),
      }),
      this.prisma.venue.count(),
    ]);
    const locked = await lockedVenueIds(
      this.prisma,
      venues.map((venue) => venue.id),
    );
    return toPage(
      venues.map((venue) => toVenueSummary(venue, locked.has(venue.id))),
      total,
      query,
    );
  }

  async get(venueId: string): Promise<AdminVenue> {
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      include: DETAIL_INCLUDE,
    });
    if (venue === null) throw venueNotFound();
    const locked = await lockedVenueIds(this.prisma, [venue.id]);
    return toVenue(venue, locked.has(venue.id));
  }

  async create(input: CreateVenueRequest): Promise<AdminVenue> {
    const now = await this.clock.now();
    const venueId = await insertWithSlug({
      slug: input.slug,
      base: slugify(input.name, 'venue'),
      takenLike: async (base) =>
        (
          await this.prisma.venue.findMany({
            where: { OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }] },
            select: { slug: true },
          })
        ).map((venue) => venue.slug),
      insert: (slug) =>
        this.prisma.$transaction(
          async (tx) => {
            const id = uuidv7(now);
            await tx.venue.create({
              data: {
                id,
                slug,
                name: input.name,
                address: input.address,
                city: input.city,
                timezone: input.timezone,
                createdAt: now,
              },
            });
            await insertLayout(tx, id, input.sections, now);
            return id;
          },
          { timeout: LAYOUT_TRANSACTION_TIMEOUT_MS },
        ),
    });
    return this.get(venueId);
  }

  /**
   * Changes the fields sent. A new `sections` list replaces the layout, which is only allowed
   * while no inventory exists for any event at the venue (409 `layout-locked`).
   */
  async update(venueId: string, input: UpdateVenueRequest): Promise<AdminVenue> {
    const now = await this.clock.now();
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await lockVenue(tx, venueId, 'UPDATE');
          await tx.venue.update({
            where: { id: venueId },
            data: {
              slug: input.slug,
              name: input.name,
              address: input.address,
              city: input.city,
              timezone: input.timezone,
            },
          });
          if (input.sections === undefined) return;
          if ((await lockedVenueIds(tx, [venueId])).size > 0) {
            throw new ProblemException(
              'LAYOUT_LOCKED',
              409,
              'Layout locked',
              'The layout cannot change: tickets have been released for an event at this venue.',
              [
                {
                  path: 'sections',
                  code: 'layout_locked',
                  message: 'Tickets have been released for an event at this venue',
                },
              ],
            );
          }
          await tx.section.deleteMany({ where: { venueId } });
          await insertLayout(tx, venueId, input.sections, now);
        },
        { timeout: LAYOUT_TRANSACTION_TIMEOUT_MS },
      );
    } catch (err) {
      if (input.slug !== undefined && isUniqueViolation(err)) throw slugTaken(input.slug);
      throw err;
    }
    return this.get(venueId);
  }

  /** Deletes a venue that no event uses (else 409 `venue-in-use`). */
  async delete(venueId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockVenue(tx, venueId, 'UPDATE');
      const events = await tx.event.count({ where: { venueId } });
      if (events > 0) {
        throw new ProblemException(
          'VENUE_IN_USE',
          409,
          'Venue in use',
          `The venue cannot be deleted: ${events} event${events === 1 ? '' : 's'} use it.`,
        );
      }
      await tx.venue.delete({ where: { id: venueId } });
    });
  }
}

export function venueNotFound(): NotFoundException {
  return new NotFoundException('No venue with this ID.');
}

/**
 * Locks the venue row until the transaction ends, or answers 404. `UPDATE` for layout changes and
 * deletion; `SHARE` while releasing inventory against the layout, so the layout can't change
 * underneath.
 */
export async function lockVenue(tx: Db, venueId: string, mode: 'UPDATE' | 'SHARE'): Promise<void> {
  const rows =
    mode === 'UPDATE'
      ? await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM venues WHERE id = ${venueId}::uuid FOR UPDATE`
      : await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM venues WHERE id = ${venueId}::uuid FOR SHARE`;
  if (rows.length === 0) throw venueNotFound();
}

/** The venues among `venueIds` that have inventory for some event: their layout is locked. */
async function lockedVenueIds(db: Db, venueIds: string[]): Promise<Set<string>> {
  if (venueIds.length === 0) return new Set();
  const sections = await db.section.findMany({
    where: { venueId: { in: venueIds }, inventoryUnits: { some: {} } },
    select: { venueId: true },
    distinct: ['venueId'],
  });
  return new Set(sections.map((section) => section.venueId));
}

async function insertLayout(
  tx: Db,
  venueId: string,
  sections: readonly SectionInput[],
  now: Date,
): Promise<void> {
  const layout = buildVenueLayout(venueId, sections, () => uuidv7(now));
  await tx.section.createMany({ data: layout.sections });
  for (const seats of chunks(layout.seats)) await tx.seat.createMany({ data: seats });
}

function sectionCapacity(section: { type: string; capacity: number | null }, seats: number) {
  return section.type === 'GA' ? (section.capacity ?? 0) : seats;
}

function toVenueSummary(venue: VenueWithCounts, layoutLocked: boolean): AdminVenueSummary {
  const sections = venue.sections.map((section) => ({
    id: section.id,
    name: section.name,
    type: section.type,
    capacity: sectionCapacity(section, section._count.seats),
  }));
  return {
    ...venueFields(venue, layoutLocked),
    capacity: sections.reduce((sum, section) => sum + section.capacity, 0),
    sections,
  };
}

function toVenue(venue: VenueWithSeats, layoutLocked: boolean): AdminVenue {
  const sections = venue.sections.map((section) => ({
    id: section.id,
    name: section.name,
    type: section.type,
    capacity: sectionCapacity(section, section.seats.length),
    seats: section.seats,
  }));
  return {
    ...venueFields(venue, layoutLocked),
    capacity: sections.reduce((sum, section) => sum + section.capacity, 0),
    sections,
  };
}

function venueFields(
  venue: VenueWithCounts | VenueWithSeats,
  layoutLocked: boolean,
): Omit<AdminVenueSummary, 'capacity' | 'sections'> {
  return {
    id: venue.id,
    slug: venue.slug,
    name: venue.name,
    address: venue.address,
    city: venue.city,
    timezone: venue.timezone,
    layoutLocked,
    createdAt: venue.createdAt.toISOString(),
  };
}
