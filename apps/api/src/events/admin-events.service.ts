import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreateEventRequest,
  EVENT_SCHEDULE_MESSAGES,
  eventScheduleIssues,
  HOLD_DURATION_SEC,
  MAX_TICKETS_PER_ORDER,
  type Page,
  pageWindow,
  type ProblemFieldError,
  slugify,
  toPage,
  type UpdateEventRequest,
} from '@testtix/shared';

import { ClockService } from '../clock/clock.service.js';
import { ProblemException, validationFailed } from '../errors/problem.exception.js';
import type { Event, EventStatus, Prisma } from '../generated/prisma/client.js';
import { isForeignKeyViolation, isUniqueViolation } from '../infra/prisma-errors.js';
import { PrismaService } from '../infra/prisma.service.js';
import { insertWithSlug, slugTaken } from '../infra/slugs.js';
import { uuidv7 } from '../infra/uuid.js';
import { loadAdminEvent, SUMMARY_INCLUDE, toAdminEventSummaries } from './admin-event-views.js';
import type { AdminEvent, AdminEventListQuery, AdminEventSummary } from './event.schemas.js';

type Db = Prisma.TransactionClient;

const NO_VENUE: ProblemFieldError = {
  path: 'venueId',
  code: 'not_found',
  message: 'No venue with this ID',
};

/**
 * Admin CRUD and lifecycle of events: `DRAFT` ⇄ `PUBLISHED` → `CANCELLED` (and `DRAFT` →
 * `CANCELLED`). Every change locks the event row first, so concurrent changes (and batch
 * releases) to one event run one after the other and each sees the other's result.
 */
