import { Inject, Injectable } from '@nestjs/common';
import type { OrderStatus } from '@testtix/shared';

import { ClockService } from '../clock/clock.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { PrismaService } from '../infra/prisma.service.js';
import { issueTickets } from '../tickets/issue-tickets.js';
import { OrderJobs } from './order-jobs.js';

/**
 * How long past `JOB_PROCESSING_DELAY_MS` a `PROCESSING` order may wait before the recovery job
 * enqueues it again: enough for a job that is merely retrying to finish first. A `CONFIRMED`
 * order's e-ticket email is overdue this long after the order was confirmed.
 */
export const RECOVERY_GRACE_MS = 60_000;

/** Stuck orders re-enqueued per recovery run; the next run takes the rest. */
const RECOVERY_BATCH = 500;

/**
 * The order processing job (C4.3): finishes orders that are `PROCESSING`. Runs in the worker.
 *
 * - `CONFIRMED` when the payment that started processing succeeded, or the order is free. The
 *   inventory stays `SOLD`, and each item gets its ticket (with a code) in the same transaction
 *   (C4.4). The e-ticket email is then sent by its own job (`SEND_TICKETS_JOB`), so a slow or
 *   failing SMTP server never undoes or repeats a confirmation.
 * - `FAILED` when it failed. The inventory becomes `AVAILABLE` again.
 *
 * The result was decided when processing started: by the order's `APPLIED` payment event, or by
 * a total of 0. Finishing is idempotent: an order that is no longer `PROCESSING` is left alone,
 * so a job that runs twice changes nothing the second time.
 */
@Injectable()
export class OrderProcessingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly jobs: OrderJobs,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Confirms or fails the order. Returns its new status, or null when there was nothing to do. */
  async finalize(orderId: string): Promise<OrderStatus | null> {
    const now = await this.clock.now();
    const status = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          status: true,
          eventId: true,
          totalCents: true,
          items: { select: { inventoryUnitId: true } },
          paymentEvents: { where: { outcome: 'APPLIED' }, select: { type: true } },
        },
      });
      if (order?.status !== 'PROCESSING') return null;
      const unitIds = order.items.map((item) => item.inventoryUnitId);

      // Lock order: event, units by ID, then the order (as the holds paths do).
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${order.eventId}::uuid FOR SHARE`;
      await tx.$queryRaw`
        SELECT id FROM inventory_units WHERE id = ANY(${unitIds}::uuid[]) ORDER BY id FOR UPDATE`;
      const [locked] = await tx.$queryRaw<{ status: OrderStatus }[]>`
        SELECT status FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      if (locked?.status !== 'PROCESSING') return null; // A concurrent run finished it.

      const status = resultOf(orderId, order.totalCents, order.paymentEvents);
      if (status === 'FAILED') {
        // Still `SOLD` by this order: nothing else can take a processing order's tickets.
        await tx.$executeRaw`
          UPDATE inventory_units SET status = 'AVAILABLE'
          WHERE id = ANY(${unitIds}::uuid[]) AND status = 'SOLD'`;
      } else {
        await issueTickets(tx, orderId, now);
      }
      await tx.order.update({ where: { id: orderId }, data: { status, updatedAt: now } });
      return status;
    });
    // Best effort: if this fails, the recovery job enqueues the email later.
    if (status === 'CONFIRMED') await this.jobs.enqueueSendTickets(orderId);
    return status;
  }

  /**
   * Catches up on jobs that went missing: their job was never enqueued (Redis was down), or failed
   * for good. Enqueues `finalize()` again for orders that have been `PROCESSING` for longer than
   * the job delay plus `RECOVERY_GRACE_MS` (server clock), and the e-ticket email for orders
   * confirmed more than `RECOVERY_GRACE_MS` ago that haven't had it. Returns how many jobs were
   * enqueued.
   */
  async recoverStuck(): Promise<number> {
    const now = await this.clock.now();
    const processingCutoff = new Date(
      now.getTime() - this.config.orderProcessingDelayMs - RECOVERY_GRACE_MS,
    );
    const emailCutoff = new Date(now.getTime() - RECOVERY_GRACE_MS);
    const [stuck, unsent] = await Promise.all([
      this.prisma.order.findMany({
        where: { status: 'PROCESSING', updatedAt: { lte: processingCutoff } },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: RECOVERY_BATCH,
        select: { id: true },
      }),
      this.prisma.order.findMany({
        where: { status: 'CONFIRMED', ticketsEmailedAt: null, updatedAt: { lte: emailCutoff } },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: RECOVERY_BATCH,
        select: { id: true },
      }),
    ]);
    let enqueued = 0;
    for (const { id } of stuck) {
      if (await this.jobs.enqueueFinalize(id, 0)) enqueued += 1;
    }
    for (const { id } of unsent) {
      if (await this.jobs.enqueueSendTickets(id)) enqueued += 1;
    }
    return enqueued;
  }
}

function resultOf(
  orderId: string,
  totalCents: number,
  applied: readonly { type: string }[],
): 'CONFIRMED' | 'FAILED' {
  const [payment] = applied;
  if (payment === undefined) {
    if (totalCents === 0) return 'CONFIRMED';
    throw new Error(`Order ${orderId} is PROCESSING without a payment result`);
  }
  return payment.type === 'payment.succeeded' ? 'CONFIRMED' : 'FAILED';
}
