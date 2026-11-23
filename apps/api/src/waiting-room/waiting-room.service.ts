import {
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ADMISSION_TOKEN_HEADER } from '@testtix/shared';

import { ClockService } from '../clock/clock.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { ProblemException } from '../errors/problem.exception.js';
import { publishedEventNotFound } from '../holds/seat-map.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { QueueStore } from './queue-store.js';
import { toQueueEntry } from './queue-views.js';
import type { QueueEntry } from './waiting-room.schemas.js';

const QUEUE_EVENT_SELECT = {
  status: true,
  startsAt: true,
  salesOpenAt: true,
  waitingRoomEnabled: true,
  admissionRatePerSec: true,
} as const;

/**
 * Ticket drops' waiting rooms (C5.1). Customers of an event with `waitingRoomEnabled` join its
 * queue, poll their place, and once the admission job (`QueueAdmissionService`) lets them in get
 * an admission token. The seat map and new holds of such an event need that token
 * (`requireAdmission()`, else 403 `queue-required`).
 */
@Injectable()
export class WaitingRoomService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly store: QueueStore,
  ) {}

  /**
   * Joins the event's queue, or returns the customer's current entry (`created: false`). Open
   * from publication until the event starts.
   */
  async join(userId: string, eventId: string): Promise<{ created: boolean; entry: QueueEntry }> {
    const now = await this.clock.now();
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, status: 'PUBLISHED' },
      select: QUEUE_EVENT_SELECT,
    });
    if (event === null) throw publishedEventNotFound();
    if (!event.waitingRoomEnabled) {
      throw new ProblemException(
        'NO_WAITING_ROOM',
        409,
        'No waiting room',
        'This event has no waiting room: its seat map and holds are open to everyone.',
      );
    }
    if (event.startsAt.getTime() <= now.getTime()) {
      throw new ProblemException(
        'EVENT_NOT_ON_SALE',
        409,
        'Event not on sale',
        'The event has started: sales have ended.',
      );
    }
    const beforeOpen = now.getTime() < event.salesOpenAt.getTime();
    const { created, entry } = await this.redis(() =>
      this.store.join(eventId, userId, now, beforeOpen),
    );
    return {
      created,
      entry: toQueueEntry(entry, event, now, this.config.waitingRoom.pollIntervalMs),
    };
  }

  /** The customer's queue entry by its token. 404 for unknown tokens and other customers' tokens. */
  async status(userId: string, token: string): Promise<QueueEntry> {
    const now = await this.clock.now();
    const entry = await this.redis(() => this.store.findByToken(token));
    if (entry?.userId !== userId) {
      throw new NotFoundException('You have no queue entry with this token.');
    }
    const event = await this.prisma.event.findUnique({
      where: { id: entry.eventId },
      select: QUEUE_EVENT_SELECT,
    });
    if (event === null) throw new NotFoundException('You have no queue entry with this token.');
    return toQueueEntry(entry, event, now, this.config.waitingRoom.pollIntervalMs);
  }

  /**
   * Lets the request through unless the event is published with a waiting room and
   * `admissionToken` isn't an unexpired admission to it. With `userId` (holds), the admission must
   * also be that customer's; the seat map, which is public, only checks the event. Unknown and
   * unpublished events pass, so the route answers its own 404.
   */
  async requireAdmission(
    eventId: string,
    admissionToken: string | undefined,
    userId?: string,
  ): Promise<void> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, status: 'PUBLISHED' },
      select: { waitingRoomEnabled: true },
    });
    if (event === null || !event.waitingRoomEnabled) return;
    if (admissionToken === undefined || admissionToken === '') {
      throw queueRequired(
        `This event has a waiting room. Join the queue (POST /events/${eventId}/queue) and send the admission token you get in the ${ADMISSION_TOKEN_HEADER} header.`,
      );
    }
    const now = await this.clock.now();
    const entry = await this.redis(() => this.store.findByAdmissionToken(admissionToken));
    if (
      entry?.eventId !== eventId ||
      entry.admissionExpiresAt === null ||
      (userId !== undefined && entry.userId !== userId)
    ) {
      throw queueRequired(
        userId === undefined
          ? 'This admission token is not valid for this event. Join the queue to get one.'
          : 'This admission token is not yours or not valid for this event. Join the queue to get one.',
      );
    }
    if (entry.admissionExpiresAt.getTime() <= now.getTime()) {
      throw queueRequired('Your admission has expired. Join the queue again.');
    }
  }

  /** Runs a Redis operation; while Redis is unreachable that is a 503, not a 500. */
  private async redis<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (err) {
      if (err instanceof HttpException || this.store.isReady()) throw err;
      throw new ServiceUnavailableException(
        'The waiting room is unavailable right now. Try again shortly.',
        { cause: err },
      );
    }
  }
}

function queueRequired(detail: string): ProblemException {
  return new ProblemException('QUEUE_REQUIRED', 403, 'Queue required', detail);
}
