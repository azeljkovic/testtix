import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { OrderStatus } from '@testtix/shared';
import type { Job } from 'bullmq';

import { describeError } from '../logging/describe-error.js';
import { TicketEmailService } from '../tickets/ticket-email.service.js';
import {
  FINALIZE_ORDER_JOB,
  ORDER_PROCESSING_QUEUE,
  type OrderJobData,
  RECOVER_ORDERS_JOB,
  SEND_TICKETS_JOB,
} from './order-jobs.js';
import { OrderProcessingService } from './order-processing.service.js';

/**
 * Runs the order processing queue's jobs: `finalize` and `send-tickets` per order, and the
 * scheduled `recover`.
 */
@Processor(ORDER_PROCESSING_QUEUE, { concurrency: 4 })
export class OrderProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger('OrderProcessing');

  constructor(
    private readonly processing: OrderProcessingService,
    private readonly ticketEmail: TicketEmailService,
  ) {
    super();
  }

  async process(job: Job): Promise<OrderStatus | number | boolean | null> {
    switch (job.name) {
      case FINALIZE_ORDER_JOB: {
        const { orderId } = job.data as OrderJobData;
        const status = await this.processing.finalize(orderId);
        if (status !== null) this.logger.log(`Order ${orderId} is ${status}`);
        return status;
      }
      case SEND_TICKETS_JOB: {
        const { orderId } = job.data as OrderJobData;
        const sent = await this.ticketEmail.send(orderId);
        if (sent) this.logger.log(`Sent the tickets of order ${orderId}`);
        return sent;
      }
      case RECOVER_ORDERS_JOB: {
        const enqueued = await this.processing.recoverStuck();
        if (enqueued > 0) {
          this.logger.warn(`Re-enqueued ${String(enqueued)} missing order job(s)`);
        }
        return enqueued;
      }
      default:
        throw new Error(`Unknown order processing job "${job.name}"`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    const what = job === undefined ? '(unknown job)' : `${job.name} ${job.id ?? ''}`.trim();
    const willRetry = job !== undefined && job.attemptsMade < (job.opts.attempts ?? 1);
    this.logger.error(
      `Order processing job ${what} failed${willRetry ? ' (will retry)' : ''}: ${describeError(err)}`,
    );
  }
}
