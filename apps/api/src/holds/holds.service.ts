import { Injectable, NotFoundException } from '@nestjs/common';
import {
  HOLD_MESSAGES,
  type HoldRequest,
  holdTicketCount,
  type ProblemFieldError,
  type TicketsUnavailableProblem,
} from '@testtix/shared';

import { ClockService } from '../clock/clock.service.js';
import { ProblemException, validationFailed } from '../errors/problem.exception.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';
import { uuidv7 } from '../infra/uuid.js';
import { deleteHold, lockHoldUnits, lockUserEvent } from './hold-locks.js';
import type { Hold } from './holds.schemas.js';
import { publishedEventNotFound } from './seat-map.service.js';

type Db = Prisma.TransactionClient;

interface HoldableEvent {
  id: string;
  venueId: string;
  salesOpenAt: Date;
  startsAt: Date;
  holdDurationSec: number;
  maxTicketsPerOrder: number;
}

/**
 * Customers' holds (C3.1): a temporary, all-or-nothing claim on seats and GA places. A unit is
 * claimable when its batch is released and it is `AVAILABLE`, or `HELD` by a hold that has
 * expired (`heldUntil <= now`, lazy expiry: correctness never waits for `HoldSweeperService`).
 *
 * Concurrency, all inside one transaction per request:
 *
 * - The event row is share-locked, so holds run in parallel with each other but not with an admin
 *   change to the event (which takes `lockEvent()`'s exclusive lock).
 * - One user's requests for one event run one at a time (an advisory lock), so "one hold per user
 *   and event, a new one replaces the old" needs no unique-violation handling.
 * - Units that may have to be waited for (the user's previous hold, the requested seats) are
 *   locked in ID order first, so two requests can't deadlock on each other's seats.
 * - Each claim is a conditional `UPDATE` that re-checks claimability, so of several requests for
 *   one seat exactly one wins. GA places are picked with `FOR UPDATE SKIP LOCKED`, so concurrent
 *   GA requests take different places instead of queueing on the same ones.
 * - Anything not claimable throws, which rolls back everything, the release of the previous hold
 *   included: a failed request leaves the user's old hold as it was.
 */
@Injectable()
export class HoldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  async create(userId: string, eventId: string, input: HoldRequest): Promise<Hold> {
    const now = await this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const event = await shareLockPublishedEvent(tx, eventId);
      if (event.startsAt.getTime() <= now.getTime()) {
        throw notOnSale('The event has started: sales have ended.');
      }
      if (event.salesOpenAt.getTime() > now.getTime()) {
        throw notOnSale('Sales for this event have not opened yet.');
      }
      if (holdTicketCount(input) > event.maxTicketsPerOrder) {
        throw validationFailed([
          { path: '', code: 'too_big', message: HOLD_MESSAGES.tooMany(event.maxTicketsPerOrder) },
        ]);
      }
      await requireVenueLayout(tx, event.venueId, input);

      await lockUserEvent(tx, userId, eventId);
      const previous = await tx.hold.findUnique({
        where: { eventId_userId: { eventId, userId } },
        select: { id: true },
      });
      await tx.$queryRaw`
        SELECT id FROM inventory_units
        WHERE event_id = ${eventId}::uuid
          AND (hold_id = ${previous?.id ?? null}::uuid OR seat_id = ANY(${input.seats}::uuid[]))
        ORDER BY id
        FOR UPDATE`;
      if (previous !== null) await deleteHold(tx, previous.id);

