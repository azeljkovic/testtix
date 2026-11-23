import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { JobSchedule } from '../jobs/job-schedule.js';
import { HOLD_SWEEPER_QUEUE } from './hold-sweeper.processor.js';

/** ID of the job scheduler (BullMQ's repeatable job) that enqueues a sweep every interval. */
export const HOLD_SWEEPER_SCHEDULER_ID = 'sweep-expired-holds';

/**
 * Creates or updates the hold sweeper's job scheduler on startup, or removes it when
 * `HOLD_SWEEPER_ENABLED=false`, so turning the sweeper off also stops a schedule an earlier
 * deployment left in Redis.
 */
@Injectable()
export class HoldSweeperSchedule extends JobSchedule {
  protected readonly logger = new Logger('HoldSweeper');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectQueue(HOLD_SWEEPER_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  protected describeApply(): string {
    return `${this.config.holdSweeper.enabled ? 'schedule' : 'unschedule'} the hold sweeper`;
  }

  protected async apply(): Promise<void> {
    const { enabled, intervalMs } = this.config.holdSweeper;
    if (enabled) {
      await this.queue.upsertJobScheduler(
        HOLD_SWEEPER_SCHEDULER_ID,
        { every: intervalMs },
        {
          name: 'sweep',
          // Keep a few finished jobs for inspection, not one per interval forever.
          opts: { removeOnComplete: { count: 10 }, removeOnFail: { count: 50 } },
        },
      );
      this.logger.log(`Sweeping expired holds every ${String(intervalMs)} ms`);
    } else if (await this.queue.removeJobScheduler(HOLD_SWEEPER_SCHEDULER_ID)) {
      this.logger.log('Hold sweeper disabled: removed its schedule');
    }
  }
}
