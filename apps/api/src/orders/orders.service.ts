import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CURRENCY, type Page, type PageQuery, pageWindow, toPage } from '@testtix/shared';

import { ClockService } from '../clock/clock.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { ProblemException } from '../errors/problem.exception.js';
import type { Prisma, User } from '../generated/prisma/client.js';
import { lockHoldUnits, lockUserEvent } from '../holds/hold-locks.js';
import { PrismaService } from '../infra/prisma.service.js';
import { uuidv7 } from '../infra/uuid.js';
import { PaymentProviderError, PaymentsClient } from '../payments/payments.client.js';
import { OrderJobs } from './order-jobs.js';
import { startProcessing } from './order-transitions.js';
import { effectiveStatus, listOrderSummaries, loadOrder } from './order-views.js';
import type { Order, OrderSummary } from './orders.schemas.js';

type Db = Prisma.TransactionClient;

export interface CreatedOrder {
  order: Order;
  /** False when the hold already had an order, which is returned instead. */
  created: boolean;
}

/**
 * Checkout (C4.2): turns a customer's hold into an order and a payment session.
 *
 * - **One order per hold** (`orders.hold_id` is unique). Checking out the same hold again returns
 *   its order, so a double click or a retry after a network error is harmless.
 * - The hold is re-validated inside the transaction, under the holds locking order (event
 *   `FOR SHARE` → the user's advisory lock → the hold's units by ID), so it can't be released,
 *   replaced or swept halfway through. The tickets stay in the hold, which now belongs to the
 *   order: the order expires with it (`expiresAt` is the hold's), and releasing or replacing the
 *   hold expires the unpaid order (`deleteHold()`).
 * - The payment session is created **after** the transaction commits, never during it, so a slow
 *   provider can't hold locks or a pooled connection. If the provider fails, the order stays
 *   `PENDING_PAYMENT` without a session and the request answers 503; checking out the hold again
 *   retries the provider.
 * - A **free order** (total 0) needs no payment: it goes straight to `PROCESSING` in the same
 *   transaction (`startProcessing()`, which uses up the hold) and the processing job confirms it
 *   (C4.3).
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly payments: PaymentsClient,
    private readonly jobs: OrderJobs,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(user: User, holdId: string): Promise<CreatedOrder> {
    if (user.emailVerifiedAt === null) {
      throw new ProblemException(
        'EMAIL_NOT_VERIFIED',
        403,
        'Email not verified',
        'Verify your email address before checking out.',
      );
    }
    const now = await this.clock.now();
    const { orderId, created, free } = await this.prisma.$transaction((tx) =>
      createFromHold(tx, user.id, holdId, now),
    );
    if (free) await this.jobs.enqueueFinalize(orderId);
    else await this.ensurePaymentSession(user.id, orderId);
    return { order: await this.get(user.id, orderId), created };
  }

  /** The user's order. 404 for unknown orders and other users' orders. */
  async get(userId: string, orderId: string): Promise<Order> {
    const now = await this.clock.now();
    const order = await loadOrder(
      this.prisma,
      userId,
      orderId,
      now,
      this.config.orderPollIntervalMs,
    );
    if (order === null) throw new NotFoundException('You have no order with this ID.');
    return order;
  }

  /** The user's orders, newest first. */
  async list(userId: string, query: PageQuery): Promise<Page<OrderSummary>> {
    const now = await this.clock.now();
    const { items, total } = await listOrderSummaries(this.prisma, userId, pageWindow(query), now);
    return toPage(items, total, query);
  }

  /**
   * Gives an unpaid order its payment page, unless it has one already. Free orders get none: the
   * provider can't take a payment of 0, and they are confirmed without one.
   */
  private async ensurePaymentSession(userId: string, orderId: string): Promise<void> {
    const now = await this.clock.now();
    const order = await this.prisma.order.findFirstOrThrow({
      where: { id: orderId, userId },
      select: {
        status: true,
        expiresAt: true,
        totalCents: true,
        paymentSessionId: true,
        event: { select: { title: true } },
        _count: { select: { items: true } },
      },
    });
    if (
      effectiveStatus(order, now) !== 'PENDING_PAYMENT' ||
      order.paymentSessionId !== null ||
      order.totalCents === 0
    ) {
      return;
    }
    const tickets = order._count.items;
    let session;
    try {
      session = await this.payments.createSession({
        amountCents: order.totalCents,
        currency: CURRENCY,
        description:
          `${String(tickets)} ${tickets === 1 ? 'ticket' : 'tickets'} for ${order.event.title}`.slice(
            0,
            200,
          ),
        returnUrl: `${this.config.webBaseUrl}/orders/${orderId}`,
        webhookUrl: this.config.payments.webhookUrl,
        metadata: { orderId },
      });
    } catch (err) {
      if (!(err instanceof PaymentProviderError)) throw err;
      this.logger.warn(`Payment session for order ${orderId} not created: ${err.message}`);
      throw new ProblemException(
        'PAYMENT_PROVIDER_UNAVAILABLE',
        503,
        'Payment provider unavailable',
        'The payment provider could not be reached. Your tickets are still held: try again.',
      );
    }
    // A concurrent checkout of the same hold may have stored its session first; keep that one.
    // The other session is never shown to anyone, so it is never paid.
    await this.prisma.order.updateMany({
      where: { id: orderId, paymentSessionId: null },
      data: {
        paymentSessionId: session.id,
        paymentUrl: session.url,
        updatedAt: await this.clock.now(),
      },
    });
  }
}