      const holdId = uuidv7(now);
      const expiresAt = new Date(now.getTime() + event.holdDurationSec * 1000);
      await tx.hold.create({
        data: { id: holdId, eventId, userId, expiresAt, createdAt: now },
      });
      const claim = { eventId, holdId, expiresAt, now };
      const unavailableSeatIds = await claimSeats(tx, claim, input.seats);
      const gaShortfalls: TicketsUnavailableProblem['gaShortfalls'] = [];
      for (const { sectionId, quantity } of input.ga) {
        const claimed = await claimGaPlaces(tx, claim, sectionId, quantity);
        if (claimed < quantity)
          gaShortfalls.push({ sectionId, requested: quantity, available: claimed });
      }
      if (unavailableSeatIds.length > 0 || gaShortfalls.length > 0) {
        throw ticketsUnavailable(unavailableSeatIds, gaShortfalls);
      }
      return loadHold(tx, holdId);
    });
  }

  /**
   * The user's active (unexpired) hold for `eventId`, or their most recent active hold of any
   * event. 404 when there is none.
   */
  async current(userId: string, eventId: string | undefined): Promise<Hold> {
    const now = await this.clock.now();
    return this.prisma.$transaction(
      async (tx) => {
        const hold = await tx.hold.findFirst({
          where: { userId, expiresAt: { gt: now }, ...(eventId === undefined ? {} : { eventId }) },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        });
        if (hold === null) throw new NotFoundException('You have no active hold.');
        return loadHold(tx, hold.id);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  /**
   * Releases one of the user's holds: its tickets become available at once. Expired holds can be
   * released too (a no-op for tickets someone else has claimed since). 404 for other users' holds.
   */
  async release(userId: string, holdId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const hold = await tx.hold.findFirst({
        where: { id: holdId, userId },
        select: { eventId: true },
      });
      if (hold === null) throw holdNotFound();
      await lockUserEvent(tx, userId, hold.eventId);
      await lockHoldUnits(tx, holdId);
      // Gone if a concurrent request of the same user (or the sweeper) deleted it meanwhile.
      if ((await deleteHold(tx, holdId)).holds === 0) throw holdNotFound();
    });
  }
}

function holdNotFound(): NotFoundException {
  return new NotFoundException('You have no hold with this ID.');
}

function notOnSale(detail: string): ProblemException {
  return new ProblemException('EVENT_NOT_ON_SALE', 409, 'Event not on sale', detail);
}

function ticketsUnavailable(
  unavailableSeatIds: string[],
  gaShortfalls: TicketsUnavailableProblem['gaShortfalls'],
): ProblemException {
  const parts: string[] = [];
  if (unavailableSeatIds.length > 0) {
    parts.push(
      unavailableSeatIds.length === 1
        ? 'A seat is no longer available.'
        : `${unavailableSeatIds.length} seats are no longer available.`,
    );
  }
  for (const { available } of gaShortfalls) {
    parts.push(
      available === 0
        ? 'A general-admission section has no places left.'
        : `A general-admission section has only ${available} ${available === 1 ? 'place' : 'places'} left.`,
    );
  }
  return new ProblemException(
    'TICKETS_UNAVAILABLE',
    409,
    'Tickets unavailable',
    `${parts.join(' ')} Nothing was held.`,
    [],
    { unavailableSeatIds, gaShortfalls },
  );
}

/** Share-locks the event until the transaction ends and returns it. 404 unless it is published. */
async function shareLockPublishedEvent(tx: Db, eventId: string): Promise<HoldableEvent> {
  const rows = await tx.$queryRaw<HoldableEvent[]>`
    SELECT id, venue_id AS "venueId", sales_open_at AS "salesOpenAt", starts_at AS "startsAt",
      hold_duration_sec AS "holdDurationSec", max_tickets_per_order AS "maxTicketsPerOrder"
    FROM events
    WHERE id = ${eventId}::uuid AND status = 'PUBLISHED'
    FOR SHARE`;
  const [event] = rows;
  if (event === undefined) throw publishedEventNotFound();
  return event;
}

/**
 * 400 for seats that aren't at the event's venue and sections that aren't GA sections there.
 * (Seats of the venue that the event doesn't sell are a 409 later, like taken seats.)
 */
async function requireVenueLayout(tx: Db, venueId: string, input: HoldRequest): Promise<void> {
  const errors: ProblemFieldError[] = [];
  if (input.seats.length > 0) {
    const found = await tx.seat.findMany({
      where: { id: { in: input.seats }, section: { venueId } },
      select: { id: true },
    });
    const known = new Set(found.map((seat) => seat.id));
    input.seats.forEach((seatId, index) => {
      if (!known.has(seatId)) {
        errors.push({
          path: `seats.${String(index)}`,
          code: 'not_found',
          message: 'No seat with this ID at the event’s venue',
        });
      }
    });
  }
  if (input.ga.length > 0) {
    const found = await tx.section.findMany({
      where: { id: { in: input.ga.map((item) => item.sectionId) }, venueId, type: 'GA' },
      select: { id: true },
    });
    const known = new Set(found.map((section) => section.id));
    input.ga.forEach(({ sectionId }, index) => {
      if (!known.has(sectionId)) {
        errors.push({
          path: `ga.${String(index)}.sectionId`,
          code: 'not_found',
          message: 'No general-admission section with this ID at the event’s venue',
        });
      }
    });
  }
  if (errors.length > 0) throw validationFailed(errors);
}

