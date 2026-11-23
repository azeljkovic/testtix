import { Inject, Injectable } from '@nestjs/common';
import type { OrderStatus } from '@testtix/shared';

import { ClockService } from '../clock/clock.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { PrismaService } from '../infra/prisma.service.js';
import { OrderJobs } from './order-jobs.js';

/**
 * How long past `JOB_PROCESSING_DELAY_MS` a `PROCESSING` order may wait before the recovery job
 * enqueues it again: enough for a job that is merely retrying to finish first.
 */
export const RECOVERY_GRACE_MS = 60_000;

/** Stuck orders re-enqueued per recovery run; the next run takes the rest. */
const RECOVERY_BATCH = 500;

/**
 * The order processing job (C4.3): finishes orders that are `PROCESSING`. Runs in the worker.
 *
 * - `CONFIRMED` when the payment that started processing succeeded, or the order is free. The
 *   tickets stay `SOLD`.
 * - `FAILED` when it failed. The tickets become `AVAILABLE` again.
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
    return this.prisma.$transaction(async (tx) => {
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
      }
      await tx.order.update({ where: { id: orderId }, data: { status, updatedAt: now } });
      return status;
    });
  }

  /**
   * Enqueues `finalize()` again for orders that have been `PROCESSING` for longer than the job
   * delay plus `RECOVERY_GRACE_MS` (server clock): their job was never enqueued (Redis was down),
   * or failed for good. Returns how many were enqueued.
   */
  async recoverStuck(): Promise<number> {
    const now = await this.clock.now();
    const cutoff = new Date(now.getTime() - this.config.orderProcessingDelayMs - RECOVERY_GRACE_MS);
    const stuck = await this.prisma.order.findMany({
      where: { status: 'PROCESSING', updatedAt: { lte: cutoff } },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: RECOVERY_BATCH,
      select: { id: true },
    });
    let enqueued = 0;
    for (const { id } of stuck) {
      if (await this.jobs.enqueueFinalize(id, 0)) enqueued += 1;
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
