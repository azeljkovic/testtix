import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { JobSchedule } from '../jobs/job-schedule.js';
import { ORDER_PROCESSING_QUEUE, RECOVER_ORDERS_JOB } from './order-jobs.js';

/** ID of the job scheduler that looks for stuck `PROCESSING` orders. */
export const ORDER_RECOVERY_SCHEDULER_ID = 'recover-processing-orders';

export const ORDER_RECOVERY_INTERVAL_MS = 60_000;

/** Schedules `OrderProcessingService.recoverStuck()` every minute while the worker runs. */
@Injectable()
export class OrderRecoverySchedule extends JobSchedule {
  protected readonly logger = new Logger('OrderProcessing');

  constructor(@InjectQueue(ORDER_PROCESSING_QUEUE) private readonly queue: Queue) {
    super();
  }

  protected describeApply(): string {
    return 'schedule the order recovery job';
  }

  protected async apply(): Promise<void> {
    await this.queue.upsertJobScheduler(
      ORDER_RECOVERY_SCHEDULER_ID,
      { every: ORDER_RECOVERY_INTERVAL_MS },
      {
        name: RECOVER_ORDERS_JOB,
        opts: { removeOnComplete: { count: 10 }, removeOnFail: { count: 50 } },
      },
    );
  }
}
