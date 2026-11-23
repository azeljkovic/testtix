import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { REDIS } from '../infra/redis.module.js';
import { QUEUE_PREFIX } from '../jobs/jobs.module.js';
import { describeError } from '../logging/describe-error.js';

export const ORDER_PROCESSING_QUEUE = 'order-processing';

/** Confirms or fails one `PROCESSING` order (`OrderProcessingService.finalize()`). */
export const FINALIZE_ORDER_JOB = 'finalize';
/** Re-enqueues `PROCESSING` orders whose finalize job went missing (scheduled). */
export const RECOVER_ORDERS_JOB = 'recover';

export interface FinalizeOrderJobData {
  orderId: string;
}

/** One job per order: enqueueing it again while it waits is a no-op. */
export function finalizeJobId(orderId: string): string {
  return `finalize-${orderId}`;
}

/**
 * Enqueues order processing jobs from the API and the worker. The queue shares the app's Redis
 * client, which fails fast while Redis is down (no offline queue), so a webhook never hangs on an
 * outage. It is created on first use: apps that never enqueue (`createTestApp()`, whose Redis is a
 * fake) never touch BullMQ.
 *
 * Enqueueing is best effort. The order's state is already committed, and the recovery job
 * (`RECOVER_ORDERS_JOB`) finds `PROCESSING` orders that have waited too long and enqueues them
 * again, so a failure here only delays an order, never loses it.
 */
@Injectable()
export class OrderJobs implements OnApplicationShutdown {
  private readonly logger = new Logger(OrderJobs.name);
  private queue: Queue | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * Schedules `finalize()` for the order after `JOB_PROCESSING_DELAY_MS` (or after `delayMs`).
   * Returns false, after logging, when the job could not be enqueued.
   */
  async enqueueFinalize(
    orderId: string,
    delayMs = this.config.orderProcessingDelayMs,
  ): Promise<boolean> {
    try {
      // Without a connection BullMQ would wait for one; the recovery job catches up instead.
      if (this.redis.status !== 'ready') throw new Error(`Redis is ${this.redis.status}`);
      const data: FinalizeOrderJobData = { orderId };
      await this.getQueue().add(FINALIZE_ORDER_JOB, data, {
        jobId: finalizeJobId(orderId),
        delay: delayMs,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        // Gone once finished, so the recovery job can enqueue an order again whose job failed
        // for good. Each outcome is logged.
        removeOnComplete: true,
        removeOnFail: true,
      });
      return true;
    } catch (err) {
      this.logger.warn(
        `Could not enqueue processing of order ${orderId} (${describeError(err)}); the recovery job will retry`,
      );
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    // Closes the queue only: the shared Redis client belongs to `RedisModule`.
    await this.queue?.close();
  }

  private getQueue(): Queue {
    if (this.queue === undefined) {
      this.queue = new Queue(ORDER_PROCESSING_QUEUE, {
        connection: this.redis,
        prefix: QUEUE_PREFIX,
      });
      // The Redis client's own listener already logs outages; without a listener here, an error
      // event would crash the process.
      this.queue.on('error', () => undefined);
    }
    return this.queue;
  }
}