/**
 * Creates the order of a hold in one transaction, or finds the one it already has. Throws 404 for
 * holds that aren't the user's or are gone, 409 `hold-expired` for an expired hold, and 409
 * `event-not-on-sale` once the event is no longer on sale. A new free order is `PROCESSING`
 * already (`free`), so the caller enqueues its processing job.
 */
async function createFromHold(
  tx: Db,
  userId: string,
  holdId: string,
  now: Date,
): Promise<{ orderId: string; created: boolean; free: boolean }> {
  const hold = await tx.hold.findFirst({
    where: { id: holdId, userId },
    select: { eventId: true },
  });
  if (hold === null) throw holdNotFound();

  // The holds locking order: event, the user's advisory lock, the hold's units.
  const [event] = await tx.$queryRaw<{ status: string; startsAt: Date }[]>`
    SELECT status, starts_at AS "startsAt" FROM events WHERE id = ${hold.eventId}::uuid FOR SHARE`;
  await lockUserEvent(tx, userId, hold.eventId);
  await lockHoldUnits(tx, holdId);

  // Read again under the locks: a concurrent request may have released or replaced the hold.
  const locked = await tx.hold.findUnique({
    where: { id: holdId },
    select: {
      expiresAt: true,
      order: { select: { id: true } },
      inventoryUnits: { select: { id: true, priceCents: true }, orderBy: { id: 'asc' } },
    },
  });
  if (locked === null) throw holdNotFound();
  if (locked.expiresAt.getTime() <= now.getTime()) {
    throw holdExpired('Your hold has expired and its tickets were released. Hold them again.');
  }
  if (locked.order !== null) return { orderId: locked.order.id, created: false, free: false };
  if (event === undefined || event.status !== 'PUBLISHED') {
    throw notOnSale('The event is no longer on sale.');
  }
  if (event.startsAt.getTime() <= now.getTime()) {
    throw notOnSale('The event has started: sales have ended.');
  }
  if (locked.inventoryUnits.length === 0) {
    throw holdExpired('Your hold has no tickets left. Hold them again.');
  }

  const orderId = uuidv7(now);
  const totalCents = locked.inventoryUnits.reduce((sum, unit) => sum + unit.priceCents, 0);
  await tx.order.create({
    data: {
      id: orderId,
      userId,
      eventId: hold.eventId,
      status: 'PENDING_PAYMENT',
      totalCents,
      expiresAt: locked.expiresAt,
      holdId,
      createdAt: now,
      updatedAt: now,
    },
  });
  await tx.orderItem.createMany({
    data: locked.inventoryUnits.map((unit) => ({
      id: uuidv7(now),
      orderId,
      inventoryUnitId: unit.id,
      priceCents: unit.priceCents,
    })),
  });
  // Under the hold's locks, which `startProcessing()` needs.
  if (totalCents === 0) await startProcessing(tx, orderId, holdId, now);
  return { orderId, created: true, free: totalCents === 0 };
}

function holdNotFound(): NotFoundException {
  return new NotFoundException('You have no hold with this ID.');
}

function holdExpired(detail: string): ProblemException {
  return new ProblemException('HOLD_EXPIRED', 409, 'Hold expired', detail);
}

function notOnSale(detail: string): ProblemException {
  return new ProblemException('EVENT_NOT_ON_SALE', 409, 'Event not on sale', detail);
}