@Injectable()
export class AdminEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  /** Events of every status, by start time (then ID). */
  async list(query: AdminEventListQuery): Promise<Page<AdminEventSummary>> {
    const now = await this.clock.now();
    const where: Prisma.EventWhereInput = { status: query.status, venueId: query.venueId };
    const [events, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        include: SUMMARY_INCLUDE,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        ...pageWindow(query),
      }),
      this.prisma.event.count({ where }),
    ]);
    return toPage(await toAdminEventSummaries(this.prisma, events, now), total, query);
  }

  async get(eventId: string): Promise<AdminEvent> {
    const event = await loadAdminEvent(this.prisma, eventId, await this.clock.now());
    if (event === null) throw eventNotFound();
    return event;
  }

  /** Creates a `DRAFT` event. It starts in the future and its venue exists (else 400). */
  async create(input: CreateEventRequest): Promise<AdminEvent> {
    const now = await this.clock.now();
    const startsAt = new Date(input.startsAt);
    const errors: ProblemFieldError[] = [];
    if (startsAt.getTime() <= now.getTime()) errors.push(startsInPast());
    const venue = await this.prisma.venue.findUnique({ where: { id: input.venueId } });
    if (venue === null) errors.push(NO_VENUE);
    if (errors.length > 0) throw validationFailed(errors);

    const event = await insertWithSlug({
      slug: input.slug,
      base: slugify(input.title, 'event'),
      takenLike: async (base) =>
        (
          await this.prisma.event.findMany({
            where: { OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }] },
            select: { slug: true },
          })
        ).map((row) => row.slug),
      insert: async (slug) => {
        try {
          return await this.prisma.event.create({
            data: {
              id: uuidv7(now),
              slug,
              title: input.title,
              performer: input.performer,
              description: input.description,
              category: input.category,
              status: 'DRAFT',
              venueId: input.venueId,
              startsAt,
              endsAt: new Date(input.endsAt),
              salesOpenAt: new Date(input.salesOpenAt),
              holdDurationSec: input.holdDurationSec ?? HOLD_DURATION_SEC.default,
              maxTicketsPerOrder: input.maxTicketsPerOrder ?? MAX_TICKETS_PER_ORDER.default,
              createdAt: now,
              updatedAt: now,
            },
          });
        } catch (err) {
          // The venue was deleted since the check above.
          if (isForeignKeyViolation(err)) throw validationFailed([NO_VENUE]);
          throw err;
        }
      },
    });
    return this.get(event.id);
  }

  /**
   * Changes the fields sent. The time rules apply to the merged result, and a new `startsAt`
   * must be in the future. `venueId` can only change before the first batch (409
   * `layout-locked`). Cancelled events can't change.
   */
  async update(eventId: string, input: UpdateEventRequest): Promise<AdminEvent> {
    const now = await this.clock.now();
    try {
      await this.prisma.$transaction(async (tx) => {
        const event = await lockEvent(tx, eventId);
        if (event.status === 'CANCELLED') {
          throw statusConflict('Cancelled events cannot be changed.');
        }

        const errors: ProblemFieldError[] = [];
        const startsAt = input.startsAt === undefined ? event.startsAt : new Date(input.startsAt);
        const endsAt = input.endsAt === undefined ? event.endsAt : new Date(input.endsAt);
        const salesOpenAt =
          input.salesOpenAt === undefined ? event.salesOpenAt : new Date(input.salesOpenAt);
        if (input.startsAt !== undefined && startsAt.getTime() <= now.getTime()) {
          errors.push(startsInPast());
        }
        for (const issue of eventScheduleIssues({ startsAt, endsAt, salesOpenAt })) {
          errors.push({ path: issue.path, code: 'custom', message: issue.message });
        }
        const venueChanges = input.venueId !== undefined && input.venueId !== event.venueId;
        if (
          venueChanges &&
          (await tx.venue.findUnique({ where: { id: input.venueId } })) === null
        ) {
          errors.push(NO_VENUE);
        }
        if (errors.length > 0) throw validationFailed(errors);
        if (venueChanges && (await tx.ticketBatch.count({ where: { eventId } })) > 0) {
          throw new ProblemException(
            'LAYOUT_LOCKED',
            409,
            'Layout locked',
            'The venue cannot change: tickets have been released for this event.',
            [
              {
                path: 'venueId',
                code: 'layout_locked',
                message: 'Tickets have been released for this event',
              },
            ],
          );
        }

        await tx.event.update({
          where: { id: eventId },
          data: {
            slug: input.slug,
            title: input.title,
            performer: input.performer,
            description: input.description,
            category: input.category,
            venueId: input.venueId,
            startsAt,
            endsAt,
            salesOpenAt,
            holdDurationSec: input.holdDurationSec,
            maxTicketsPerOrder: input.maxTicketsPerOrder,
            updatedAt: now,
          },
        });
      });
    } catch (err) {
      if (input.slug !== undefined && isUniqueViolation(err)) throw slugTaken(input.slug);
      if (isForeignKeyViolation(err)) throw validationFailed([NO_VENUE]);
      throw err;
    }
    return this.get(eventId);
  }

  /**
   * `DRAFT` → `PUBLISHED`. Needs at least one batch (409 `event-has-no-batches`) and a start in
   * the future (409 `event-already-started`).
   */
  async publish(eventId: string): Promise<AdminEvent> {
    return this.transition(eventId, async (tx, event, now) => {
      requireStatus(event, ['DRAFT'], 'Only draft events can be published.');
      if ((await tx.ticketBatch.count({ where: { eventId } })) === 0) {
        throw new ProblemException(
          'EVENT_HAS_NO_BATCHES',
          409,
          'Event has no batches',
          'Release at least one ticket batch before publishing the event.',
        );
      }
      if (event.startsAt.getTime() <= now.getTime()) {
        throw new ProblemException(
          'EVENT_ALREADY_STARTED',
          409,
          'Event already started',
          'An event that has already started cannot be published.',
        );
      }
      return 'PUBLISHED';
    });
  }

  /**
   * `PUBLISHED` → `DRAFT`, hiding the event from the catalogue. Only while no ticket is sold or
   * in an unexpired hold (409 `event-has-sales`); cancel the event instead.
   */
  async unpublish(eventId: string): Promise<AdminEvent> {
    return this.transition(eventId, async (tx, event, now) => {
      requireStatus(event, ['PUBLISHED'], 'Only published events can be unpublished.');
      await requireNoSales(tx, eventId, now, 'unpublished');
      return 'DRAFT';
    });
  }

  /** `DRAFT` or `PUBLISHED` → `CANCELLED`. Final: a cancelled event can't change again. */
  async cancel(eventId: string): Promise<AdminEvent> {
    return this.transition(eventId, (_tx, event) => {
      requireStatus(event, ['DRAFT', 'PUBLISHED'], 'The event is already cancelled.');
      return Promise.resolve('CANCELLED' as const);
    });
  }

  /**
   * Deletes a `DRAFT` event with its batches and inventory. 409 `event-has-sales` when it has
   * orders or tickets sold or held (possible after unpublishing).
   */
  async delete(eventId: string): Promise<void> {
    const now = await this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      const event = await lockEvent(tx, eventId);
      requireStatus(event, ['DRAFT'], 'Only draft events can be deleted; cancel it instead.');
      await requireNoSales(tx, eventId, now, 'deleted');
      if ((await tx.order.count({ where: { eventId } })) > 0) {
        throw hasSales('The event has orders and cannot be deleted; cancel it instead.');
      }
      await tx.event.delete({ where: { id: eventId } });
    });
  }

  private async transition(
    eventId: string,
    check: (tx: Db, event: Event, now: Date) => Promise<EventStatus>,
  ): Promise<AdminEvent> {
    const now = await this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      const event = await lockEvent(tx, eventId);
      const status = await check(tx, event, now);
      await tx.event.update({ where: { id: eventId }, data: { status, updatedAt: now } });
    });
    return this.get(eventId);
  }
}

export function eventNotFound(): NotFoundException {
  return new NotFoundException('No event with this ID.');
}

/** Locks the event row until the transaction ends and returns it, or answers 404. */
export async function lockEvent(tx: Db, eventId: string): Promise<Event> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE`;
  if (locked.length === 0) throw eventNotFound();
  return tx.event.findUniqueOrThrow({ where: { id: eventId } });
}

export function statusConflict(detail: string): ProblemException {
  return new ProblemException('EVENT_STATUS_CONFLICT', 409, 'Event status conflict', detail);
}

function requireStatus(event: Event, allowed: readonly EventStatus[], detail: string): void {
  if (!allowed.includes(event.status)) {
    throw statusConflict(`${detail} The event is ${event.status}.`);
  }
}

function hasSales(detail: string): ProblemException {
  return new ProblemException('EVENT_HAS_SALES', 409, 'Event has sales', detail);
}

async function requireNoSales(tx: Db, eventId: string, now: Date, verb: string): Promise<void> {
  const active = await tx.inventoryUnit.count({
    where: {
      eventId,
      OR: [{ status: 'SOLD' }, { status: 'HELD', heldUntil: { gt: now } }],
    },
  });
  if (active > 0) {
    throw hasSales(
      `${active} ticket${active === 1 ? ' is' : 's are'} sold or held, so the event cannot be ${verb}; cancel it instead.`,
    );
  }
}

function startsInPast(): ProblemFieldError {
  return { path: 'startsAt', code: 'custom', message: EVENT_SCHEDULE_MESSAGES.startsInPast };
}
