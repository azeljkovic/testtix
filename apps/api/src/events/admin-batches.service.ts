import { Injectable } from '@nestjs/common';
import type { ProblemFieldError, ReleaseBatchRequest } from '@testtix/shared';

import { ClockService } from '../clock/clock.service.js';
import { ProblemException, validationFailed } from '../errors/problem.exception.js';
import type { Prisma } from '../generated/prisma/client.js';
import { chunks } from '../infra/chunks.js';
import { isUniqueViolation } from '../infra/prisma-errors.js';
import { PrismaService } from '../infra/prisma.service.js';
import { uuidv7 } from '../infra/uuid.js';
import { lockVenue } from '../venues/admin-venues.service.js';
import { loadAdminBatch } from './admin-event-views.js';
import { lockEvent, statusConflict } from './admin-events.service.js';
import type { AdminBatch } from './event.schemas.js';

type Db = Prisma.TransactionClient;

/** A batch can create up to a whole venue of units (`VENUE_LIMITS.totalCapacity`). */
const RELEASE_TRANSACTION_TIMEOUT_MS = 30_000;

interface VenueSection {
  id: string;
  name: string;
  type: 'SEATED' | 'GA';
  capacity: number | null;
}

/** Releases ticket batches: the inventory units customers can then hold and buy. */
@Injectable()
export class AdminBatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  /**
   * Creates a batch and one `AVAILABLE` inventory unit per released seat or GA place, at the
   * batch price. Runs with the event row locked (and the venue row shared, so its layout can't
   * change), so concurrent releases for one event can't release a seat twice or exceed a GA
   * section's capacity.
   *
   * - 400 `validation-error`: a section or seat isn't part of the event's venue, or has the wrong type.
   * - 409 `inventory-already-released`: a listed seat, or every seat of a listed section, is already released.
   * - 409 `ga-capacity-exceeded`: more GA places than the section has left to release.
   * - 409 `event-status-conflict`: the event is cancelled.
   */
  async release(eventId: string, input: ReleaseBatchRequest): Promise<AdminBatch> {
    const now = await this.clock.now();
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const event = await lockEvent(tx, eventId);
          if (event.status === 'CANCELLED') {
            throw statusConflict('Tickets cannot be released for a cancelled event.');
          }
          await lockVenue(tx, event.venueId, 'SHARE');
          const sections = await tx.section.findMany({
            where: { venueId: event.venueId },
            select: { id: true, name: true, type: true, capacity: true },
          });
          const units = await planUnits(tx, eventId, sections, input);

          const batchId = uuidv7(now);
          await tx.ticketBatch.create({
            data: {
              id: batchId,
              eventId,
              name: input.name,
              priceCents: input.priceCents,
              releasesAt: input.releasesAt === undefined ? now : new Date(input.releasesAt),
              createdAt: now,
            },
          });
          const rows = units.map((unit): Prisma.InventoryUnitCreateManyInput => ({
            id: uuidv7(now),
            eventId,
            sectionId: unit.sectionId,
            seatId: unit.seatId,
            batchId,
            status: 'AVAILABLE',
            priceCents: input.priceCents,
          }));
          for (const chunk of chunks(rows)) await tx.inventoryUnit.createMany({ data: chunk });
          return loadAdminBatch(tx, eventId, batchId, now);
        },
        { timeout: RELEASE_TRANSACTION_TIMEOUT_MS },
      );
    } catch (err) {
      // The event lock rules this out; the unique index on (event, seat) is the last line.
      if (isUniqueViolation(err)) throw alreadyReleased([]);
      throw err;
    }
  }
}

interface PlannedUnit {
  sectionId: string;
  seatId: string | null;
}

/**
 * Checks the requested inventory against the venue layout and what earlier batches released, and
 * returns the units to create.
 */