interface Claim {
  eventId: string;
  holdId: string;
  expiresAt: Date;
  now: Date;
}

/** Claims the units of `seatIds`. Returns the seats that couldn't be claimed, in request order. */
async function claimSeats(tx: Db, claim: Claim, seatIds: readonly string[]): Promise<string[]> {
  if (seatIds.length === 0) return [];
  const claimed = await tx.$queryRaw<{ seatId: string }[]>`
    UPDATE inventory_units u
    SET status = 'HELD', hold_id = ${claim.holdId}::uuid, held_until = ${claim.expiresAt}
    FROM ticket_batches b
    WHERE b.id = u.batch_id
      AND u.event_id = ${claim.eventId}::uuid
      AND u.seat_id = ANY(${seatIds}::uuid[])
      AND b.releases_at <= ${claim.now}
      AND (u.status = 'AVAILABLE' OR (u.status = 'HELD' AND u.held_until <= ${claim.now}))
    RETURNING u.seat_id AS "seatId"`;
  const won = new Set(claimed.map((row) => row.seatId));
  return seatIds.filter((seatId) => !won.has(seatId));
}

/**
 * Claims up to `quantity` claimable places of a GA section, cheapest first, skipping places that
 * concurrent requests have locked. Returns how many were claimed; when that is less than
 * `quantity`, the caller rolls back.
 */
async function claimGaPlaces(
  tx: Db,
  claim: Claim,
  sectionId: string,
  quantity: number,
): Promise<number> {
  const picked = await tx.$queryRaw<{ id: string }[]>`
    SELECT u.id
    FROM inventory_units u
    JOIN ticket_batches b ON b.id = u.batch_id
    WHERE u.event_id = ${claim.eventId}::uuid
      AND u.section_id = ${sectionId}::uuid
      AND u.seat_id IS NULL
      AND b.releases_at <= ${claim.now}
      AND (u.status = 'AVAILABLE' OR (u.status = 'HELD' AND u.held_until <= ${claim.now}))
    ORDER BY u.price_cents, u.id
    LIMIT ${quantity}
    FOR UPDATE OF u SKIP LOCKED`;
  if (picked.length < quantity) return picked.length;
  // The rows are locked by this transaction, so the condition still holds; it is re-checked anyway.
  return tx.$executeRaw`
    UPDATE inventory_units
    SET status = 'HELD', hold_id = ${claim.holdId}::uuid, held_until = ${claim.expiresAt}
    WHERE id = ANY(${picked.map((row) => row.id)}::uuid[])
      AND (status = 'AVAILABLE' OR (status = 'HELD' AND held_until <= ${claim.now}))`;
}

async function loadHold(tx: Db, holdId: string): Promise<Hold> {
  const hold = await tx.hold.findUniqueOrThrow({
    where: { id: holdId },
    select: {
      id: true,
      eventId: true,
      expiresAt: true,
      createdAt: true,
      inventoryUnits: {
        select: {
          id: true,
          priceCents: true,
          section: { select: { id: true, name: true, type: true } },
          seat: { select: { id: true, row: true, number: true } },
        },
        orderBy: [
          { section: { sortOrder: 'asc' } },
          { seat: { rowIndex: 'asc' } },
          { seat: { number: 'asc' } },
          { priceCents: 'asc' },
          { id: 'asc' },
        ],
      },
    },
  });
  const items = hold.inventoryUnits.map((unit) => ({
    inventoryUnitId: unit.id,
    section: unit.section,
    seat: unit.seat,
    priceCents: unit.priceCents,
  }));
  return {
    id: hold.id,
    eventId: hold.eventId,
    expiresAt: hold.expiresAt.toISOString(),
    createdAt: hold.createdAt.toISOString(),
    totalCents: items.reduce((sum, item) => sum + item.priceCents, 0),
    items,
  };
}