async function planUnits(
  tx: Db,
  eventId: string,
  sections: readonly VenueSection[],
  input: ReleaseBatchRequest,
): Promise<PlannedUnit[]> {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const seatedSectionIds = input.seatedSectionIds ?? [];
  const seatIds = input.seatIds ?? [];
  const gaSections = input.gaSections ?? [];

  // 1. Every reference belongs to the venue and has the right section type.
  const invalid: ProblemFieldError[] = [];
  const checkSection = (path: string, sectionId: string, type: VenueSection['type']) => {
    const section = byId.get(sectionId);
    if (section === undefined) {
      invalid.push({ path, code: 'not_found', message: 'No section with this ID at the venue' });
    } else if (section.type !== type) {
      invalid.push({
        path,
        code: 'invalid_section_type',
        message: type === 'GA' ? 'Not a GA section' : 'Not a seated section',
      });
    }
  };
  seatedSectionIds.forEach((id, index) => {
    checkSection(`seatedSectionIds.${index}`, id, 'SEATED');
  });
  gaSections.forEach((item, index) => {
    checkSection(`gaSections.${index}.sectionId`, item.sectionId, 'GA');
  });

  const seats =
    seatIds.length === 0
      ? []
      : await tx.seat.findMany({
          where: { id: { in: seatIds }, sectionId: { in: [...byId.keys()] } },
          select: { id: true, sectionId: true },
        });
  const seatSection = new Map(seats.map((seat) => [seat.id, seat.sectionId]));
  const wholeSections = new Set(seatedSectionIds);
  seatIds.forEach((id, index) => {
    const sectionId = seatSection.get(id);
    if (sectionId === undefined) {
      invalid.push({
        path: `seatIds.${index}`,
        code: 'not_found',
        message: 'No seat with this ID at the venue',
      });
    } else if (wholeSections.has(sectionId)) {
      invalid.push({
        path: `seatIds.${index}`,
        code: 'duplicate',
        message: 'Its section is already listed in seatedSectionIds',
      });
    }
  });
  if (invalid.length > 0) throw validationFailed(invalid);

  // 2. Nothing is released twice, and GA sections stay within capacity.
  const units: PlannedUnit[] = [];
  const conflicts: ProblemFieldError[] = [];

  if (seatIds.length > 0) {
    const released = new Set(
      (
        await tx.inventoryUnit.findMany({
          where: { eventId, seatId: { in: seatIds } },
          select: { seatId: true },
        })
      ).map((unit) => unit.seatId),
    );
    seatIds.forEach((id, index) => {
      const sectionId = seatSection.get(id);
      if (sectionId === undefined) return; // ruled out by step 1
      if (released.has(id)) {
        conflicts.push({
          path: `seatIds.${index}`,
          code: 'already_released',
          message: 'This seat has already been released',
        });
      } else {
        units.push({ sectionId, seatId: id });
      }
    });
  }

  for (const [index, sectionId] of seatedSectionIds.entries()) {
    const remaining = await tx.seat.findMany({
      where: { sectionId, inventoryUnits: { none: { eventId } } },
      orderBy: [{ rowIndex: 'asc' }, { number: 'asc' }],
      select: { id: true },
    });
    if (remaining.length === 0) {
      conflicts.push({
        path: `seatedSectionIds.${index}`,
        code: 'already_released',
        message: 'Every seat in this section has already been released',
      });
    }
    units.push(...remaining.map((seat) => ({ sectionId, seatId: seat.id })));
  }

  const capacityErrors: ProblemFieldError[] = [];
  for (const [index, { sectionId, quantity }] of gaSections.entries()) {
    const section = byId.get(sectionId);
    const released = await tx.inventoryUnit.count({ where: { eventId, sectionId } });
    const left = (section?.capacity ?? 0) - released;
    if (quantity > left) {
      capacityErrors.push({
        path: `gaSections.${index}.quantity`,
        code: 'too_big',
        message: `Only ${left} place${left === 1 ? '' : 's'} left to release in ${section?.name ?? 'this section'}`,
      });
    }
    units.push(...Array.from({ length: quantity }, () => ({ sectionId, seatId: null })));
  }

  if (conflicts.length > 0) throw alreadyReleased(conflicts);
  if (capacityErrors.length > 0) {
    throw new ProblemException(
      'GA_CAPACITY_EXCEEDED',
      409,
      'GA capacity exceeded',
      'More general-admission places were requested than the section has left to release.',
      capacityErrors,
    );
  }
  return units;
}

function alreadyReleased(errors: ProblemFieldError[]): ProblemException {
  return new ProblemException(
    'INVENTORY_ALREADY_RELEASED',
    409,
    'Inventory already released',
    'Some of the requested seats have already been released for this event. See `errors`.',
    errors,
  );
}
